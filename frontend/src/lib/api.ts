// api.ts – real API client for the Mark FastAPI backend
import {
  editLocalEmail,
  generateLocalCampaign,
  recommendLocalRecipients,
} from "@/lib/mock-api";
import { getLocalOnlyMode } from "@/core/settings/runtime-settings";
import { supabase } from "@/integrations/supabase/supabase-client";

export interface GeneratedEmail {
  id: string;
  subject: string;
  htmlContent: string;
  summary: {
    targetGroup: string;
    regionalAdaptation: string;
    toneDecision: string;
    legalConsiderations: string;
  };
}

export interface ClarificationQuestion {
  field: string;
  question: string;
}

export interface BrandContextPayload {
  brandName: string;
  voiceGuidelines: string;
  bannedPhrases: string[];
  requiredPhrases: string[];
  legalFooter: string;
  designTokens: {
    autoDesign: boolean;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamilyHeading: string;
    fontFamilyBody: string;
    borderRadius: string;
    logoUrl: string;
  };
}

export interface CampaignRequest {
  prompt: string;
  force_proceed?: boolean;
  brand_context?: BrandContextPayload;
}

export interface CampaignResponse {
  id: string;
  status: "completed" | "needs_clarification";
  questions?: ClarificationQuestion[];
  emails: GeneratedEmail[];
}

function isLocalOnlyMode(): boolean {
  return import.meta.env.VITE_LOCAL_ONLY === "true" || getLocalOnlyMode();
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!supabase || isLocalOnlyMode()) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJsonOrThrow<T>(url: string, init?: RequestInit): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const headers = new Headers(init?.headers);
  Object.entries(authHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let detail = "";
    try {
      const errorBody = await res.json();
      if (errorBody?.detail) detail = String(errorBody.detail);
    } catch {
      // no-op: body may not be JSON
    }
    const reason = detail || res.statusText || `HTTP ${res.status}`;
    throw new Error(`API error ${res.status}: ${reason}`);
  }
  return res.json() as Promise<T>;
}

export interface EmailConfig {
  configured: boolean;
  missing: string[];
  from_email: string;
}

// Map snake_case backend response → camelCase frontend shape
function mapEmail(raw: {
  id: string;
  subject: string;
  html_content: string;
  summary: {
    target_group: string;
    regional_adaptation: string;
    tone_decision: string;
    legal_considerations: string;
  };
}): GeneratedEmail {
  return {
    id: raw.id,
    subject: raw.subject,
    htmlContent: raw.html_content,
    summary: {
      targetGroup: raw.summary.target_group,
      regionalAdaptation: raw.summary.regional_adaptation,
      toneDecision: raw.summary.tone_decision,
      legalConsiderations: raw.summary.legal_considerations,
    },
  };
}

export async function generateCampaign(request: CampaignRequest): Promise<CampaignResponse> {
  if (!isLocalOnlyMode()) {
    try {
      const data = await fetchJsonOrThrow<{
        id: string;
        status: "completed" | "needs_clarification";
        questions?: ClarificationQuestion[];
        emails?: Array<{
          id: string;
          subject: string;
          html_content: string;
          summary: {
            target_group: string;
            regional_adaptation: string;
            tone_decision: string;
            legal_considerations: string;
          };
        }>;
      }>("/v1/campaigns/generate-from-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: request.prompt,
          force_proceed: request.force_proceed ?? false,
          brand_context: request.brand_context ?? null,
        }),
      });
      return {
        id: data.id,
        status: data.status,
        questions: data.questions ?? [],
        emails: (data.emails ?? []).map(mapEmail),
      };
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // Fall back to local deterministic generation on network failure.
    }
  }

  const localEmails = await generateLocalCampaign(request.prompt);
  return {
    id: `local-${Date.now()}`,
    status: "completed",
    emails: localEmails,
  };
}

/**
 * Ask the AI to regenerate a single email's HTML based on user instructions.
 * Returns only the updated HTML string; every other field (subject, summary)
 * is preserved by the caller.
 */
export async function editEmail(
  emailId: string,
  currentHtml: string,
  subject: string,
  instructions: string
): Promise<string> {
  if (!isLocalOnlyMode()) {
    try {
      const data = await fetchJsonOrThrow<{
        email?: { html_content?: string; htmlContent?: string };
      }>("/v1/campaigns/edit-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_id: emailId,
          current_html: currentHtml,
          subject,
          instructions,
        }),
      });
      const html: string = data?.email?.html_content ?? data?.email?.htmlContent ?? "";
      if (!html) throw new Error("Edit returned empty HTML");
      return html;
    } catch (error) {
      if (error instanceof Error && error.message === "Edit returned empty HTML") throw error;
      if (!(error instanceof TypeError)) throw error;
      // Fall back to local editing on network failure.
    }
  }

  return editLocalEmail(currentHtml, instructions);
}

// ── Email send helpers ───────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 2000);
}

async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  const queue = [...tasks];
  async function runNext(): Promise<void> {
    if (queue.length === 0) return;
    const task = queue.shift()!;
    results.push(await task());
    await runNext();
  }
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => runNext()
  );
  await Promise.all(workers);
  return results;
}

export interface SendEmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmailOne(payload: SendEmailPayload): Promise<void> {
  if (!payload.to || !payload.subject || (!payload.html && !payload.text)) {
    throw new Error("Invalid email payload.");
  }

  if (!isLocalOnlyMode()) {
    try {
      await fetchJsonOrThrow<{ status: string }>("/v1/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // Network failure: local mode no-op send.
      return;
    }
  }
}

export async function getEmailConfig(): Promise<EmailConfig> {
  return fetchJsonOrThrow<EmailConfig>("/v1/email/config", {
    method: "GET",
  });
}

export interface CampaignSendTask {
  email: GeneratedEmail;
  recipient: string;
  subject: string;
}

export interface RecipientRecommendation {
  assignments: Record<string, string[]>; // email_id -> [email addresses]
  reasoning: string;
}

export async function recommendRecipients(
  emails: { id: string; subject: string; target_group: string }[],
  contacts_csv: string,
  campaign_prompt?: string
): Promise<RecipientRecommendation> {
  if (!contacts_csv.trim()) {
    return { assignments: {}, reasoning: "No contacts available." };
  }

  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<RecipientRecommendation>("/v1/campaigns/recommend-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails, contacts_csv, campaign_prompt: campaign_prompt ?? null }),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // Fall back to local assignment on network failure.
    }
  }

  const assignments = await recommendLocalRecipients(
    emails.map((email) => email.id),
    contacts_csv
  );
  return {
    assignments,
    reasoning: "Assigned locally using deterministic balancing.",
  };
}


export async function sendCampaign(
  tasks: CampaignSendTask[]
): Promise<{ sent: number; failed: { recipient: string; error: string }[] }> {
  const failed: { recipient: string; error: string }[] = [];
  let sent = 0;

  const validated = tasks.filter(
    (task) => Boolean(task.recipient?.includes("@")) && Boolean(task.email.htmlContent)
  );

  const jobs = validated.map(
    (task) => async () => {
      try {
        await sendEmailOne({
          to: task.recipient,
          subject: task.subject,
          html: task.email.htmlContent,
          text: stripHtml(task.email.htmlContent),
        });
        sent++;
      } catch (err) {
        failed.push({
          recipient: task.recipient,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );

  await withConcurrency(jobs, 5);
  return { sent, failed };
}
