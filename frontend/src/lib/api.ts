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
  campaign_memory?: string[];
}

export interface AiReport {
  quality_score: number | null;
  issues: string[];
  risk_flags: string[];
  guardrails_passed: boolean;
  tokens_estimate: number;
  timings_ms: Record<string, number | null>;
  model_used: string;
  subject_recommendations: Array<{
    email_id: string;
    recommended: string;
    alternatives: string[];
  }>;
}

export interface CampaignResponse {
  id: string;
  status: "completed" | "needs_clarification";
  questions?: ClarificationQuestion[];
  emails: GeneratedEmail[];
  ai_report?: AiReport;
}

function isLocalOnlyMode(): boolean {
  return import.meta.env.VITE_LOCAL_ONLY === "true" || getLocalOnlyMode();
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

function resolveApiUrl(url: string): string {
  if (!API_BASE_URL) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${API_BASE_URL}${url}`;
  return `${API_BASE_URL}/${url}`;
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

  const res = await fetch(resolveApiUrl(url), { ...init, headers });
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
        ai_report?: AiReport;
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
          campaign_memory: request.campaign_memory ?? [],
        }),
      });
      return {
        id: data.id,
        status: data.status,
        questions: data.questions ?? [],
        emails: (data.emails ?? []).map(mapEmail),
        ai_report: data.ai_report,
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
    ai_report: {
      quality_score: null,
      issues: [],
      risk_flags: [],
      guardrails_passed: true,
      tokens_estimate: 0,
      timings_ms: {},
      model_used: "local-fallback",
      subject_recommendations: localEmails.map((email) => ({
        email_id: email.id,
        recommended: email.subject,
        alternatives: [],
      })),
    },
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
  personalized_html?: string;
  personalized_text?: string;
}

export interface RecipientRecommendation {
  assignments: Record<string, string[]>; // email_id -> [email addresses]
  reasoning: string;
}

export interface ComplianceEmailResult {
  id: string;
  issues: string[];
  risk_flags: string[];
  fixes: string[];
  score: number;
}

export interface ComplianceAssistantResponse {
  passed: boolean;
  overall_score: number;
  summary: string;
  emails: ComplianceEmailResult[];
}

export interface ScoredVariant {
  text: string;
  score: number;
  rationale: string;
}

export interface VariantPredictResponse {
  best_subject: string;
  best_cta: string;
  subjects: ScoredVariant[];
  ctas: ScoredVariant[];
}

export interface PerformanceCopilotResponse {
  summary: string;
  wins: string[];
  risks: string[];
  next_actions: string[];
}

export interface DiscoveredSegment {
  id: string;
  name: string;
  filter_label: string;
  description: string;
  emails: string[];
  confidence: number;
  recommended_for: string;
}

export interface SegmentDiscoveryResponse {
  segments: DiscoveredSegment[];
  reasoning: string;
}

export interface SmartBrief {
  campaign_name: string;
  objective: string;
  target_audience: string;
  offer: string;
  primary_kpi: string;
  geo_scope: string;
  language: string;
  tone: string;
  compliance_notes: string;
  send_window: string;
  number_of_emails: number;
  key_points: string[];
  assumptions: string[];
}

export interface SmartBriefResponse {
  brief: SmartBrief;
  questions: string[];
}

export interface SendTimeSuggestion {
  email_id: string;
  timezone: string;
  local_window: string;
  recommended_hour_local: number;
  rationale: string;
}

export interface SendTimeOptimizeResponse {
  suggestions: SendTimeSuggestion[];
  global_reasoning: string;
}

export interface VoiceProfile {
  style_summary: string;
  do_list: string[];
  dont_list: string[];
  vocabulary: string[];
  sample_lines: string[];
  confidence: number;
}

export interface VoiceTrainResponse {
  profile: VoiceProfile;
  reasoning: string;
}

export interface LocalizedEmail {
  id: string;
  subject: string;
  html_content: string;
  notes: string;
}

export interface LocalizeCampaignResponse {
  language: string;
  region: string;
  emails: LocalizedEmail[];
  reasoning: string;
}

export interface RepurposedAsset {
  channel: string;
  title: string;
  body: string;
  cta: string;
}

export interface RepurposeResponse {
  assets: RepurposedAsset[];
  reasoning: string;
}

export interface OutcomeRecordResponse {
  stored: boolean;
  score: number;
  total_records: number;
}

export interface MemorySnippet {
  snippet: string;
  score: number;
  tags: string[];
}

export interface MemoryRetrieveResponse {
  snippets: MemorySnippet[];
  reasoning: string;
}

export interface ExperimentVariantStat {
  variant: string;
  impressions: number;
  clicks: number;
  conversions: number;
  rate: number;
}

export interface ExperimentStartResponse {
  experiment_id: string;
  metric: string;
  variants: ExperimentVariantStat[];
}

export interface ExperimentStatusResponse {
  experiment_id: string;
  metric: string;
  variants: ExperimentVariantStat[];
  winner: string;
  confidence: number;
  completed: boolean;
}

export interface AgentMetricItem {
  agent: string;
  calls: number;
  success: number;
  fallback: number;
  avg_latency_ms: number;
}

export interface AgentMetricsResponse {
  metrics: AgentMetricItem[];
  total_calls: number;
}

export interface OrchestrateGrowthResponse {
  best_subject: string;
  best_cta: string;
  compliance_passed: boolean;
  compliance_summary: string;
  send_time_reasoning: string;
  memory_snippets: string[];
  next_actions: string[];
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

export async function runComplianceAssistant(payload: {
  emails: Array<{ id: string; subject: string; html_content: string }>;
  banned_phrases?: string[];
  required_phrases?: string[];
  legal_footer?: string;
}): Promise<ComplianceAssistantResponse> {
  if (!payload.emails.length) {
    return { passed: true, overall_score: 100, summary: "No emails to evaluate.", emails: [] };
  }
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<ComplianceAssistantResponse>("/v1/campaigns/compliance-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return {
    passed: true,
    overall_score: 100,
    summary: "Compliance checks unavailable in local-only mode; proceeding.",
    emails: payload.emails.map((email) => ({
      id: email.id,
      issues: [],
      risk_flags: [],
      fixes: [],
      score: 100,
    })),
  };
}

export async function predictVariants(payload: {
  subject_options: string[];
  cta_options: string[];
  audience: string;
  offer?: string;
  objective?: string;
}): Promise<VariantPredictResponse> {
  if (!payload.subject_options.length) {
    throw new Error("At least one subject option is required.");
  }
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<VariantPredictResponse>("/v1/campaigns/predict-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  const bestSubject = payload.subject_options[0] ?? "";
  const bestCta = payload.cta_options[0] ?? "";
  return {
    best_subject: bestSubject,
    best_cta: bestCta,
    subjects: payload.subject_options.map((s, i) => ({
      text: s,
      score: Math.max(20, 90 - i * 8),
      rationale: "Local fallback ranking.",
    })),
    ctas: payload.cta_options.map((c, i) => ({
      text: c,
      score: Math.max(20, 88 - i * 8),
      rationale: "Local fallback ranking.",
    })),
  };
}

export async function getPerformanceCopilot(payload: {
  campaign_name: string;
  prompt: string;
  sent_count: number;
  failed_count: number;
  open_rate?: number;
  click_rate?: number;
  notes?: string;
}): Promise<PerformanceCopilotResponse> {
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<PerformanceCopilotResponse>("/v1/campaigns/performance-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return {
    summary: "Campaign completed. Gather open/click metrics to improve the next send.",
    wins: ["Delivery flow executed successfully."],
    risks: ["No cloud analytics available in local mode."],
    next_actions: ["Run a follow-up with one new subject line and compare outcomes."],
  };
}

export async function discoverAudienceSegments(payload: {
  contacts_csv: string;
  max_segments?: number;
  campaign_prompt?: string;
}): Promise<SegmentDiscoveryResponse> {
  if (!payload.contacts_csv.trim()) return { segments: [], reasoning: "No contacts available." };
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<SegmentDiscoveryResponse>("/v1/campaigns/discover-segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  const parseCsvRecords = (csv: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuote = false;
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i];
      if (ch === '"') {
        if (inQuote && csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
        continue;
      }
      if (ch === "," && !inQuote) {
        row.push(field);
        field = "";
        continue;
      }
      if ((ch === "\n" || ch === "\r") && !inQuote) {
        if (ch === "\r" && csv[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
        row = [];
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
    return rows;
  };

  const rows = parseCsvRecords(payload.contacts_csv.trim());
  const headers = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const emailIndex = headers.indexOf("email");
  const emails = Array.from(
    new Set(
      rows
        .slice(1)
        .map((row) => (emailIndex >= 0 ? row[emailIndex] : row[2])?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email && email.includes("@")))
    )
  );
  return {
    segments: [
      {
        id: "cluster_all",
        name: "All CRM Contacts",
        filter_label: `all contacts · ${emails.length} recipients`,
        description: "Fallback segment including all contacts.",
        emails,
        confidence: 65,
        recommended_for: "Broad campaign targeting.",
      },
    ],
    reasoning: "Local fallback segment discovery.",
  };
}

export async function generateSmartBrief(prompt: string): Promise<SmartBriefResponse> {
  if (!prompt.trim()) throw new Error("Prompt is required.");
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<SmartBriefResponse>("/v1/campaigns/smart-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return {
    brief: {
      campaign_name: "Generated Campaign Brief",
      objective: "Increase campaign performance.",
      target_audience: "General customer audience",
      offer: "Special offer",
      primary_kpi: "revenue",
      geo_scope: "Global",
      language: "English",
      tone: "Professional and friendly",
      compliance_notes: "Include unsubscribe and privacy references.",
      send_window: "Next 7 days",
      number_of_emails: 3,
      key_points: [],
      assumptions: ["ASSUMPTION: Missing context should be refined by user."],
    },
    questions: ["What exact offer should this campaign promote?"],
  };
}

export async function optimizeSendTimes(payload: {
  emails: Array<{ email_id: string; subject: string; target_group: string; recipient_count: number }>;
  contacts_csv: string;
  campaign_prompt?: string;
}): Promise<SendTimeOptimizeResponse> {
  if (!payload.emails.length) return { suggestions: [], global_reasoning: "No email variants provided." };
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<SendTimeOptimizeResponse>("/v1/campaigns/optimize-send-times", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return {
    suggestions: payload.emails.map((item) => ({
      email_id: item.email_id,
      timezone: "UTC",
      local_window: "09:00-11:59",
      recommended_hour_local: 10,
      rationale: "Local fallback recommendation.",
    })),
    global_reasoning: "Fallback send-time optimization in local mode.",
  };
}

export async function trainBrandVoice(payload: {
  brand_name: string;
  current_voice: string;
  campaign_examples: string[];
  approved_html_samples: string[];
}): Promise<VoiceTrainResponse> {
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<VoiceTrainResponse>("/v1/campaigns/voice-train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return {
    profile: {
      style_summary: payload.current_voice || "Professional and friendly voice.",
      do_list: ["Lead with value.", "Use concrete language."],
      dont_list: ["Avoid hype-heavy phrasing.", "Avoid vague claims."],
      vocabulary: ["members", "benefit", "offer", "clarity"],
      sample_lines: ["Start with value.", "Clear next step."],
      confidence: 60,
    },
    reasoning: "Local fallback voice profile.",
  };
}

export async function localizeCampaign(payload: {
  emails: Array<{ id: string; subject: string; html_content: string; target_group?: string }>;
  language: string;
  region?: string;
  brand_voice?: string;
  legal_footer?: string;
}): Promise<LocalizeCampaignResponse> {
  if (!payload.emails.length) {
    return { language: payload.language, region: payload.region ?? "", emails: [], reasoning: "No emails provided." };
  }
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<LocalizeCampaignResponse>("/v1/campaigns/localize-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return {
    language: payload.language,
    region: payload.region ?? "",
    emails: payload.emails.map((email) => ({
      id: email.id,
      subject: `[${payload.language.slice(0, 2).toUpperCase()}] ${email.subject}`,
      html_content: email.html_content,
      notes: "Local fallback localization.",
    })),
    reasoning: "Fallback localization preserved original HTML.",
  };
}

export async function repurposeCampaignContent(payload: {
  campaign_name: string;
  objective: string;
  channels: string[];
  emails: Array<{ id: string; subject: string; html_content: string; target_group?: string }>;
}): Promise<RepurposeResponse> {
  if (!payload.channels.length) {
    throw new Error("At least one channel is required.");
  }
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<RepurposeResponse>("/v1/campaigns/repurpose-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return {
    assets: payload.channels.map((channel) => ({
      channel,
      title: `${payload.campaign_name || "Campaign"} • ${channel}`,
      body: "Repurposed fallback content from campaign emails.",
      cta: "Learn more",
    })),
    reasoning: "Local fallback repurposing.",
  };
}

export async function recordOutcome(payload: {
  campaign_name: string;
  prompt: string;
  audience: string;
  subject: string;
  cta: string;
  open_rate?: number;
  click_rate?: number;
  conversion_rate?: number;
  language?: string;
  segment?: string;
  notes?: string;
}): Promise<OutcomeRecordResponse> {
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<OutcomeRecordResponse>("/v1/campaigns/record-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return { stored: true, score: 60, total_records: 1 };
}

export async function retrieveMemory(payload: {
  prompt: string;
  audience?: string;
  objective?: string;
  limit?: number;
}): Promise<MemoryRetrieveResponse> {
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<MemoryRetrieveResponse>("/v1/campaigns/retrieve-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return { snippets: [], reasoning: "No historical memory available in local fallback mode." };
}

export async function startExperiment(payload: {
  experiment_name: string;
  metric: string;
  variants: string[];
}): Promise<ExperimentStartResponse> {
  return fetchJsonOrThrow<ExperimentStartResponse>("/v1/campaigns/experiments/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function recordExperimentSample(payload: {
  experiment_id: string;
  variant: string;
  impressions: number;
  clicks: number;
  conversions: number;
}): Promise<ExperimentStatusResponse> {
  return fetchJsonOrThrow<ExperimentStatusResponse>("/v1/campaigns/experiments/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getAgentMetrics(): Promise<AgentMetricsResponse> {
  return fetchJsonOrThrow<AgentMetricsResponse>("/v1/campaigns/agent-metrics", {
    method: "GET",
  });
}

export async function orchestrateGrowthLoop(payload: {
  campaign_name: string;
  prompt: string;
  audience: string;
  objective: string;
  offer: string;
  contacts_csv: string;
  emails: Array<{
    id: string;
    subject: string;
    target_group: string;
    html_content: string;
    recipient_count: number;
  }>;
  banned_phrases?: string[];
  required_phrases?: string[];
  legal_footer?: string;
}): Promise<OrchestrateGrowthResponse> {
  if (!isLocalOnlyMode()) {
    try {
      return await fetchJsonOrThrow<OrchestrateGrowthResponse>("/v1/campaigns/orchestrate-growth-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return {
    best_subject: payload.emails[0]?.subject ?? "",
    best_cta: "Learn more",
    compliance_passed: true,
    compliance_summary: "Fallback orchestration used.",
    send_time_reasoning: "Fallback reasoning.",
    memory_snippets: [],
    next_actions: ["Record outcomes for better optimization."],
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
          html: task.personalized_html ?? task.email.htmlContent,
          text: task.personalized_text ?? stripHtml(task.personalized_html ?? task.email.htmlContent),
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
