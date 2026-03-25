import { useState, useMemo, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Mail, Users, CheckCircle2, Settings2, Sparkles, Link2 } from "lucide-react";
import ConfigureMailingDialog from "@/components/ConfigureMailingDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useCampaignStore } from "@/lib/campaign-store";
import { useHubSpotContactsStore } from "@/lib/hubspot-contacts-store";
import { useHubSpotStore } from "@/lib/hubspot-store";
import { scoreSegment } from "@/lib/crm-parser";
import {
  getEmailConfig,
  sendCampaign,
  recommendRecipients,
  type CampaignSendTask,
} from "@/lib/api";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCampaignsStore } from "@/lib/campaigns-list-store";
import { safeAsync } from "@/core/async/safe-async";
import { getHubspotAuthUrl } from "@/features/integrations/hubspot-client";
import { useRequireGeneratedEmails } from "@/features/campaigns/use-require-generated-emails";
import { getUserErrorMessage } from "@/core/errors/user-message";

export default function SendPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const campaignId = (location.state as { campaignId?: string } | null)?.campaignId ?? null;
  const { generatedEmails, emailAssignments, setRecipients, reset, prompt: storePrompt } = useCampaignStore();
  const { updateCampaign, campaigns } = useCampaignsStore();
  const { segments, rawContactsCsv } = useHubSpotContactsStore();
  const { connected } = useHubSpotStore();

  // Resolve the campaign prompt — prefer the saved campaign record, fall back to the in-flight store
  const campaignPrompt = (campaignId ? campaigns.find((c) => c.id === campaignId)?.prompt : null) ?? storePrompt ?? null;
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

  const suggestedSegments = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const email of generatedEmails) {
      const suggested = new Set<string>();
      for (const seg of segments) {
        if (scoreSegment(seg, email.summary.targetGroup) > 0) suggested.add(seg.id);
      }
      result[email.id] = suggested;
    }
    return result;
  }, [generatedEmails, segments]);

  // Auto-trigger AI match on first render if contacts CSV is available
  const autoMatchRef = useRef(false);
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
    if (rawContactsCsv || segments.length === 0 || generatedEmails.length === 0) return;
    const next: Record<string, string[]> = {};
    let anyApplied = false;
    for (const email of generatedEmails) {
      const suggested = [...(suggestedSegments[email.id] ?? [])];
      if (suggested.length === 0) continue;
      next[email.id] = suggested;
      const allEmails = segments
        .filter((s) => suggested.includes(s.id))
        .flatMap((s) => s.emails);
      setRecipients(email.id, Array.from(new Set(allEmails)));
      anyApplied = true;
    }
    if (anyApplied) setSelectedSegments(next);
  }, [rawContactsCsv, segments, generatedEmails, setRecipients, suggestedSegments]);

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

      const allEmails = segments
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
      const allEmails = segments
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

  const handleSend = async (config: {
    fromEmail: string;
    replyTo: string;
    plainTexts: Record<string, string>;
    subjects: Record<string, string>;
  }) => {
    const tasks: CampaignSendTask[] = [];
    for (const email of generatedEmails) {
      const recipients = emailAssignments[email.id] ?? [];
      if (recipients.length === 0 || !email.htmlContent) continue;
      const subject = config.subjects[email.id]?.trim() || email.subject;
      for (const recipient of recipients) {
        tasks.push({ email, recipient, subject });
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

      {/* Auto-select banner — keyword segment suggestions (no CSV) */}
      {!rawContactsCsv && segments.length > 0 && hasSuggestions && (
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
                  defaultValue={connected && segments.length > 0 ? "audiences" : "manual"}
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
                    ) : segments.length === 0 ? (
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
                        {segments.map((seg) => {
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
                onClick={() => setShowConfigDialog(true)}
                disabled={totalRecipients === 0}
              >
                <Settings2 className="h-4 w-4" />
                Configure Mailing
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
        onSend={handleSend}
        isSending={isSending}
      />
    </div>
  );
}

