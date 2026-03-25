/**
 * tests for the email edit flow — component tests.
 *
 * Renders the EmailEditorModal, types instructions, submits, asserts the API
 * was called with the right payload, and the onSaved callback received the
 * new HTML.
 *
 * API-function unit tests (editEmail) live in email-edit-api.test.ts so they
 * can import the real implementation without the module mock intercepting it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { editEmail } from "@/lib/api";
import { EmailEditorModal } from "@/pages/ReviewPage";
import type { GeneratedEmail } from "@/lib/mock-api";

// ── helpers ───────────────────────────────────────────────────────────────────

const MOCK_EMAIL: GeneratedEmail = {
  id: "email-1",
  subject: "Spring Sale",
  htmlContent: "<html><body><p>Original content</p></body></html>",
  summary: {
    targetGroup: "All customers",
    regionalAdaptation: "EU",
    toneDecision: "Warm and friendly",
    legalConsiderations: "GDPR compliant",
  },
};

const NEW_HTML = "<html><body><p>Regenerated content</p></body></html>";

// ──────────────────────────────────────────────────────────────────────────────
// Suite 2: EmailEditorModal component
// ──────────────────────────────────────────────────────────────────────────────

// Mock the api module so no real fetch calls are made.
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, editEmail: vi.fn() };
});

// Radix UI's TabsContent uses a Presence component with animations that
// prevents content from mounting synchronously in jsdom. Replace the whole
// Tabs suite with plain pass-through divs so all tab content is always rendered.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: React.PropsWithChildren) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ children, value }: React.PropsWithChildren<{ value: string }>) => (
    <button role="tab" type="button">{children}</button>
  ),
  TabsContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

describe("EmailEditorModal component", () => {
  const mockEditEmail = vi.mocked(editEmail);
  const onClose = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Renders the modal with the Edit tab as the default so the textarea is
   * immediately in the DOM — no tab-click needed and no Radix lazy-mount issue.
   */
  function renderModal(emailOverrides: Partial<GeneratedEmail> = {}) {
    const email = { ...MOCK_EMAIL, ...emailOverrides };
    return render(
      <EmailEditorModal
        email={email}
        open={true}
        onClose={onClose}
        onSaved={onSaved}
        defaultTab="edit"
      />
    );
  }

  it("renders the email subject in the dialog header", () => {
    renderModal();
    expect(screen.getByText("Spring Sale")).toBeInTheDocument();
  });

  it("Apply Changes button is disabled when textarea is empty", () => {
    renderModal();
    const btn = screen.getByRole("button", { name: /apply changes/i });
    expect(btn).toBeDisabled();
  });

  it("Apply Changes button becomes enabled when instructions are typed", () => {
    renderModal();
    const textarea = screen.getByPlaceholderText(/describe the changes/i);
    fireEvent.change(textarea, { target: { value: "Make it more formal" } });
    const btn = screen.getByRole("button", { name: /apply changes/i });
    expect(btn).not.toBeDisabled();
  });

  it("calls editEmail with correct args when Apply Changes is clicked", async () => {
    mockEditEmail.mockResolvedValue(NEW_HTML);
    renderModal();

    const textarea = screen.getByPlaceholderText(/describe the changes/i);
    fireEvent.change(textarea, { target: { value: "Make it more formal" } });
    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));

    await waitFor(() => {
      expect(mockEditEmail).toHaveBeenCalledWith(
        "email-1",
        MOCK_EMAIL.htmlContent,
        "Spring Sale",
        "Make it more formal"
      );
    });
  });

  it("calls onSaved with the email id and new HTML after a successful edit", async () => {
    mockEditEmail.mockResolvedValue(NEW_HTML);
    renderModal();

    const textarea = screen.getByPlaceholderText(/describe the changes/i);
    fireEvent.change(textarea, { target: { value: "Make it funnier" } });
    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("email-1", NEW_HTML);
    });
  });

  it("clears the textarea after a successful edit", async () => {
    mockEditEmail.mockResolvedValue(NEW_HTML);
    renderModal();

    const textarea = screen.getByPlaceholderText(/describe the changes/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Add urgency" } });
    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));

    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
  });

  it("shows an error message and does NOT call onSaved when editEmail throws", async () => {
    mockEditEmail.mockRejectedValue(new Error("Gemini timeout"));
    renderModal();

    const textarea = screen.getByPlaceholderText(/describe the changes/i);
    fireEvent.change(textarea, { target: { value: "Something" } });
    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/gemini timeout/i)).toBeInTheDocument();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
