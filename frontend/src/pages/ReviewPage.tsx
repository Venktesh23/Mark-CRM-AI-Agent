import { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Pencil, Loader2, AlertCircle, Globe, Eye, MousePointerClick, Save, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useCampaignStore } from "@/lib/campaign-store";
import { useCampaignsStore } from "@/lib/campaigns-list-store";
import { editEmail, localizeCampaign } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import type { GeneratedEmail } from "@/lib/api";
import { useRequireGeneratedEmails } from "@/features/campaigns/use-require-generated-emails";
import { getUserErrorMessage } from "@/core/errors/user-message";
import { useBrandStore } from "@/lib/brand-store";

function EmailPreviewCard({
  email,
  index,
  onClick,
}: {
  email: GeneratedEmail;
  index: number;
  onClick: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        onClick={onClick}
        className="group cursor-pointer rounded-xl border border-border bg-card shadow-sm hover:shadow-lg hover:border-primary/40 hover:-translate-y-1 transition-all duration-200 overflow-hidden"
      >
        {/* Card top: index badge + subject */}
        <div className="px-4 pt-4 pb-3 flex items-start gap-2.5">
          <span className="shrink-0 mt-[2px] h-5 w-5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
            {index + 1}
          </span>
          <h3 className="text-[13px] font-semibold text-foreground leading-snug line-clamp-2 tracking-tight flex-1 min-w-0">
            {email.subject}
          </h3>
        </div>

        {/* Email client chrome + iframe preview */}
        <div className="mx-4 mb-3 rounded-lg overflow-hidden border border-border/70 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {/* Fake email-client toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-[7px] bg-[#f2f2f2] border-b border-border/50">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <div className="flex-1 h-3.5 mx-2 rounded-sm bg-white/80 border border-black/8" />
          </div>

          {/* iframe with bottom gradient fade */}
          <div className="relative bg-white" style={{ height: 176 }}>
            <iframe
              srcDoc={email.htmlContent}
              className="pointer-events-none absolute top-0 left-0 origin-top-left"
              style={{ width: 640, height: 528, transform: "scale(0.5)", transformOrigin: "top left" }}
              sandbox=""
              title={email.subject}
            />
            {/* Gradient fade — always visible to mask dead white space */}
            <div
              className="absolute bottom-0 left-0 right-0 h-20 pointer-events-none"
              style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 100%)" }}
            />
            {/* Hover CTA */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <span className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-4 py-1.5 rounded-full shadow-md">
                <Pencil className="h-3 w-3" />
                Open & Edit
              </span>
            </div>
          </div>
        </div>

        {/* Footer: audience */}
        <div className="px-4 pb-4 flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">To</span>
          <span className="text-xs text-muted-foreground truncate">{email.summary.targetGroup}</span>
        </div>
      </div>
    </motion.div>
  );
}

type ModalTab = "preview" | "edit" | "summary";
type EditMode = "ai" | "manual";

