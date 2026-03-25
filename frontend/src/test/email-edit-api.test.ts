/**
 * Unit tests for editEmail() in src/lib/api.ts.
 * Uses vi.stubGlobal("fetch", ...) so the real implementation is tested.
 * (Kept separate from email-edit.test.tsx which mocks the whole api module.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { editEmail } from "@/lib/api";

const OLD_HTML = "<html><body><p>Original</p></body></html>";
const NEW_HTML = "<html><body><p>Regenerated</p></body></html>";

describe("editEmail() API function", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns the html_content string from a successful response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        email: {
          id: "email-1",
          subject: "Spring Sale",
          html_content: NEW_HTML,
          summary: {},
        },
      }),
    });

    const html = await editEmail("email-1", OLD_HTML, "Spring Sale", "Make it more formal");
    expect(html).toBe(NEW_HTML);
  });

  it("sends the correct JSON payload to /v1/campaigns/edit-email", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: { html_content: NEW_HTML } }),
    });

    await editEmail("email-1", OLD_HTML, "My Subject", "Add a promo code");

    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/v1/campaigns/edit-email");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({
      email_id: "email-1",
      current_html: OLD_HTML,
      subject: "My Subject",
      instructions: "Add a promo code",
    });
  });

  it("throws an Error with status code when response is not ok", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => '{"detail":"Gemini unavailable"}',
    });

    await expect(
      editEmail("email-1", OLD_HTML, "S", "instructions"),
    ).rejects.toThrow("API error 503");
  });

  it("throws when the backend returns empty HTML", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: { html_content: "" } }),
    });

    await expect(
      editEmail("email-1", OLD_HTML, "S", "instructions"),
    ).rejects.toThrow("Edit returned empty HTML");
  });
});
