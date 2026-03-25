/**
 * Tests for the email send implementation in src/lib/api.ts
 *
 * Covers:
 *  - sendEmailOne: success, HTTP error (JSON detail), HTTP error (non-JSON)
 *  - sendCampaign: all sent, partial failure, total failure
 *  - sendCampaign: correct JSON payload shape (to, subject, html, text)
 *  - sendCampaign: HTML → plain-text stripping in the text field
 *  - sendCampaign: respects concurrency (no more than 5 in-flight at once)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendEmailOne,
  sendCampaign,
  type CampaignSendTask,
  type GeneratedEmail,
} from "@/lib/api";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEmail(overrides: Partial<GeneratedEmail> = {}): GeneratedEmail {
  return {
    id: "email-1",
    subject: "Default subject",
    htmlContent: "<h1>Hello</h1><p>World</p>",
    summary: {
      targetGroup: "All users",
      regionalAdaptation: "None",
      toneDecision: "Friendly",
      legalConsiderations: "None",
    },
    ...overrides,
  };
}

function makeTask(
  overrides: Partial<CampaignSendTask> = {}
): CampaignSendTask {
  return {
    email: makeEmail(),
    recipient: "user@example.com",
    subject: "Test subject",
    ...overrides,
  };
}

/** Return a minimal fetch mock that always resolves with 200 + given body. */
function mockFetchOk(body: unknown = { status: "sent", provider: "sendgrid" }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

/** Return a fetch mock that resolves with a non-2xx status. */
function mockFetchError(status: number, body: unknown = { detail: "Something went wrong" }) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
    statusText: `HTTP ${status}`,
  });
}

// ── sendEmailOne ──────────────────────────────────────────────────────────────

describe("sendEmailOne", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls POST /v1/email/send with correct payload", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    await sendEmailOne({
      to: "user@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/v1/email/send");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      to: "user@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });

  it("resolves without error on 200 response", async () => {
    vi.stubGlobal("fetch", mockFetchOk());
    await expect(
      sendEmailOne({ to: "a@b.com", subject: "S", html: "<p>H</p>" })
    ).resolves.toBeUndefined();
  });

  it("throws with detail message on non-ok JSON response", async () => {
    vi.stubGlobal("fetch", mockFetchError(502, { detail: "SendGrid is down" }));
    await expect(
      sendEmailOne({ to: "a@b.com", subject: "S", html: "<p>H</p>" })
    ).rejects.toThrow("SendGrid is down");
  });

  it("throws with HTTP status when error body is non-JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => { throw new Error("not json"); },
      })
    );
    await expect(
      sendEmailOne({ to: "a@b.com", subject: "S", html: "<p>H</p>" })
    ).rejects.toThrow("Service Unavailable");
  });
});

// ── sendCampaign ──────────────────────────────────────────────────────────────

describe("sendCampaign", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns sent=1, failed=[] when one task succeeds", async () => {
    vi.stubGlobal("fetch", mockFetchOk());

    const result = await sendCampaign([makeTask()]);

    expect(result.sent).toBe(1);
    expect(result.failed).toHaveLength(0);
  });

  it("sends one fetch call per task", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    await sendCampaign([
      makeTask({ recipient: "a@example.com" }),
      makeTask({ recipient: "b@example.com" }),
      makeTask({ recipient: "c@example.com" }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends the correct recipient and subject per task", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    await sendCampaign([
      makeTask({ recipient: "alice@example.com", subject: "Hi Alice" }),
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toBe("alice@example.com");
    expect(body.subject).toBe("Hi Alice");
  });

  it("sends html from email.htmlContent", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const html = "<h1>Christmas Deal</h1><p>25% off</p>";

    await sendCampaign([makeTask({ email: makeEmail({ htmlContent: html }) })]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toBe(html);
  });

  it("strips HTML tags for the text field", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    await sendCampaign([
      makeTask({
        email: makeEmail({
          htmlContent: "<h1>Christmas Deal</h1><p>25% off all plans.</p>",
        }),
      }),
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).not.toContain("<");
    expect(body.text).toContain("Christmas Deal");
    expect(body.text).toContain("25% off all plans.");
  });

  it("strips <style> blocks from the text fallback", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    await sendCampaign([
      makeTask({
        email: makeEmail({
          htmlContent:
            "<style>body{color:red}</style><p>Visible content</p>",
        }),
      }),
    ]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).not.toContain("body{color:red}");
    expect(body.text).toContain("Visible content");
  });

  it("captures failed tasks without throwing, increments failed[]", async () => {
    vi.stubGlobal("fetch", mockFetchError(502, { detail: "Provider error" }));

    const result = await sendCampaign([
      makeTask({ recipient: "fail@example.com" }),
    ]);

    expect(result.sent).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].recipient).toBe("fail@example.com");
    expect(result.failed[0].error).toContain("Provider error");
  });

  it("handles partial failures: some succeed, some fail", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount % 2 === 0) {
          // even calls fail
          return {
            ok: false,
            status: 502,
            json: async () => ({ detail: "even call failed" }),
            statusText: "Bad Gateway",
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "sent" }),
        };
      })
    );

    const result = await sendCampaign([
      makeTask({ recipient: "r1@example.com" }),
      makeTask({ recipient: "r2@example.com" }),
      makeTask({ recipient: "r3@example.com" }),
      makeTask({ recipient: "r4@example.com" }),
    ]);

    expect(result.sent).toBe(2);
    expect(result.failed).toHaveLength(2);
  });

  it("returns sent=0, failed for all when every request fails", async () => {
    vi.stubGlobal("fetch", mockFetchError(500, { detail: "Server error" }));

    const result = await sendCampaign([
      makeTask({ recipient: "a@example.com" }),
      makeTask({ recipient: "b@example.com" }),
    ]);

    expect(result.sent).toBe(0);
    expect(result.failed).toHaveLength(2);
  });

  it("returns sent=0 and empty failed for empty task list", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendCampaign([]);

    expect(result.sent).toBe(0);
    expect(result.failed).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not exceed concurrency limit of 5 simultaneous requests", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10)); // simulate latency
        inFlight--;
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "sent" }),
        };
      })
    );

    // 10 tasks; concurrency cap is 5
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ recipient: `user${i}@example.com` })
    );

    await sendCampaign(tasks);

    expect(maxInFlight).toBeLessThanOrEqual(5);
  });
});