/** Named export for testing. The default export (ReviewPage) wraps this. */
export function EmailEditorModal({
  email,
  open,
  onClose,
  onSaved,
  defaultTab = "preview",
}: {
  email: GeneratedEmail | null;
  open: boolean;
  onClose: () => void;
  onSaved: (emailId: string, newHtml: string) => void;
  defaultTab?: ModalTab | "summary" | "edit";
}) {
  const [activeTab, setActiveTab] = useState<ModalTab>("preview");
  const [editMode, setEditMode] = useState<EditMode>("ai");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [displayHtml, setDisplayHtml] = useState("");
  const editableIframeRef = useRef<HTMLIFrameElement>(null);
  const brand = useBrandStore((s) => s.brand);

  useEffect(() => {
    if (email) {
      setDisplayHtml(email.htmlContent);
      setActiveTab((defaultTab as ModalTab) ?? "preview");
      setAiPrompt("");
      setApplyError(null);
    }
  }, [email?.id]);

  const bannerBlock = useMemo(() => {
    const url = brand.designTokens.bannerUrl;
    return url
      ? `<img src="${url}" alt="Campaign banner" style="width:100%;max-width:100%;display:block;" />`
      : `<div style="box-sizing:border-box;width:100%;height:140px;background:linear-gradient(135deg,#f5f7ff 0%,#eef0ff 100%);border-bottom:2px dashed #c7d2fe;display:table;text-align:center;font-family:Arial,sans-serif;">` +
        `<div style="display:table-cell;vertical-align:middle;padding:20px;">` +
        `<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:0.1em;">BANNER PLACEHOLDER</p>` +
        `<p style="margin:0;font-size:10px;color:#818cf8;">Add a banner image in Brand &rarr; Design Settings</p>` +
        `</div></div>`;
  }, [brand.designTokens.bannerUrl]);

  const viewHtml = useMemo(() => {
    if (!displayHtml) return displayHtml;
    return displayHtml.includes("<body")
      ? displayHtml.replace(/<body([^>]*)>/i, `<body$1>${bannerBlock}`)
      : bannerBlock + displayHtml;
  }, [displayHtml, bannerBlock]);

  const editableHtml = useMemo(() => {
    if (!displayHtml) return "";
    return displayHtml.replace(/<body([^>]*)>/i, '<body$1 contenteditable="true" style="outline:none;">');
  }, [displayHtml]);

  if (!email) return null;

  const handleAiEdit = async () => {
    if (!aiPrompt.trim()) return;
    setIsApplying(true);
    setApplyError(null);
    try {
      const newHtml = await editEmail(email.id, displayHtml, email.subject, aiPrompt);
      setDisplayHtml(newHtml);
      onSaved(email.id, newHtml);
      setAiPrompt("");
      toast({ title: "Email updated", description: "AI changes applied." });
    } catch (err) {
      setApplyError(getUserErrorMessage(err, "Edit failed. Retry or enable local-only mode in Settings."));
    } finally {
      setIsApplying(false);
    }
  };

  const handleManualSave = () => {
    const iframe = editableIframeRef.current;
    if (!iframe?.contentDocument) return;
    const raw = iframe.contentDocument.documentElement.outerHTML;
    const clean = raw.replace(/\s*contenteditable="true"/gi, '').replace(/\s*style="outline:none;"/gi, '');
    setDisplayHtml(clean);
    onSaved(email.id, clean);
    toast({ title: "Email saved", description: "Your edits have been saved." });
  };

  const handleModeSwitch = (mode: EditMode) => {
    if (editMode === "manual" && mode === "ai") {
      const iframe = editableIframeRef.current;
      if (iframe?.contentDocument) {
        const raw = iframe.contentDocument.documentElement.outerHTML;
        setDisplayHtml(raw.replace(/\s*contenteditable="true"/gi, '').replace(/\s*style="outline:none;"/gi, ''));
      }
    }
    setEditMode(mode);
  };

  const tabs: { id: ModalTab; label: string; icon: React.ReactNode }[] = [
    { id: "preview", label: "Preview", icon: <Eye className="h-3.5 w-3.5" /> },
    { id: "edit",    label: "Edit",    icon: <Pencil className="h-3.5 w-3.5" /> },
    { id: "summary", label: "Summary", icon: <Sparkles className="h-3.5 w-3.5" /> },
  ];

  const senderDomain = brand.brandName
    ? brand.brandName.toLowerCase().replace(/\s+/g, "") + ".com"
    : "yourbrand.com";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl">
        {/* ── Header ── */}
        <DialogHeader className="flex-shrink-0 border-b border-border bg-card">
          <div className="flex items-center gap-3 px-6 py-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Mail className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-sm font-semibold text-foreground truncate">
                {email.subject}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Campaign email</p>
            </div>
          </div>

          {/* Tab nav — underline style */}
          <div className="flex border-t border-border/60 px-6">
            {tabs.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                  activeTab === id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <DialogDescription className="sr-only">
            Preview, edit, and review this generated campaign email.
          </DialogDescription>
        </DialogHeader>

        {/* ── Content ── */}
        <div className="flex-1 overflow-hidden min-h-0">

          {/* PREVIEW TAB — email client view */}
          {activeTab === "preview" && (
            <div className="h-full overflow-auto bg-[#f0f2f5] p-6">
              <div className="max-w-[620px] mx-auto">
                {/* Email client chrome */}
                <div className="rounded-t-xl bg-card border border-border border-b-0 overflow-hidden shadow-sm">
                  <div className="flex items-center gap-1.5 px-4 py-3 bg-muted/60 border-b border-border/60">
                    <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                    <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                    <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                    <div className="flex-1 h-5 mx-3 rounded-md bg-background border border-border/50 flex items-center px-2">
                      <span className="text-[10px] text-muted-foreground truncate">no-reply@{senderDomain}</span>
                    </div>
                  </div>
                  <div className="px-5 py-4 border-b border-border/60 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                      {(brand.brandName?.[0] ?? "M").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{brand.brandName || "Your Brand"}</span>
                        <span className="text-xs text-muted-foreground">&lt;no-reply@{senderDomain}&gt;</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">to recipient@example.com</p>
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0">Just now</p>
                  </div>
                  <div className="px-5 py-3 border-b border-border/40 bg-muted/20">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Subject</p>
                    <p className="text-base font-semibold text-foreground leading-snug">{email.subject}</p>
                  </div>
                </div>
                {/* Email body with banner */}
                <div className="border border-border border-t-0 rounded-b-xl overflow-hidden bg-white shadow-sm">
                  <iframe
                    srcDoc={viewHtml}
                    className="w-full block"
                    style={{ minHeight: 480, height: 560 }}
                    sandbox=""
                    title="Email preview"
                  />
                </div>
              </div>
            </div>
          )}

          {/* EDIT TAB */}
          {activeTab === "edit" && (
            <div className="flex h-full overflow-hidden">
              {/* Left: readonly preview (AI) or editable iframe (Manual) */}
              <div className="flex-1 overflow-auto bg-muted/20 min-w-0">
                {editMode === "ai" ? (
                  <iframe
                    srcDoc={displayHtml}
                    className="h-full w-full min-h-[500px]"
                    sandbox=""
                    title="Live preview"
                  />
                ) : (
                  <iframe
                    ref={editableIframeRef}
                    srcDoc={editableHtml}
                    className="h-full w-full min-h-[500px] cursor-text"
                    title="Editable email"
                  />
                )}
              </div>

              {/* Right: edit panel */}
              <div className="w-[360px] shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
                {/* Mode toggle */}
                <div className="px-5 pt-5 pb-4 border-b border-border/60 flex-shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">Edit Mode</p>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-muted rounded-lg">
                    <button
                      onClick={() => handleModeSwitch("ai")}
                      className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-md transition-all ${
                        editMode === "ai" ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      AI Edit
                    </button>
                    <button
                      onClick={() => handleModeSwitch("manual")}
                      className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-md transition-all ${
                        editMode === "manual" ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <MousePointerClick className="h-3.5 w-3.5" />
                      Direct Edit
                    </button>
                  </div>
                </div>

                {/* AI Edit panel */}
                {editMode === "ai" && (
                  <div className="flex flex-col gap-4 flex-1 overflow-auto px-5 py-5 min-h-0">
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-1">AI Instructions</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Describe the changes you want. The AI regenerates the email from your instructions.
                      </p>
                    </div>
                    <Textarea
                      placeholder={"\"Make the tone more formal\"\n\"Add a 20% discount code section\"\n\"Shorten the body to 3 sentences\""}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      className="flex-1 min-h-[160px] text-sm resize-none"
                      disabled={isApplying}
                    />
                    {applyError && (
                      <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
                        <p className="text-xs text-destructive leading-relaxed">{applyError}</p>
                      </div>
                    )}
                    <Button onClick={handleAiEdit} disabled={!aiPrompt.trim() || isApplying} className="w-full">
                      {isApplying ? <><Loader2 className="h-4 w-4 animate-spin" />Applying…</> : <><Sparkles className="h-4 w-4" />Apply with AI</>}
                    </Button>
                  </div>
                )}

                {/* Direct Edit panel */}
                {editMode === "manual" && (
                  <div className="flex flex-col gap-5 flex-1 px-5 py-5">
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-1">Direct Text Editing</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Click on any text in the email preview to place your cursor, then type to edit it directly.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3.5 space-y-2">
                      <p className="text-xs font-semibold text-foreground">Tips</p>
                      <ul className="text-xs text-muted-foreground space-y-1.5 leading-relaxed">
                        <li>• Click any text to place your cursor</li>
                        <li>• Select text and type to replace it</li>
                        <li>• Press Ctrl+Z (⌘Z) to undo</li>
                        <li>• Hit Save when done — changes persist</li>
                      </ul>
                    </div>
                    <div className="flex-1" />
                    <Button onClick={handleManualSave} className="w-full">
                      <Save className="h-4 w-4" />
                      Save Changes
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SUMMARY TAB */}
          {activeTab === "summary" && (
            <div className="flex h-full overflow-hidden">
              <div className="flex-1 overflow-auto bg-muted/20">
                <iframe srcDoc={displayHtml} className="h-full w-full min-h-[500px]" sandbox="" title="Email preview" />
              </div>
              <div className="w-[320px] shrink-0 border-l border-border bg-card overflow-auto px-5 py-6">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-5">
                  AI Generation Summary
                </p>
                <div className="space-y-6">
                  {[
                    { label: "Target Group", value: email.summary.targetGroup },
                    { label: "Regional Adaptation", value: email.summary.regionalAdaptation },
                    { label: "Tone & Style", value: email.summary.toneDecision },
                    { label: "Legal Compliance", value: email.summary.legalConsiderations },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                        {item.label}
                      </p>
                      <p className="text-xs text-foreground leading-relaxed">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ReviewPage() {
  const navigate = useNavigate();
  const { generatedEmails, prompt, generationReport, setStep, updateEmailHtml, updateEmailContent } = useCampaignStore();
  const { addCampaign } = useCampaignsStore();
  const brand = useBrandStore((s) => s.brand);
  const [selectedEmail, setSelectedEmail] = useState<GeneratedEmail | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [localizeLanguage, setLocalizeLanguage] = useState("Spanish");
  const [localizeRegion, setLocalizeRegion] = useState("");
  const [isLocalizing, setIsLocalizing] = useState(false);
  const [localizeReasoning, setLocalizeReasoning] = useState<string | null>(null);

  const handleEmailSaved = (emailId: string, newHtml: string) => {
    updateEmailHtml(emailId, newHtml);
    setSelectedEmail((prev) =>
      prev && prev.id === emailId ? { ...prev, htmlContent: newHtml } : prev
    );
  };

  const hasGeneratedEmails = useRequireGeneratedEmails(generatedEmails.length, "/create");
  if (!hasGeneratedEmails) return null;

  const handleSave = () => {
    if (generationReport && !generationReport.guardrails_passed) {
      toast({
        title: "Guardrails failed",
        description: "Fix risky content before saving this campaign.",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    const id = crypto.randomUUID();
    const name =
      prompt.trim().slice(0, 60).trim() +
      (prompt.trim().length > 60 ? "…" : "");
    addCampaign({
      id,
      name: name || "Untitled Campaign",
      status: "draft",
      createdAt: new Date().toISOString(),
      prompt: prompt.trim(),
      emails: generatedEmails,
      approvals: {},
      emailAssignments: {},
      aiReport: generationReport,
      sendTimePlan: null,
      repurposedContent: null,
    });
    setStep(1);
    navigate(`/campaigns/${id}`);
  };

  const handleLocalizeAll = async () => {
    if (!generatedEmails.length) return;
    setIsLocalizing(true);
    try {
      const result = await localizeCampaign({
        emails: generatedEmails.map((email) => ({
          id: email.id,
          subject: email.subject,
          html_content: email.htmlContent,
          target_group: email.summary.targetGroup,
        })),
        language: localizeLanguage,
        region: localizeRegion,
        brand_voice: brand.voiceGuidelines,
        legal_footer: brand.legalFooter,
      });
      for (const localized of result.emails) {
        const existing = generatedEmails.find((email) => email.id === localized.id);
        if (!existing) continue;
        updateEmailContent(localized.id, {
          subject: localized.subject || existing.subject,
          htmlContent: localized.html_content || existing.htmlContent,
        });
      }
      setLocalizeReasoning(result.reasoning || null);
      toast({
        title: "Localization complete",
        description: `Localized ${result.emails.length} emails to ${result.language}${result.region ? ` (${result.region})` : ""}.`,
      });
    } catch (err) {
      toast({
        title: "Localization failed",
        description: getUserErrorMessage(err, "Could not localize campaign emails."),
        variant: "destructive",
      });
    } finally {
      setIsLocalizing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="text-center space-y-2"
      >
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Review Your <span className="gradient-text">Campaign</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Click any email card to preview and edit. Make adjustments before saving.
        </p>
      </motion.div>

      {/* Email cards */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {generatedEmails.map((email, index) => (
          <EmailPreviewCard
            key={email.id}
            email={email}
            index={index}
            onClick={() => setSelectedEmail(email)}
          />
        ))}
      </div>

      {/* AI Quality Dashboard */}
      {generationReport ? (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">AI Quality Dashboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Score</p>
                <p className="text-base font-bold text-foreground">{generationReport.quality_score ?? "—"}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Tokens</p>
                <p className="text-base font-bold text-foreground">{generationReport.tokens_estimate ?? "—"}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Latency</p>
                <p className="text-base font-bold text-foreground">
                  {generationReport.timings_ms?.total_ms ? `${generationReport.timings_ms.total_ms}ms` : "—"}
                </p>
              </div>
            </div>
            {generationReport.risk_flags.length > 0 ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 space-y-1.5">
                {generationReport.risk_flags.slice(0, 3).map((flag) => (
                  <p key={flag} className="text-destructive leading-relaxed">{flag}</p>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <p>All guardrails passed.</p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Localization */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            Localization Agent
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Target Language</label>
              <Textarea
                value={localizeLanguage}
                onChange={(e) => setLocalizeLanguage(e.target.value)}
                className="min-h-[44px] text-sm resize-none"
                placeholder="e.g. Spanish"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Region (optional)</label>
              <Textarea
                value={localizeRegion}
                onChange={(e) => setLocalizeRegion(e.target.value)}
                className="min-h-[44px] text-sm resize-none"
                placeholder="e.g. Mexico City"
              />
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={handleLocalizeAll} disabled={isLocalizing || !localizeLanguage.trim()}>
            {isLocalizing ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Localizing…</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5" />Localize All Emails</>
            )}
          </Button>
          {localizeReasoning && (
            <p className="text-xs text-muted-foreground leading-relaxed">{localizeReasoning}</p>
          )}
        </CardContent>
      </Card>

      {/* Save */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex justify-center pb-8"
      >
        <Button
          size="lg"
          className="h-11 px-10 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleSave}
          disabled={isSaving || (generationReport ? !generationReport.guardrails_passed : false)}
        >
          {isSaving ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
          ) : (
            <>Save Campaign<ArrowRight className="h-4 w-4" /></>
          )}
        </Button>
      </motion.div>

      <EmailEditorModal
        email={selectedEmail}
        open={!!selectedEmail}
        onClose={() => setSelectedEmail(null)}
        onSaved={handleEmailSaved}
      />
    </div>
  );
}
