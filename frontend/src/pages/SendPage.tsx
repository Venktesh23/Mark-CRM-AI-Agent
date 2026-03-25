import { useState, useMemo, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Mail, Users, CheckCircle2, Settings2, Sparkles, Link2, ShieldAlert, TrendingUp } from "lucide-react";
import ConfigureMailingDialog from "@/components/ConfigureMailingDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useCampaignStore } from "@/lib/campaign-store";
import { useHubSpotContactsStore } from "@/lib/hubspot-contacts-store";
import { useHubSpotStore } from "@/lib/hubspot-store";
import { scoreSegment } from "@/lib/crm-parser";
import {
  discoverAudienceSegments,
  getEmailConfig,
  orchestrateGrowthLoop,
  getPerformanceCopilot,
  optimizeSendTimes,
  predictVariants,
  recordOutcome,
  startExperiment,
  runComplianceAssistant,
  sendCampaign,
  recommendRecipients,
  type CampaignSendTask,
  type OrchestrateGrowthResponse,
  type PerformanceCopilotResponse,
  type DiscoveredSegment,
  type SendTimeSuggestion,
} from "@/lib/api";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCampaignsStore } from "@/lib/campaigns-list-store";
import { safeAsync } from "@/core/async/safe-async";
import { getHubspotAuthUrl } from "@/features/integrations/hubspot-client";
import { useRequireGeneratedEmails } from "@/features/campaigns/use-require-generated-emails";
import { getUserErrorMessage } from "@/core/errors/user-message";
import { useBrandStore } from "@/lib/brand-store";

type ContactProfile = Record<string, string>;

function parseCsvRecords(csv: string): string[][] {
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
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseContactsCsvMap(csv: string | null): Map<string, ContactProfile> {
  if (!csv?.trim()) return new Map();
  const records = parseCsvRecords(csv.trim());
  if (records.length < 2) return new Map();
  const headers = records[0].map((h) => h.trim().toLowerCase());
  const map = new Map<string, ContactProfile>();
  for (const values of records.slice(1)) {
    const profile: ContactProfile = {};
    headers.forEach((h, idx) => {
      profile[h] = (values[idx] ?? "").trim();
    });
    const email = (profile.email ?? "").toLowerCase();
    if (email.includes("@")) map.set(email, profile);
  }
  return map;
}

function firstNonEmpty(...vals: Array<string | undefined>): string {
  for (const val of vals) {
    if (val && val.trim()) return val.trim();
  }
  return "";
}

function personalizeTemplate(html: string, profile: ContactProfile | undefined): string {
  const firstName = firstNonEmpty(profile?.firstname, profile?.first_name, "there");
  const lastName = firstNonEmpty(profile?.lastname, profile?.last_name, "");
  const fullName = firstNonEmpty(`${firstName} ${lastName}`.trim(), firstName, "there");
  const city = firstNonEmpty(profile?.city, "your area");
  const country = firstNonEmpty(profile?.country, "your region");
  const membership = firstNonEmpty(profile?.membership_level, "member");

  const replacements: Record<string, string> = {
    first_name: escapeHtml(firstName),
    last_name: escapeHtml(lastName),
    full_name: escapeHtml(fullName),
    city: escapeHtml(city),
    country: escapeHtml(country),
    membership_level: escapeHtml(membership),
  };

  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)(?:\|([^}]+))?\s*\}\}/g, (_, token: string, fallback?: string) => {
    const key = token.toLowerCase();
    const val = replacements[key];
    if (val && val.trim()) return val.trim();
    return escapeHtml((fallback ?? "").trim());
  });
}

function extractCtaCandidates(html: string): string[] {
  const anchorTexts = Array.from(html.matchAll(/<a\b[^>]*>(.*?)<\/a>/gis))
    .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return Array.from(new Set(anchorTexts)).slice(0, 6);
}

function applyBestCta(html: string, cta: string): string {
  if (!cta.trim()) return html;
  return html.replace(/(<a\b[^>]*>)([\s\S]*?)(<\/a>)/i, `$1${cta}$3`);
}

