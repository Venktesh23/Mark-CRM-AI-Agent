import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Pencil, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card
        className="cursor-pointer overflow-hidden transition-all hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5 border-border"
        onClick={onClick}
      >
        <CardHeader className="pb-2 px-5 pt-5">
          <CardTitle className="text-sm font-semibold leading-tight text-foreground">
            {email.subject}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="relative h-[180px] overflow-hidden border-t border-border">
            <iframe
              srcDoc={email.htmlContent}
              className="pointer-events-none h-[600px] w-[600px] origin-top-left scale-[0.5]"
              sandbox=""
              title={email.subject}
            />
          </div>
          <div className="border-t border-border px-5 py-3">
            <p className="text-xs text-muted-foreground line-clamp-2">
              <span className="font-medium text-foreground">Target:</span> {email.summary.targetGroup}
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/** Named export for testing. The default export (ReviewPage) wraps this. */
export function EmailEditorModal({
  email,
  open,
  onClose,
  onSaved,
  defaultTab = "summary",
}: {
  email: GeneratedEmail | null;
  open: boolean;
  onClose: () => void;
  /** Called with the email id and new HTML after a successful AI edit. */
  onSaved: (emailId: string, newHtml: string) => void;
  /** Which tab to show on open. Defaults to "summary". Pass "edit" in tests. */
  defaultTab?: "summary" | "edit";
}) {
  const [editPrompt, setEditPrompt] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  // Local display HTML so the iframe updates immediately after a successful edit,
  // without waiting for the parent to re-render and re-pass props.
  const [displayHtml, setDisplayHtml] = useState("");

  // Sync displayHtml whenever a different email is opened.
  useEffect(() => {
    if (email) setDisplayHtml(email.htmlContent);
  }, [email]);

  if (!email) return null;

  const handleSubmitEdit = async () => {
    if (!editPrompt.trim()) return;
    setIsApplying(true);
    setApplyError(null);
    try {
      const newHtml = await editEmail(
        email.id,
        displayHtml,       // use current displayed HTML so chained edits work
        email.subject,
        editPrompt,
      );
      setDisplayHtml(newHtml);   // update iframe immediately
      onSaved(email.id, newHtml); // persist into Zustand store
      setEditPrompt("");
    } catch (err) {
      setApplyError(
        getUserErrorMessage(err, "Edit failed. Retry or enable local-only mode in Settings.")
      );
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-base font-semibold">{email.subject}</DialogTitle>
          <DialogDescription className="sr-only">
            Preview, edit, and approve this generated campaign email.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto">
            <iframe
              srcDoc={displayHtml}
              className="h-full w-full"
              sandbox=""
              title="Email preview"
            />
          </div>

          <div className="w-[300px] flex-shrink-0 border-l border-border bg-muted/30 flex flex-col overflow-hidden">
            <Tabs defaultValue={defaultTab} className="flex flex-col h-full">
              <div className="px-4 pt-4 pb-2 flex-shrink-0">
                <TabsList className="w-full">
                  <TabsTrigger value="summary" className="flex-1 gap-1.5 text-xs">
                    <Sparkles className="h-3 w-3" />
                    Summary
                  </TabsTrigger>
                  <TabsTrigger value="edit" className="flex-1 gap-1.5 text-xs">
                    <Pencil className="h-3 w-3" />
                    Edit
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="summary" className="flex-1 overflow-auto px-5 pb-5 mt-0">
                <div className="space-y-4 pt-2">
                  {[
                    { label: "Target Group", value: email.summary.targetGroup },
                    { label: "Regional Adaptation", value: email.summary.regionalAdaptation },
                    { label: "Tone & Style", value: email.summary.toneDecision },
                    { label: "Legal Compliance", value: email.summary.legalConsiderations },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{item.label}</p>
                      <p className="text-xs text-foreground leading-relaxed">{item.value}</p>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="edit" className="flex-1 flex flex-col overflow-auto px-5 pb-5 mt-0">
                <div className="flex flex-col gap-4 pt-2 flex-1">
                  <p className="text-xs text-muted-foreground">
                    Describe the changes you'd like. The AI will regenerate this email based on your instructions.
                  </p>
                  <Textarea
                    placeholder="Describe the changes you'd like, e.g. make the tone more formal, add a discount code section…"
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    className="min-h-[140px] flex-1 text-xs"
                    disabled={isApplying}
                  />
                  {applyError && (
                    <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
                      <p className="text-xs text-destructive">{applyError}</p>
                    </div>
                  )}
                  <Button
                    size="sm"
                    onClick={handleSubmitEdit}
                    disabled={!editPrompt.trim() || isApplying}
                    className="w-full"
                  >
                    {isApplying ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Applying…</>
                    ) : (
                      <><Sparkles className="h-3.5 w-3.5 mr-1" />Apply Changes</>
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
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
    // 1. Persist into Zustand so SendPage uses the edited HTML.
    updateEmailHtml(emailId, newHtml);
    // 2. Update the modal's email snapshot so the next edit starts from the new HTML.
    setSelectedEmail((prev) =>
      prev && prev.id === emailId ? { ...prev, htmlContent: newHtml } : prev
    );
    // 3. The preview cards re-render from Zustand thanks to `generatedEmails` binding.
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
    // Derive a campaign name from the first ~60 chars of the prompt
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
        className="text-center space-y-3"
      >
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Review Your <span className="gradient-text">Campaign</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Click any email to edit. Review AI analysis and make adjustments before sending.
        </p>
      </motion.div>

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

      {generationReport ? (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm">AI Quality Dashboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>
              Score: <span className="text-foreground font-medium">{generationReport.quality_score ?? "n/a"}</span>
              {" · "}Tokens: <span className="text-foreground font-medium">{generationReport.tokens_estimate}</span>
              {" · "}Model: <span className="text-foreground font-medium">{generationReport.model_used || "n/a"}</span>
            </p>
            <p>
              Total latency:{" "}
              <span className="text-foreground font-medium">
                {generationReport.timings_ms?.total_ms ?? "n/a"} ms
              </span>
            </p>
            {generationReport.risk_flags.length > 0 ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
                {generationReport.risk_flags.slice(0, 3).map((flag) => (
                  <p key={flag}>{flag}</p>
                ))}
              </div>
            ) : (
              <p className="text-emerald-600">Guardrails passed.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm">Localization Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Textarea
              value={localizeLanguage}
              onChange={(e) => setLocalizeLanguage(e.target.value)}
              className="min-h-[52px] text-sm"
              placeholder="Target language"
            />
            <Textarea
              value={localizeRegion}
              onChange={(e) => setLocalizeRegion(e.target.value)}
              className="min-h-[52px] text-sm"
              placeholder="Target region (optional)"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleLocalizeAll} disabled={isLocalizing || !localizeLanguage.trim()}>
              {isLocalizing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Localizing…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Localize All Emails
                </>
              )}
            </Button>
          </div>
          {localizeReasoning && <p className="text-xs text-muted-foreground">{localizeReasoning}</p>}
        </CardContent>
      </Card>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex justify-center"
      >
        <Button
          size="lg"
          className="h-11 px-8 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleSave}
          disabled={isSaving || (generationReport ? !generationReport.guardrails_passed : false)}
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              Save Campaign
              <ArrowRight className="h-4 w-4" />
            </>
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
