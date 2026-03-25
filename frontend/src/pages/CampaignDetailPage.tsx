import { useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCampaignsStore,
  type CampaignStatus,
} from "@/lib/campaigns-list-store";
import { useCampaignStore } from "@/lib/campaign-store";
import { editEmail } from "@/lib/api";
import type { GeneratedEmail } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { getUserErrorMessage } from "@/core/errors/user-message";

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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
    >
      <Card
        className="cursor-pointer overflow-hidden transition-all hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5 border-border"
        onClick={onClick}
      >
        <CardHeader className="pb-2 px-5 pt-5">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-semibold leading-tight text-foreground flex-1">
              {email.subject}
            </CardTitle>
            {fullyApproved && (
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
            )}
          </div>
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
          <div className="border-t border-border px-5 py-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground line-clamp-1 flex-1 min-w-0 mr-3">
              <span className="font-medium text-foreground">Target:</span>{" "}
              {email.summary.targetGroup}
            </p>
            <div className="flex gap-1.5 shrink-0">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  approvalState?.legal
                    ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Legal
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  approvalState?.marketing
                    ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Mktg
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Email detail modal (Preview / Edit / Approve) ─────────────────────────

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
  const campaign = campaigns.find((c) => c.id === campaignId);
  const email = emailId
    ? campaign?.emails.find((e) => e.id === emailId) ?? null
    : null;
  const approval = emailId
    ? campaign?.approvals[emailId] ?? {
        legal: false,
        marketing: false,
        notes: "",
      }
    : { legal: false, marketing: false, notes: "" };

  const [editPrompt, setEditPrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  if (!email) return null;

  const handleEdit = async () => {
    if (!editPrompt.trim()) return;
    setIsEditing(true);
    try {
      const updated = await editEmail(
        email.id,
        email.htmlContent,
        email.subject,
        editPrompt
      );
      updateEmailHtml(campaignId, email.id, updated);
      setEditPrompt("");
      toast({
        title: "Email updated",
        description: "Changes applied successfully.",
      });
    } catch (err) {
      toast({
        title: "Edit failed",
        description: getUserErrorMessage(
          err,
          "Could not apply edit. Try again or enable local-only mode in Settings."
        ),
        variant: "destructive",
      });
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-base font-semibold">
            {email.subject}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Email iframe */}
          <div className="flex-1 overflow-auto">
            <iframe
              srcDoc={email.htmlContent}
              className="h-full w-full"
              sandbox=""
              title="Email preview"
            />
          </div>

          {/* Side panel */}
          <div className="w-[300px] shrink-0 border-l border-border bg-muted/30 flex flex-col overflow-hidden">
            <Tabs defaultValue="summary" className="flex flex-col h-full">
              <div className="px-4 pt-4 pb-2 shrink-0">
                <TabsList className="w-full">
                  <TabsTrigger value="summary" className="flex-1 gap-1 text-xs">
                    <Sparkles className="h-3 w-3" />
                    Summary
                  </TabsTrigger>
                  <TabsTrigger value="edit" className="flex-1 gap-1 text-xs">
                    <Pencil className="h-3 w-3" />
                    Edit
                  </TabsTrigger>
                  <TabsTrigger
                    value="approve"
                    className="flex-1 gap-1 text-xs"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Approve
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Summary */}
              <TabsContent
                value="summary"
                className="flex-1 overflow-auto px-5 pb-5 mt-0"
              >
                <div className="space-y-4 pt-2">
                  {[
                    { label: "Target Group", value: email.summary.targetGroup },
                    {
                      label: "Regional Adaptation",
                      value: email.summary.regionalAdaptation,
                    },
                    {
                      label: "Tone & Style",
                      value: email.summary.toneDecision,
                    },
                    {
                      label: "Legal Compliance",
                      value: email.summary.legalConsiderations,
                    },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        {item.label}
                      </p>
                      <p className="text-xs text-foreground leading-relaxed">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Edit */}
              <TabsContent
                value="edit"
                className="flex-1 flex flex-col overflow-auto px-5 pb-5 mt-0"
              >
                <div className="flex flex-col gap-4 pt-2 flex-1">
                  <p className="text-xs text-muted-foreground">
                    Describe the changes you'd like. Mark will regenerate this
                    email based on your instructions.
                  </p>
                  <Textarea
                    placeholder="e.g. Make the tone more formal, add a discount code section..."
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    className="min-h-[140px] flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    onClick={handleEdit}
                    disabled={!editPrompt.trim() || isEditing}
                    className="w-full"
                  >
                    {isEditing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        Apply Changes
                      </>
                    )}
                  </Button>
                </div>
              </TabsContent>

              {/* Approve */}
              <TabsContent
                value="approve"
                className="flex-1 flex flex-col overflow-auto px-5 pb-5 mt-0"
              >
                <div className="flex flex-col gap-5 pt-2">
                  <p className="text-xs text-muted-foreground">
                    Mark approvals below. Both are required before this campaign
                    can be sent.
                  </p>

                  <div className="space-y-4">
                    {/* Legal */}
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={approval.legal}
                        onCheckedChange={(v) =>
                          updateApproval(campaignId, email.id, {
                            legal: !!v,
                          })
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Legal Approval
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                          Content is compliant with applicable regulations and
                          brand guidelines.
                        </p>
                      </div>
                    </label>

                    {/* Marketing */}
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={approval.marketing}
                        onCheckedChange={(v) =>
                          updateApproval(campaignId, email.id, {
                            marketing: !!v,
                          })
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Marketing Approval
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                          Messaging, tone, and offer are aligned with campaign
                          goals.
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Reviewer Notes
                    </p>
                    <Textarea
                      placeholder="Add any notes for the record..."
                      value={approval.notes}
                      onChange={(e) =>
                        updateApproval(campaignId, email.id, {
                          notes: e.target.value,
                        })
                      }
                      className="min-h-[90px] text-xs"
                    />
                  </div>

                  {/* Status indicator */}
                  {approval.legal && approval.marketing ? (
                    <div className="flex items-center gap-2 rounded-md bg-green-100 dark:bg-green-900/20 px-3 py-2.5">
                      <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-400 shrink-0" />
                      <p className="text-xs font-medium text-green-700 dark:text-green-400">
                        This email is approved
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2.5">
                      <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="text-xs text-muted-foreground">
                        Pending approval
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { campaigns } = useCampaignsStore();
  const { setGeneratedEmails, reset } = useCampaignStore();

  const campaign = campaigns.find((c) => c.id === id);

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

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