export default function SendPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const campaignId = (location.state as { campaignId?: string } | null)?.campaignId ?? null;
  const { generatedEmails, emailAssignments, setRecipients, reset, prompt: storePrompt } = useCampaignStore();
  const { updateCampaign, campaigns } = useCampaignsStore();
  const { segments, rawContactsCsv } = useHubSpotContactsStore();
  const { connected } = useHubSpotStore();
  const brand = useBrandStore((s) => s.brand);
  const campaignRecord = campaignId ? campaigns.find((c) => c.id === campaignId) ?? null : null;

  // Resolve the campaign prompt — prefer the saved campaign record, fall back to the in-flight store
  const campaignPrompt = campaignRecord?.prompt ?? storePrompt ?? null;
  const campaignGuardrailsPassed =
    campaignRecord?.aiReport?.guardrails_passed ?? true;
  const [configuredFromEmail, setConfiguredFromEmail] = useState("");

  // Fetch the configured sender email from the backend once
  useEffect(() => {
    safeAsync(async () => {
      const data = await getEmailConfig();
      if (data?.from_email) setConfiguredFromEmail(data.from_email);
    });
  }, []);
  const [isSending, setIsSending] = useState(false);
  const [isAiMatching, setIsAiMatching] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [selectedSegments, setSelectedSegments] = useState<Record<string, string[]>>({});
  const [complianceSummary, setComplianceSummary] = useState<string | null>(null);
  const [complianceBlockingIssues, setComplianceBlockingIssues] = useState<string[]>([]);
  const [performanceCopilot, setPerformanceCopilot] = useState<PerformanceCopilotResponse | null>(null);
  const [orchestration, setOrchestration] = useState<OrchestrateGrowthResponse | null>(null);
  const [startedExperiments, setStartedExperiments] = useState<Array<{ emailId: string; experimentId: string }>>([]);
  const [observedOpenRate, setObservedOpenRate] = useState("");
  const [observedClickRate, setObservedClickRate] = useState("");
  const [observedConversionRate, setObservedConversionRate] = useState("");
  const [savingOutcomes, setSavingOutcomes] = useState(false);
  const [outcomesSaved, setOutcomesSaved] = useState(false);
  const [discoveredSegments, setDiscoveredSegments] = useState<DiscoveredSegment[]>([]);
  const [segmentDiscoveryReasoning, setSegmentDiscoveryReasoning] = useState<string | null>(null);
  const [sendTimeByEmail, setSendTimeByEmail] = useState<Record<string, SendTimeSuggestion>>({});
  const [sendTimeReasoning, setSendTimeReasoning] = useState<string | null>(null);
  const [isOptimizingSendTime, setIsOptimizingSendTime] = useState(false);

  const mergedSegments = useMemo(() => {
    const byId = new Map<string, typeof segments[number]>();
    for (const seg of segments) byId.set(seg.id, seg);
    for (const seg of discoveredSegments) {
      if (!byId.has(seg.id)) {
        byId.set(seg.id, {
          id: seg.id,
          name: seg.name,
          filterLabel: seg.filter_label,
          emails: seg.emails,
        });
      }
    }
    return Array.from(byId.values());
  }, [segments, discoveredSegments]);

  const suggestedSegments = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const email of generatedEmails) {
      const suggested = new Set<string>();
      for (const seg of mergedSegments) {
        if (scoreSegment(seg, email.summary.targetGroup) > 0) suggested.add(seg.id);
      }
      result[email.id] = suggested;
    }
    return result;
  }, [generatedEmails, mergedSegments]);

  // Auto-trigger AI match on first render if contacts CSV is available
  const autoMatchRef = useRef(false);
  useEffect(() => {
    const plan = campaignRecord?.sendTimePlan;
    if (!plan) return;
    const byEmail: Record<string, SendTimeSuggestion> = {};
    for (const suggestion of plan.suggestions ?? []) {
      byEmail[suggestion.email_id] = suggestion;
    }
    setSendTimeByEmail(byEmail);
    setSendTimeReasoning(plan.globalReasoning || null);
  }, [campaignRecord]);

  useEffect(() => {
    if (!rawContactsCsv || generatedEmails.length === 0) {
      setDiscoveredSegments([]);
      setSegmentDiscoveryReasoning(null);
      return;
    }
    safeAsync(async () => {
      try {
        const discovered = await discoverAudienceSegments({
          contacts_csv: rawContactsCsv,
          max_segments: 8,
          campaign_prompt: campaignPrompt ?? "",
        });
        setDiscoveredSegments(discovered.segments ?? []);
        setSegmentDiscoveryReasoning(discovered.reasoning || null);
      } catch {
        setDiscoveredSegments([]);
        setSegmentDiscoveryReasoning(null);
      }
    });
  }, [rawContactsCsv, generatedEmails.length, campaignPrompt]);

  useEffect(() => {
    if (autoMatchRef.current || !rawContactsCsv || generatedEmails.length === 0) return;
    autoMatchRef.current = true;
    setIsAiMatching(true);
    recommendRecipients(
      generatedEmails.map((e) => ({ id: e.id, subject: e.subject, target_group: e.summary.targetGroup })),
      rawContactsCsv,
      campaignPrompt ?? undefined
    )
      .then(({ assignments, reasoning }) => {
        for (const [emailId, addrs] of Object.entries(assignments)) {
          setRecipients(emailId, addrs);
        }
        setSelectedSegments({});
        setAiReasoning(reasoning || null);
      })
      .catch((err) => {
        toast({
          title: "AI matching failed",
          description: err instanceof Error ? err.message : "Could not reach the AI service.",
          variant: "destructive",
        });
      })
      .finally(() => setIsAiMatching(false));
  }, [rawContactsCsv, generatedEmails, campaignPrompt, setRecipients]);

  // Fall back to keyword-segment matching only if no CSV is available
  useEffect(() => {
    if (rawContactsCsv || mergedSegments.length === 0 || generatedEmails.length === 0) return;
    const next: Record<string, string[]> = {};
    let anyApplied = false;
    for (const email of generatedEmails) {
      const suggested = [...(suggestedSegments[email.id] ?? [])];
      if (suggested.length === 0) continue;
      next[email.id] = suggested;
      const allEmails = mergedSegments
        .filter((s) => suggested.includes(s.id))
        .flatMap((s) => s.emails);
      setRecipients(email.id, Array.from(new Set(allEmails)));
      anyApplied = true;
    }
    if (anyApplied) setSelectedSegments(next);
  }, [rawContactsCsv, mergedSegments, generatedEmails, setRecipients, suggestedSegments]);

  const hasGeneratedEmails = useRequireGeneratedEmails(generatedEmails.length, "/");
  if (!hasGeneratedEmails) return null;

  const handleAddRecipients = (emailId: string, value: string) => {
    const emails = value
      .split(/[,\n]/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    setRecipients(emailId, emails);
  };

  const handleToggleSegment = (emailId: string, segId: string) => {
    setSelectedSegments((prev) => {
      const current = prev[emailId] ?? [];
      const isSelected = current.includes(segId);
      const updated = isSelected
        ? current.filter((id) => id !== segId)
        : [...current, segId];

      const allEmails = mergedSegments
        .filter((s) => updated.includes(s.id))
        .flatMap((s) => s.emails);
      setRecipients(emailId, Array.from(new Set(allEmails)));

      return { ...prev, [emailId]: updated };
    });
  };

  const handleAiMatch = async () => {
    if (!rawContactsCsv) return;
    setIsAiMatching(true);
    try {
      const emailSpecs = generatedEmails.map((e) => ({
        id: e.id,
        subject: e.subject,
        target_group: e.summary.targetGroup,
      }));
      const { assignments, reasoning } = await recommendRecipients(emailSpecs, rawContactsCsv, campaignPrompt ?? undefined);
      const next: Record<string, string[]> = {};
      for (const [emailId, addrs] of Object.entries(assignments)) {
        next[emailId] = addrs;
        setRecipients(emailId, addrs);
      }
      setSelectedSegments({});
      setAiReasoning(reasoning || null);
      toast({
        title: "AI recipients matched",
        description: reasoning || "Contacts assigned to each email variant.",
      });
    } catch (err) {
      toast({
        title: "AI matching failed",
        description: getUserErrorMessage(
          err,
          "Could not match recipients. Try local-only mode in Settings and retry."
        ),
        variant: "destructive",
      });
    } finally {
      setIsAiMatching(false);
    }
  };

  const handleAutoSelect = () => {
    const next: Record<string, string[]> = {};
    for (const email of generatedEmails) {
      const suggested = [...(suggestedSegments[email.id] ?? [])];
      next[email.id] = suggested;
      const allEmails = mergedSegments
        .filter((s) => suggested.includes(s.id))
        .flatMap((s) => s.emails);
      setRecipients(email.id, Array.from(new Set(allEmails)));
    }
    setSelectedSegments(next);
    toast({ title: "Audiences applied", description: "Suggested segments selected for each variant." });
  };

  const totalRecipients = Object.values(emailAssignments).reduce(
    (acc, r) => acc + r.length,
    0
  );

  const hasSuggestions = generatedEmails.some(
    (e) => (suggestedSegments[e.id]?.size ?? 0) > 0
  );

  const handleOpenConfig = async () => {
    if (!rawContactsCsv || generatedEmails.length === 0) {
      setSendTimeByEmail({});
      setSendTimeReasoning(null);
      setShowConfigDialog(true);
      return;
    }
    setIsOptimizingSendTime(true);
    try {
      const optimization = await optimizeSendTimes({
        emails: generatedEmails.map((email) => ({
          email_id: email.id,
          subject: email.subject,
          target_group: email.summary.targetGroup,
          recipient_count: emailAssignments[email.id]?.length ?? 0,
        })),
        contacts_csv: rawContactsCsv,
        campaign_prompt: campaignPrompt ?? "",
      });
      const byEmail: Record<string, SendTimeSuggestion> = {};
      for (const suggestion of optimization.suggestions ?? []) {
        byEmail[suggestion.email_id] = suggestion;
      }
      setSendTimeByEmail(byEmail);
      setSendTimeReasoning(optimization.global_reasoning || null);
      if (campaignId) {
        updateCampaign(campaignId, {
          sendTimePlan: {
            suggestions: optimization.suggestions ?? [],
            globalReasoning: optimization.global_reasoning || "",
          },
        });
      }
    } catch {
      setSendTimeByEmail({});
      setSendTimeReasoning(null);
    } finally {
      setIsOptimizingSendTime(false);
      setShowConfigDialog(true);
    }
  };

  const handleSend = async (config: {
    fromEmail: string;
    replyTo: string;
    plainTexts: Record<string, string>;
    subjects: Record<string, string>;
  }) => {
    setComplianceBlockingIssues([]);
    setComplianceSummary(null);
    setPerformanceCopilot(null);
    setOrchestration(null);
    setStartedExperiments([]);
    setOutcomesSaved(false);
    if (!campaignGuardrailsPassed) {
      toast({
        title: "Guardrails failed",
        description: "Resolve AI risk flags in review before sending.",
        variant: "destructive",
      });
      return;
    }
    const contactsByEmail = parseContactsCsvMap(rawContactsCsv);
    const subjectRecommendationMap = new Map(
      (campaignRecord?.aiReport?.subject_recommendations ?? []).map((item) => [item.email_id, item])
    );

    const predictedByEmail = new Map<string, { subject: string; cta: string }>();
    const subjectOptionsByEmail = new Map<string, string[]>();
    await Promise.all(
      generatedEmails.map(async (email) => {
        const recommendation = subjectRecommendationMap.get(email.id);
        const subjectOptions = Array.from(
          new Set(
            [
              config.subjects[email.id]?.trim(),
              recommendation?.recommended,
              ...(recommendation?.alternatives ?? []),
              email.subject,
            ].filter((v): v is string => Boolean(v && v.trim()))
          )
        );
        if (!subjectOptions.length) return;
        subjectOptionsByEmail.set(email.id, subjectOptions);
        const ctaOptions = extractCtaCandidates(email.htmlContent);
        try {
          const predicted = await predictVariants({
            subject_options: subjectOptions,
            cta_options: ctaOptions,
            audience: email.summary.targetGroup,
            offer: campaignPrompt ?? "",
            objective: "Maximize opens and clicks while preserving trust.",
          });
          predictedByEmail.set(email.id, {
            subject: predicted.best_subject || subjectOptions[0],
            cta: predicted.best_cta || "",
          });
        } catch {
          predictedByEmail.set(email.id, { subject: subjectOptions[0], cta: ctaOptions[0] ?? "" });
        }
      })
    );

    if (generatedEmails.length > 0) {
      try {
        const orchestrationResponse = await orchestrateGrowthLoop({
          campaign_name: campaignRecord?.name ?? "Campaign",
          prompt: campaignPrompt ?? "",
          audience: generatedEmails[0]?.summary.targetGroup ?? "",
          objective: "Maximize opens, clicks, and downstream conversion quality.",
          offer: campaignPrompt ?? "",
          contacts_csv: rawContactsCsv ?? "",
          emails: generatedEmails.map((email) => ({
            id: email.id,
            subject: predictedByEmail.get(email.id)?.subject ?? email.subject,
            target_group: email.summary.targetGroup,
            html_content: email.htmlContent,
            recipient_count: emailAssignments[email.id]?.length ?? 0,
          })),
          banned_phrases: brand.bannedPhrases,
          required_phrases: brand.requiredPhrases,
          legal_footer: brand.legalFooter,
        });
        setOrchestration(orchestrationResponse);
      } catch {
        setOrchestration(null);
      }
    }

    const preflightEmails = generatedEmails
      .filter((email) => (emailAssignments[email.id]?.length ?? 0) > 0)
      .map((email) => ({
        id: email.id,
        subject: predictedByEmail.get(email.id)?.subject || config.subjects[email.id]?.trim() || email.subject,
        html_content: email.htmlContent,
      }));

    const compliance = await runComplianceAssistant({
      emails: preflightEmails,
      banned_phrases: brand.bannedPhrases,
      required_phrases: brand.requiredPhrases,
      legal_footer: brand.legalFooter,
    });
    setComplianceSummary(compliance.summary);
    const blocking = compliance.emails.flatMap((item) =>
      item.risk_flags.map((flag) => `Email ${item.id}: ${flag}`)
    );
    setComplianceBlockingIssues(blocking.slice(0, 4));
    if (!compliance.passed) {
      toast({
        title: "Compliance assistant blocked send",
        description: blocking[0] ?? compliance.summary,
        variant: "destructive",
      });
      return;
    }

    const tasks: CampaignSendTask[] = [];
    for (const email of generatedEmails) {
      const recipients = emailAssignments[email.id] ?? [];
      if (recipients.length === 0 || !email.htmlContent) continue;
      const subject =
        predictedByEmail.get(email.id)?.subject ||
        config.subjects[email.id]?.trim() ||
        email.subject;

      for (const recipient of recipients) {
        const profile = contactsByEmail.get(recipient.trim().toLowerCase());
        const ctaAdjustedHtml = applyBestCta(
          email.htmlContent,
          predictedByEmail.get(email.id)?.cta ?? ""
        );
        const personalizedHtml = personalizeTemplate(ctaAdjustedHtml, profile);
        tasks.push({
          email,
          recipient,
          subject,
          personalized_html: personalizedHtml,
        });
      }
    }

    if (tasks.length === 0) {
      toast({
        title: "No recipients",
        description: "Select at least one audience segment or add emails manually.",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    try {
      const { sent, failed } = await sendCampaign(tasks);

      if (failed.length > 0 && sent === 0) {
        toast({ title: "Send failed", description: failed[0].error, variant: "destructive" });
        return;
      }

      setSent(true);
      setShowConfigDialog(false);
      if (campaignId) updateCampaign(campaignId, { status: "sent" });

      const copilot = await getPerformanceCopilot({
        campaign_name: campaignRecord?.name ?? "Campaign",
        prompt: campaignPrompt ?? "",
        sent_count: sent,
        failed_count: failed.length,
        notes: compliance.summary,
      });
      setPerformanceCopilot(copilot);

      const experiments: Array<{ emailId: string; experimentId: string }> = [];
      for (const email of generatedEmails) {
        const options = subjectOptionsByEmail.get(email.id) ?? [];
        if (options.length < 2) continue;
        try {
          const exp = await startExperiment({
            experiment_name: `${campaignRecord?.name ?? "Campaign"}-${email.id}-subject`,
            metric: "click_rate",
            variants: options.slice(0, 3),
          });
          experiments.push({ emailId: email.id, experimentId: exp.experiment_id });
        } catch {
          // Best-effort experiment tracking should not block send flow.
        }
      }
      setStartedExperiments(experiments);

      if (failed.length > 0) {
        toast({
          title: `Sent ${sent}, failed ${failed.length}`,
          description: `Could not reach: ${failed.map((f) => f.recipient).join(", ")}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Campaign sent!",
          description: `${sent} email${sent !== 1 ? "s" : ""} delivered successfully.`,
        });
      }
    } catch (err) {
      toast({
        title: "Send failed",
        description: getUserErrorMessage(
          err,
          "Could not send campaign. Confirm email config in backend and retry."
        ),
        variant: "destructive",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveObservedOutcomes = async () => {
    const parsePct = (value: string): number | undefined => {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
      return n / 100;
    };
    const openRate = parsePct(observedOpenRate);
    const clickRate = parsePct(observedClickRate);
    const conversionRate = parsePct(observedConversionRate);
    if (openRate === undefined && clickRate === undefined && conversionRate === undefined) {
      toast({
        title: "Add at least one metric",
        description: "Enter observed open/click/conversion rate percentages before saving outcomes.",
        variant: "destructive",
      });
      return;
    }
    setSavingOutcomes(true);
    try {
      const saveOps = generatedEmails.map((email) =>
        recordOutcome({
          campaign_name: campaignRecord?.name ?? "Campaign",
          prompt: campaignPrompt ?? "",
          audience: email.summary.targetGroup,
          subject: email.subject,
          cta: "",
          open_rate: openRate,
          click_rate: clickRate,
          conversion_rate: conversionRate,
          language: "English",
          segment: selectedSegments[email.id]?.join(", ") ?? "",
          notes: "Observed rates entered by user after send.",
        })
      );
      await Promise.all(saveOps);
      setOutcomesSaved(true);
      toast({
        title: "Outcomes saved",
        description: "Learning memory updated using observed campaign metrics.",
      });
    } catch (err) {
      toast({
        title: "Could not save outcomes",
        description: getUserErrorMessage(err, "Please retry saving observed metrics."),
        variant: "destructive",
      });
    } finally {
      setSavingOutcomes(false);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-6">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200 }}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary/10">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-center space-y-2"
        >
          <h1 className="text-2xl font-bold text-foreground">Campaign Sent</h1>
          <p className="text-sm text-muted-foreground">
            {totalRecipients} emails have been queued for delivery.
          </p>
        </motion.div>
        {complianceSummary && (
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Compliance Assistant v1
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{complianceSummary}</p>
            {complianceBlockingIssues.length > 0 && (
              <p className="mt-1 text-xs text-destructive">{complianceBlockingIssues[0]}</p>
            )}
          </div>
        )}
        {performanceCopilot && (
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              Campaign Performance Copilot
            </div>
            <p className="text-xs text-muted-foreground">{performanceCopilot.summary}</p>
            <ul className="text-xs text-foreground space-y-1 list-disc pl-4">
              {performanceCopilot.next_actions.slice(0, 3).map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </div>
        )}
        {orchestration && (
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Cross-Agent Orchestration
            </div>
            <p className="text-xs text-muted-foreground">{orchestration.compliance_summary}</p>
            <p className="text-xs text-foreground">
              Best subject: <span className="font-medium">{orchestration.best_subject || "N/A"}</span> | Best CTA:{" "}
              <span className="font-medium">{orchestration.best_cta || "N/A"}</span>
            </p>
            <ul className="text-xs text-foreground space-y-1 list-disc pl-4">
              {orchestration.next_actions.slice(0, 3).map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </div>
        )}
        {startedExperiments.length > 0 && (
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              Experimentation Tracking
            </div>
            <p className="text-xs text-muted-foreground">
              Experiments were started without synthetic samples. Record real engagement events to determine winners.
            </p>
            <ul className="text-xs text-foreground space-y-1 list-disc pl-4">
              {startedExperiments.map(({ emailId, experimentId }) => (
                <li key={emailId}>
                  {emailId}: {experimentId}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <TrendingUp className="h-4 w-4 text-primary" />
            Closed-Loop Outcomes
          </div>
          <p className="text-xs text-muted-foreground">
            Enter observed rates (0-100) once data is available, then save to improve memory retrieval quality.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              inputMode="decimal"
              placeholder="Open rate %"
              value={observedOpenRate}
              onChange={(e) => setObservedOpenRate(e.target.value)}
            />
            <Input
              inputMode="decimal"
              placeholder="Click rate %"
              value={observedClickRate}
              onChange={(e) => setObservedClickRate(e.target.value)}
            />
            <Input
              inputMode="decimal"
              placeholder="Conversion rate %"
              value={observedConversionRate}
              onChange={(e) => setObservedConversionRate(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={handleSaveObservedOutcomes} disabled={savingOutcomes || outcomesSaved}>
            {outcomesSaved ? "Outcomes Saved" : savingOutcomes ? "Saving..." : "Save Observed Outcomes"}
          </Button>
        </div>
        {campaignId ? (
          <Button variant="outline" onClick={() => { reset(); navigate("/campaigns"); }}>
            Back to Campaigns
          </Button>
        ) : (
          <Button variant="outline" onClick={() => { reset(); navigate("/"); }}>
            Create New Campaign
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="text-center space-y-3"
      >
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Send Your <span className="gradient-text">Campaign</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Assign an audience to each email variant and send.
        </p>
      </motion.div>

      {/* AI match banner — visible whenever contacts CSV is loaded */}
      {rawContactsCsv && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-xs text-primary font-medium">
                {isAiMatching ? "Matching contacts to email variants…" : "AI-powered recipient matching"}
              </p>
              {aiReasoning && !isAiMatching && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{aiReasoning}</p>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 border-primary/40 text-primary hover:bg-primary/10 shrink-0"
            onClick={handleAiMatch}
            disabled={isAiMatching}
          >
            {isAiMatching ? "Matching…" : "Re-match"}
          </Button>
        </motion.div>
      )}

      {rawContactsCsv && segmentDiscoveryReasoning && discoveredSegments.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-border bg-card px-4 py-3"
        >
          <p className="text-xs font-medium text-foreground">
            Audience Segment Discovery: {discoveredSegments.length} suggested clusters
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{segmentDiscoveryReasoning}</p>
        </motion.div>
      )}

      {/* Auto-select banner — keyword segment suggestions (no CSV) */}
      {!rawContactsCsv && mergedSegments.length > 0 && hasSuggestions && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-emerald-500 shrink-0" />
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              Mark matched your email variants to HubSpot audience segments.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 shrink-0"
            onClick={handleAutoSelect}
          >
            Apply suggestions
          </Button>
        </motion.div>
      )}

      {complianceBlockingIssues.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <p className="text-xs font-medium text-destructive">Pre-send compliance issues found</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{complianceBlockingIssues[0]}</p>
        </motion.div>
      )}

      {/* Email cards */}
      <div className="space-y-4">
        {generatedEmails.map((email, index) => (
          <motion.div
            key={email.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            {generatedEmails.length > 1 && (
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                Email {index + 1}
              </p>
            )}
            <Card className="border-border">
              <CardHeader className="pb-3 px-5 pt-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10">
                    <Mail className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm font-semibold font-sans">
                      {email.subject}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {email.summary.targetGroup}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono-display">
                    <Users className="h-3 w-3" />
                    {emailAssignments[email.id]?.length || 0}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="px-5 pb-5 space-y-3">
                <Tabs
                  defaultValue={connected && mergedSegments.length > 0 ? "audiences" : "manual"}
                  className="w-full"
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="audiences" className="flex-1 text-xs">
                      <Users className="h-3 w-3 mr-1.5" />
                      Audiences
                    </TabsTrigger>
                    <TabsTrigger value="manual" className="flex-1 text-xs">
                      <Mail className="h-3 w-3 mr-1.5" />
                      Manual
                    </TabsTrigger>
                  </TabsList>

                  {/* Audiences tab */}
                  <TabsContent value="audiences" className="mt-3">
                    {!connected ? (
                      <div className="flex flex-col items-center gap-3 py-6 text-center">
                        <Link2 className="h-5 w-5 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground max-w-xs">
                          Connect HubSpot to automatically pull your contact segments here.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={() => (window.location.href = getHubspotAuthUrl())}
                        >
                          Connect HubSpot
                        </Button>
                      </div>
                    ) : mergedSegments.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-6 text-center">
                        <p className="text-xs text-muted-foreground">
                          No contact segments found in your HubSpot account.
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Reconnect HubSpot if you've added contacts recently.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {mergedSegments.map((seg) => {
                          const isSuggested = suggestedSegments[email.id]?.has(seg.id) ?? false;
                          const isChecked = selectedSegments[email.id]?.includes(seg.id) ?? false;
                          return (
                            <div
                              key={seg.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleToggleSegment(email.id, seg.id)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggleSegment(email.id, seg.id); } }}
                              className={[
                                "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-xs transition-colors text-left cursor-pointer",
                                isChecked
                                  ? "border-primary/50 bg-primary/5"
                                  : "border-border bg-card hover:bg-accent/50",
                              ].join(" ")}
                            >
                              <Checkbox
                                checked={isChecked}
                                className="pointer-events-none shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium text-foreground">{seg.name}</span>
                                  {isSuggested && (
                                    <Badge className="text-[9px] px-1.5 py-0 h-4 bg-primary/15 text-primary border-0 rounded gap-0.5">
                                      <Sparkles className="h-2.5 w-2.5" />
                                      Suggested
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {seg.filterLabel}
                                </p>
                              </div>
                            </div>
                          );
                        })}

                        {(emailAssignments[email.id]?.length ?? 0) > 0 && (
                          <p className="text-[10px] text-muted-foreground pt-1 pl-1">
                            {emailAssignments[email.id].length} unique recipient
                            {emailAssignments[email.id].length !== 1 ? "s" : ""} selected
                          </p>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* Manual tab */}
                  <TabsContent value="manual" className="mt-3">
                    <Textarea
                      placeholder="Enter email addresses separated by commas or new lines..."
                      className="min-h-[80px] text-xs"
                      value={emailAssignments[email.id]?.join(", ") || ""}
                      onChange={(e) => handleAddRecipients(email.id, e.target.value)}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Summary */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Campaign Summary</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {generatedEmails.length} email{generatedEmails.length !== 1 ? "s" : ""} ·{" "}
                  {totalRecipients} total recipient{totalRecipients !== 1 ? "s" : ""}
                </p>
              </div>
              <Button
                size="lg"
                className="h-11 px-8 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleOpenConfig}
                disabled={totalRecipients === 0 || isOptimizingSendTime}
              >
                <Settings2 className="h-4 w-4" />
                {isOptimizingSendTime ? "Optimizing…" : "Configure Mailing"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <ConfigureMailingDialog
        open={showConfigDialog}
        onOpenChange={setShowConfigDialog}
        emails={generatedEmails}
        emailAssignments={emailAssignments}
        defaultFromEmail={configuredFromEmail}
        sendTimeByEmail={sendTimeByEmail}
        sendTimeReasoning={sendTimeReasoning}
        onSend={handleSend}
        isSending={isSending}
      />
    </div>
  );
}

