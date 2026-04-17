import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Sparkles,
  Pencil,
  CheckCircle2,
  XCircle,
  Mail,
  Loader2,
  Eye,
  MousePointerClick,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useBrandStore } from "@/lib/brand-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useCampaignsStore,
  type CampaignStatus,
} from "@/lib/campaigns-list-store";
import { useCampaignStore } from "@/lib/campaign-store";
import { editEmail, repurposeCampaignContent } from "@/lib/api";
import type { GeneratedEmail } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { getUserErrorMessage } from "@/core/errors/user-message";
import { Input } from "@/components/ui/input";

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  CampaignStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground border-border",
  },
  in_review: {
    label: "In Review",
    className: "bg-secondary text-secondary-foreground border-secondary",
  },
  approved: {
    label: "Approved",
    className:
      "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800",
  },
  sent: {
    label: "Sent",
    className: "bg-primary/10 text-primary border-primary/20",
  },
};

// ── Email preview card ─────────────────────────────────────────────────────

function EmailPreviewCard({
  email,
  index,
  approvalState,
  onClick,
}: {
  email: GeneratedEmail;
  index: number;
  approvalState?: { legal: boolean; marketing: boolean };
  onClick: () => void;
}) {
  const fullyApproved = !!(approvalState?.legal && approvalState?.marketing);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.08 }}
    >
      <div
        onClick={onClick}
        className="group cursor-pointer rounded-xl border border-border bg-card shadow-sm hover:shadow-lg hover:border-primary/40 hover:-translate-y-1 transition-all duration-200 overflow-hidden"
      >
        {/* Card top: index badge + subject + approval check */}
        <div className="px-4 pt-4 pb-3 flex items-start gap-2.5">
          <span className="shrink-0 mt-[2px] h-5 w-5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
            {index + 1}
          </span>
          <h3 className="text-[13px] font-semibold text-foreground leading-snug line-clamp-2 tracking-tight flex-1 min-w-0">
            {email.subject}
          </h3>
          {fullyApproved && (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-[2px]" />
          )}
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
            {/* Gradient fade — masks dead white space at the bottom */}
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

        {/* Footer: audience + approval pills */}
        <div className="px-4 pb-4 space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">To</span>
            <span className="text-xs text-muted-foreground truncate">{email.summary.targetGroup}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                approvalState?.legal
                  ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800"
                  : "bg-muted/60 text-muted-foreground border-border"
              }`}
            >
              Legal
            </span>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                approvalState?.marketing
                  ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800"
                  : "bg-muted/60 text-muted-foreground border-border"
              }`}
            >
              Marketing
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Email detail modal (Preview / Edit / Summary / Approve) ──────────────

type DetailTab = "preview" | "edit" | "summary" | "approve";
type EditMode  = "ai" | "manual";

