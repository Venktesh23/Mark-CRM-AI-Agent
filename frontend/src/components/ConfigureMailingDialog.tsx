import { useState, useEffect } from "react";
import { Mail, Send, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { GeneratedEmail } from "@/lib/mock-api";

interface MailingConfig {
  fromEmail: string;
  replyTo: string;
  plainTexts: Record<string, string>;
  subjects: Record<string, string>;
}

interface ConfigureMailingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emails: GeneratedEmail[];
  emailAssignments: Record<string, string[]>;
  defaultFromEmail?: string;
  onSend: (config: MailingConfig) => void;
  isSending: boolean;
}

export default function ConfigureMailingDialog({
  open,
  onOpenChange,
  emails,
  emailAssignments,
  defaultFromEmail = "",
  onSend,
  isSending,
}: ConfigureMailingDialogProps) {
  const [fromEmail, setFromEmail] = useState(defaultFromEmail);
  const [replyTo, setReplyTo] = useState("");
  const [plainTexts, setPlainTexts] = useState<Record<string, string>>({});
  const [subjects, setSubjects] = useState<Record<string, string>>({});

  // Re-sync if the default changes after mount
  useEffect(() => {
    setFromEmail((prev) => prev || defaultFromEmail);
  }, [defaultFromEmail]);

  const totalRecipients = Object.values(emailAssignments).reduce(
    (acc, r) => acc + r.length,
    0
  );

  const assignedEmails = emails.filter(
    (e) => (emailAssignments[e.id]?.length || 0) > 0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-semibold font-sans">
            <Settings2 className="h-4 w-4 text-primary" />
            Configure Mailing
          </DialogTitle>
          <DialogDescription className="text-xs">
            Set SendGrid parameters before dispatching your campaign.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6 overflow-y-auto" style={{ maxHeight: "calc(85vh - 180px)" }}>
          <div className="space-y-5 pb-2">
            {/* Global SendGrid settings */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold font-sans uppercase tracking-wider text-muted-foreground">
                Sender Settings
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    From Email <span className="text-primary">*</span>
                  </label>
                  <Input
                    type="email"
                    placeholder="noreply@yourcompany.com"
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    className="text-sm h-9 bg-card"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Must be a verified SendGrid sender.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Reply-To <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    type="email"
                    placeholder="support@yourcompany.com"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    className="text-sm h-9 bg-card"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Per-email config */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold font-sans uppercase tracking-wider text-muted-foreground">
                Email Details ({assignedEmails.length} with recipients)
              </h3>

              {assignedEmails.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No emails have recipients assigned yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {assignedEmails.map((email) => {
                    const emailNumber = emails.findIndex((e) => e.id === email.id) + 1;
                    return (
                    <div
                      key={email.id}
                      className="rounded-md border border-border bg-card p-4 space-y-3"
                    >
                      {emails.length > 1 && (
                        <p className="text-xs font-semibold text-muted-foreground">Email {emailNumber}</p>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5 text-primary shrink-0" />
                            <p className="text-sm font-semibold font-sans truncate">
                              {email.subject}
                            </p>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {email.summary.targetGroup}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[10px] shrink-0 rounded px-2">
                          {emailAssignments[email.id]?.length || 0} recipients
                        </Badge>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {emailAssignments[email.id]?.slice(0, 5).map((addr, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="text-[10px] rounded px-1.5 py-0"
                          >
                            {addr}
                          </Badge>
                        ))}
                        {(emailAssignments[email.id]?.length || 0) > 5 && (
                          <Badge
                            variant="outline"
                            className="text-[10px] rounded px-1.5 py-0"
                          >
                            +{emailAssignments[email.id].length - 5} more
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-foreground">
                          Subject
                        </label>
                        <Input
                          value={subjects[email.id] ?? email.subject}
                          onChange={(e) =>
                            setSubjects((prev) => ({
                              ...prev,
                              [email.id]: e.target.value,
                            }))
                          }
                          className="text-xs h-8 bg-muted/60 border-border"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-foreground">
                          HTML Content
                        </label>
                        <div className="rounded border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground max-h-16 overflow-hidden">
                          {email.htmlContent.replace(/<[^>]*>/g, "").slice(0, 150)}…
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Populated from generated email. Edit on the Review page.
                        </p>
                      </div>

                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <Separator className="my-1" />

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            {assignedEmails.length} emails · {totalRecipients} recipients
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="text-xs"
              onClick={() => onSend({ fromEmail, replyTo, plainTexts, subjects })}
              disabled={isSending || !fromEmail.trim() || assignedEmails.length === 0}
            >
              {isSending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Send
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