function EmailModal({
  emailId,
  campaignId,
  open,
  onClose,
}: {
  emailId: string | null;
  campaignId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { campaigns, updateEmailHtml, updateApproval } = useCampaignsStore();
  const brand = useBrandStore((s) => s.brand);
  const campaign = campaigns.find((c) => c.id === campaignId);
  const email    = emailId ? campaign?.emails.find((e) => e.id === emailId) ?? null : null;
  const approval = emailId
    ? campaign?.approvals[emailId] ?? { legal: false, marketing: false, notes: "" }
    : { legal: false, marketing: false, notes: "" };

  const [activeTab,  setActiveTab]  = useState<DetailTab>("preview");
  const [editMode,   setEditMode]   = useState<EditMode>("ai");
  const [aiPrompt,   setAiPrompt]   = useState("");
  const [isEditing,  setIsEditing]  = useState(false);
  const [editError,  setEditError]  = useState<string | null>(null);
  const [displayHtml, setDisplayHtml] = useState("");
  const editableIframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (email) {
      setDisplayHtml(email.htmlContent);
      setActiveTab("preview");
      setAiPrompt("");
      setEditError(null);
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

  if (!email) return null;

  const handleAiEdit = async () => {
    if (!aiPrompt.trim()) return;
    setIsEditing(true);
    setEditError(null);
    try {
      const updated = await editEmail(email.id, displayHtml, email.subject, aiPrompt);
      setDisplayHtml(updated);
      updateEmailHtml(campaignId, email.id, updated);
      setAiPrompt("");
      toast({ title: "Email updated", description: "AI changes applied." });
    } catch (err) {
      setEditError(getUserErrorMessage(err, "Could not apply edit. Try again or enable local-only mode in Settings."));
    } finally {
      setIsEditing(false);
    }
  };

  const editableHtml = useMemo(() => {
    if (!displayHtml) return "";
    return displayHtml.replace(/<body([^>]*)>/i, '<body$1 contenteditable="true" style="outline:none;">');
  }, [displayHtml]);

  const handleManualSave = () => {
    const iframe = editableIframeRef.current;
    if (!iframe?.contentDocument) return;
    const raw = iframe.contentDocument.documentElement.outerHTML;
    const clean = raw.replace(/\s*contenteditable="true"/gi, '').replace(/\s*style="outline:none;"/gi, '');
    setDisplayHtml(clean);
    updateEmailHtml(campaignId, email.id, clean);
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

  const senderDomain = brand.brandName
    ? brand.brandName.toLowerCase().replace(/\s+/g, "") + ".com"
    : "yourbrand.com";

  const tabs: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
    { id: "preview",  label: "Preview",  icon: <Eye className="h-3.5 w-3.5" /> },
    { id: "edit",     label: "Edit",     icon: <Pencil className="h-3.5 w-3.5" /> },
    { id: "summary",  label: "Summary",  icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: "approve",  label: "Approve",  icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  ];

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
              <p className="text-xs text-muted-foreground mt-0.5">
                {approval.legal && approval.marketing ? "✓ Fully approved" : "Pending approval"}
              </p>
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
            Campaign email preview with edit actions and approval workflow.
          </DialogDescription>
        </DialogHeader>

        {/* ── Content ── */}
        <div className="flex-1 overflow-hidden min-h-0">

          {/* PREVIEW TAB */}
          {activeTab === "preview" && (
            <div className="h-full overflow-auto bg-[#f0f2f5] p-6">
              <div className="max-w-[620px] mx-auto">
                <div className="rounded-t-xl bg-card border border-border border-b-0 overflow-hidden shadow-sm">
                  {/* Window chrome */}
                  <div className="flex items-center gap-1.5 px-4 py-3 bg-muted/60 border-b border-border/60">
                    <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                    <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                    <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                    <div className="flex-1 h-5 mx-3 rounded-md bg-background border border-border/50 flex items-center px-2">
                      <span className="text-[10px] text-muted-foreground truncate">no-reply@{senderDomain}</span>
                    </div>
                  </div>

                  {/* Sender row */}
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

                  {/* Subject */}
                  <div className="px-5 py-3 border-b border-border/40 bg-muted/20">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Subject</p>
                    <p className="text-base font-semibold text-foreground leading-snug">{email.subject}</p>
                  </div>
                </div>

                {/* Email body */}
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
              {/* Left: readonly preview (AI) or editable iframe (Direct) */}
              <div className="flex-1 overflow-auto bg-muted/20 min-w-0">
                {editMode === "ai" ? (
                  <iframe srcDoc={displayHtml} className="h-full w-full min-h-[500px]" sandbox="" title="Live preview" />
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
                      <Sparkles className="h-3.5 w-3.5" />AI Edit
                    </button>
                    <button
                      onClick={() => handleModeSwitch("manual")}
                      className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-md transition-all ${
                        editMode === "manual" ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <MousePointerClick className="h-3.5 w-3.5" />Direct Edit
                    </button>
                  </div>
                </div>

                {/* AI Edit */}
                {editMode === "ai" && (
                  <div className="flex flex-col gap-4 flex-1 overflow-auto px-5 py-5 min-h-0">
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-1">AI Instructions</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Describe the changes you want. Mark regenerates the email from your instructions.
                      </p>
                    </div>
                    <Textarea
                      placeholder={"\"Make the tone more formal\"\n\"Add a 20% discount code section\"\n\"Shorten the body to 3 sentences\""}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      className="flex-1 min-h-[160px] text-sm resize-none"
                      disabled={isEditing}
                    />
                    {editError && (
                      <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
                        <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
                        <p className="text-xs text-destructive leading-relaxed">{editError}</p>
                      </div>
                    )}
                    <Button onClick={handleAiEdit} disabled={!aiPrompt.trim() || isEditing} className="w-full">
                      {isEditing ? <><Loader2 className="h-4 w-4 animate-spin" />Applying…</> : <><Sparkles className="h-4 w-4" />Apply with AI</>}
                    </Button>
                  </div>
                )}

                {/* Direct Edit */}
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
                    { label: "Target Group",        value: email.summary.targetGroup },
                    { label: "Regional Adaptation", value: email.summary.regionalAdaptation },
                    { label: "Tone & Style",        value: email.summary.toneDecision },
                    { label: "Legal Compliance",    value: email.summary.legalConsiderations },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">{item.label}</p>
                      <p className="text-xs text-foreground leading-relaxed">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* APPROVE TAB */}
          {activeTab === "approve" && (
            <div className="flex h-full overflow-hidden">
              <div className="flex-1 overflow-auto bg-muted/20">
                <iframe srcDoc={displayHtml} className="h-full w-full min-h-[500px]" sandbox="" title="Email preview" />
              </div>
              <div className="w-[320px] shrink-0 border-l border-border bg-card overflow-auto px-5 py-6">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-5">
                  Approval Workflow
                </p>
                <div className="space-y-6">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Both Legal and Marketing approval are required before this campaign can be sent.
                  </p>

                  <div className="space-y-4">
                    {[
                      {
                        field: "legal" as const,
                        title: "Legal Approval",
                        desc: "Content is compliant with applicable regulations and brand guidelines.",
                      },
                      {
                        field: "marketing" as const,
                        title: "Marketing Approval",
                        desc: "Messaging, tone, and offer are aligned with campaign goals.",
                      },
                    ].map(({ field, title, desc }) => (
                      <label key={field} className="flex items-start gap-3 cursor-pointer group/check">
                        <Checkbox
                          checked={approval[field]}
                          onCheckedChange={(v) => updateApproval(campaignId, email.id, { [field]: !!v })}
                          className="mt-0.5"
                        />
                        <div>
                          <p className="text-xs font-semibold text-foreground group-hover/check:text-primary transition-colors">
                            {title}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Reviewer Notes
                    </p>
                    <Textarea
                      placeholder="Add any notes for the record..."
                      value={approval.notes}
                      onChange={(e) => updateApproval(campaignId, email.id, { notes: e.target.value })}
                      className="min-h-[80px] text-xs resize-none"
                    />
                  </div>

                  {approval.legal && approval.marketing ? (
                    <div className="flex items-center gap-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3">
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                      <p className="text-xs font-semibold text-green-700 dark:text-green-400">This email is approved</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-lg bg-muted border border-border px-4 py-3">
                      <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="text-xs text-muted-foreground">Pending approval</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { campaigns, updateCampaign } = useCampaignsStore();
  const { setGeneratedEmails, reset } = useCampaignStore();

  const campaign = campaigns.find((c) => c.id === id);

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [channelsInput, setChannelsInput] = useState("social_post,sms");
  const [isRepurposing, setIsRepurposing] = useState(false);

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <p className="text-sm text-muted-foreground">Campaign not found.</p>
        <Button variant="outline" onClick={() => navigate("/campaigns")}>
          Back to Campaigns
        </Button>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[campaign.status];
  const approvedCount = campaign.emails.filter(
    (e) =>
      campaign.approvals[e.id]?.legal && campaign.approvals[e.id]?.marketing
  ).length;
  const allApproved = approvedCount === campaign.emails.length;
  const guardrailsPassed = campaign.aiReport?.guardrails_passed ?? true;

  const handleGoToSend = () => {
    if (!guardrailsPassed) {
      toast({
        title: "Guardrails failed",
        description: "Resolve AI risk flags before sending this campaign.",
        variant: "destructive",
      });
      return;
    }
    reset();
    setGeneratedEmails(campaign.emails);
    navigate("/send", { state: { campaignId: campaign.id } });
  };

  const handleRepurpose = async () => {
    const channels = channelsInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!channels.length) {
      toast({
        title: "No channels selected",
        description: "Provide at least one channel (example: social_post,sms).",
        variant: "destructive",
      });
      return;
    }
    setIsRepurposing(true);
    try {
      const response = await repurposeCampaignContent({
        campaign_name: campaign.name,
        objective: campaign.prompt,
        channels,
        emails: campaign.emails.map((email) => ({
          id: email.id,
          subject: email.subject,
          html_content: email.htmlContent,
          target_group: email.summary.targetGroup,
        })),
      });
      updateCampaign(campaign.id, {
        repurposedContent: {
          assets: response.assets,
          reasoning: response.reasoning,
          updatedAt: new Date().toISOString(),
        },
      });
      toast({
        title: "Repurposed content ready",
        description: `Generated ${response.assets.length} channel assets.`,
      });
    } catch (err) {
      toast({
        title: "Repurposing failed",
        description: getUserErrorMessage(err, "Could not generate repurposed channel assets."),
        variant: "destructive",
      });
    } finally {
      setIsRepurposing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <button
          onClick={() => navigate("/campaigns")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All Campaigns
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <h1 className="text-2xl font-display font-bold tracking-tight text-foreground truncate">
              {campaign.name}
            </h1>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {campaign.prompt}
            </p>
          </div>
          <Badge
            variant="outline"
            className={`text-xs font-medium px-3 py-1 shrink-0 mt-1 ${statusConfig.className}`}
          >
            {statusConfig.label}
          </Badge>
        </div>

        {/* Approval progress dots */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {campaign.emails.map((e) => {
              const a = campaign.approvals[e.id];
              const approved = a?.legal && a?.marketing;
              return (
                <span
                  key={e.id}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    approved ? "bg-green-500" : "bg-border"
                  }`}
                />
              );
            })}
          </div>
          <span>
            {approvedCount} of {campaign.emails.length} emails approved — click
            an email to review
          </span>
        </div>
        {campaign.aiReport ? (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
            Score <span className="font-medium text-foreground">{campaign.aiReport.quality_score ?? "n/a"}</span>
            {" · "}Tokens <span className="font-medium text-foreground">{campaign.aiReport.tokens_estimate}</span>
            {" · "}Latency <span className="font-medium text-foreground">{campaign.aiReport.timings_ms?.total_ms ?? "n/a"} ms</span>
          </div>
        ) : null}
        {campaign.sendTimePlan?.suggestions?.length ? (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
            <p className="text-foreground font-medium mb-1">Saved send-time plan</p>
            <p>{campaign.sendTimePlan.globalReasoning || "Segment-aware send-time optimization saved."}</p>
            {campaign.sendTimePlan.suggestions.slice(0, 3).map((item) => (
              <p key={item.email_id} className="mt-1">
                {item.email_id}: {item.local_window} ({item.timezone})
              </p>
            ))}
          </div>
        ) : null}
        <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
          <p className="text-foreground font-medium text-xs">Content Repurposing Agent</p>
          <div className="flex gap-2">
            <Input
              value={channelsInput}
              onChange={(e) => setChannelsInput(e.target.value)}
              placeholder="social_post,sms,linkedin"
              className="h-8 text-xs"
            />
            <Button size="sm" variant="outline" onClick={handleRepurpose} disabled={isRepurposing}>
              {isRepurposing ? "Generating..." : "Generate"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Comma-separated channels. Example: `social_post,sms,linkedin`.
          </p>
          {campaign.repurposedContent?.reasoning && (
            <p className="text-xs text-muted-foreground">{campaign.repurposedContent.reasoning}</p>
          )}
          {campaign.repurposedContent?.assets?.length ? (
            <div className="space-y-2">
              {campaign.repurposedContent.assets.slice(0, 8).map((asset, idx) => (
                <div key={`${asset.channel}-${idx}`} className="rounded border border-border p-2">
                  <p className="text-xs font-medium text-foreground">
                    {asset.channel}: {asset.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{asset.body}</p>
                  {asset.cta && <p className="text-xs text-foreground mt-1">CTA: {asset.cta}</p>}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </motion.div>

      {/* Email grid */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {campaign.emails.map((email, index) => (
          <EmailPreviewCard
            key={email.id}
            email={email}
            index={index}
            approvalState={campaign.approvals[email.id]}
            onClick={() => setSelectedEmailId(email.id)}
          />
        ))}
      </div>

      {/* Not-yet-approved hint */}
      {!allApproved && campaign.status !== "sent" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-5 py-4 text-sm text-muted-foreground"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            All emails need Legal + Marketing approval before this campaign can
            be sent. Click any email and open the Approve tab.
          </span>
        </motion.div>
      )}

      {!guardrailsPassed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-5 py-4"
        >
          <XCircle className="h-4 w-4 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">AI Guardrail Block</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Fix the risky copy in review before this campaign can be sent.
            </p>
          </div>
        </motion.div>
      )}

      {/* Approved → go to send */}
      {allApproved && campaign.status !== "sent" && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4"
        >
          <div>
            <p className="text-sm font-semibold text-foreground">Ready to send</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              All emails are approved — configure recipients and dispatch.
            </p>
          </div>
          <Button
            size="lg"
            className="h-10 px-6 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
            onClick={handleGoToSend}
            disabled={!guardrailsPassed}
          >
            <Mail className="h-4 w-4" />
            Send Campaign
          </Button>
        </motion.div>
      )}

      {campaign.status === "sent" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 px-5 py-4"
        >
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-700 dark:text-green-400">Campaign Sent</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              This campaign has been dispatched to recipients.
            </p>
          </div>
        </motion.div>
      )}

      {/* Modals */}
      <EmailModal
        emailId={selectedEmailId}
        campaignId={campaign.id}
        open={!!selectedEmailId}
        onClose={() => setSelectedEmailId(null)}
      />
    </div>
  );
}

