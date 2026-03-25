import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useCampaignStore } from "@/lib/campaign-store";
import { useCampaignsStore } from "@/lib/campaigns-list-store";
import {
  generateCampaign,
  generateSmartBrief,
  retrieveMemory,
  type ClarificationQuestion,
  type SmartBrief,
} from "@/lib/api";
import { useBrandStore } from "@/lib/brand-store";
import { useNavigate } from "react-router-dom";
import { getUserErrorMessage } from "@/core/errors/user-message";

// Line 1: "Make something"
// Line 2: "re" + gradient("mark") + "able."
const TW_LINE1   = "Make something";
const TW_L2_PRE  = "re";
const TW_MARK    = "mark";
const TW_SUFFIX  = "able.";

const FAST_UNTIL = TW_LINE1.length; // pause after finishing line 1 (index 14)
const FULL_TEXT  = TW_LINE1 + TW_L2_PRE + TW_MARK + TW_SUFFIX;
const TW_TOTAL   = FULL_TEXT.length;

function humanDelay(index: number): number {
  // "Make something" — fast, snappy keystrokes
  if (index < FAST_UNTIL) return 18 + Math.random() * 22;
  // Deliberate pause before jumping to line 2 ("re…")
  if (index === FAST_UNTIL) return 520 + Math.random() * 160;
  const ch = FULL_TEXT[index] ?? "";
  const prev = FULL_TEXT[index - 1] ?? "";
  // Slow after spaces / punctuation
  if (prev === " " || prev === "." || prev === ",") return 90 + Math.random() * 120;
  // Slow before punctuation
  if (ch === "." || ch === ",") return 80 + Math.random() * 80;
  // Occasional micro-pause (≈1 in 9 chars)
  if (Math.random() < 0.11) return 110 + Math.random() * 90;
  // Normal variation
  return 28 + Math.random() * 67;
}

// Module-level flag: survives tab switches, resets on full page reload
let twHasPlayed = false;

function useTypewriter(startDelay = 380) {
  const [count, setCount] = useState(twHasPlayed ? TW_TOTAL : 0);
  useEffect(() => {
    if (twHasPlayed) return;
    let timeout: ReturnType<typeof setTimeout>;
    const tick = (n: number) => {
      if (n >= TW_TOTAL) { twHasPlayed = true; return; }
      const delay = n === 0 ? startDelay : humanDelay(n);
      timeout = setTimeout(() => {
        setCount(n + 1);
        tick(n + 1);
      }, delay);
    };
    tick(0);
    return () => clearTimeout(timeout);
  }, [startDelay]);
  return { count, done: count >= TW_TOTAL };
}

function TypewriterHeadline() {
  const { count, done } = useTypewriter();

  // Line 1 segment
  const line1Visible   = TW_LINE1.slice(0, Math.min(count, TW_LINE1.length));

  // Line 2 segments
  const l2PreOff       = TW_LINE1.length;
  const l2PreVisible   = count > l2PreOff
    ? TW_L2_PRE.slice(0, Math.min(count - l2PreOff, TW_L2_PRE.length))
    : "";
  const markOff        = l2PreOff + TW_L2_PRE.length;
  const markVisible    = count > markOff
    ? TW_MARK.slice(0, Math.min(count - markOff, TW_MARK.length))
    : "";
  const suffixOff      = markOff + TW_MARK.length;
  const suffixVisible  = count > suffixOff
    ? TW_SUFFIX.slice(0, count - suffixOff)
    : "";

  const cursorOnLine1  = count <= TW_LINE1.length;

  const Cursor = () => (
    <motion.span
      aria-hidden
      animate={{ opacity: done ? 0 : [1, 1, 0, 0] }}
      transition={done
        ? { duration: 0.3 }
        : { repeat: Infinity, duration: 0.9, ease: "linear", times: [0, 0.5, 0.5, 1] }
      }
      className="inline-block ml-0.5 w-[3px] h-[0.85em] bg-primary align-middle rounded-sm"
    />
  );

  return (
    <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-[3.5rem] text-foreground leading-[1.15]">
      <span className="block">
        {line1Visible}
        {cursorOnLine1 && <Cursor />}
      </span>
      <span className="block">
        {l2PreVisible}
        {markVisible && <span className="gradient-text">{markVisible}</span>}
        {suffixVisible}
        {!cursorOnLine1 && <Cursor />}
        {/* reserve line height before typing starts */}
        {!l2PreVisible && !markVisible && !suffixVisible && "\u00A0"}
      </span>
    </h1>
  );
}

export default function CreatePage() {
  const navigate = useNavigate();
  const {
    prompt,
    setPrompt,
    setGeneratedEmails,
    setGenerationReport,
    setStep,
    isGenerating,
    setIsGenerating,
  } = useCampaignStore();
  const brand = useBrandStore((s) => s.brand);
  const campaigns = useCampaignsStore((s) => s.campaigns);

  const [clarificationQuestions, setClarificationQuestions] = useState<ClarificationQuestion[]>([]);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [smartBrief, setSmartBrief] = useState<SmartBrief | null>(null);
  const [briefQuestions, setBriefQuestions] = useState<string[]>([]);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildEnrichedPrompt = () => {
    const answersText = clarificationQuestions
      .map((q, i) => `Q: ${q.question}\nA: ${clarificationAnswers[i] ?? "(no answer provided)"}`)
      .join("\n\n");
    return answersText
      ? `${prompt}\n\nAdditional context from clarification:\n${answersText}`
      : prompt;
  };

  const buildPromptFromBrief = (brief: SmartBrief): string => {
    const keyPoints = brief.key_points.length
      ? `Key points:\n- ${brief.key_points.join("\n- ")}`
      : "";
    const assumptions = brief.assumptions.length
      ? `Assumptions:\n- ${brief.assumptions.join("\n- ")}`
      : "";
    return [
      prompt.trim(),
      `Campaign Name: ${brief.campaign_name}`,
      `Objective: ${brief.objective}`,
      `Primary KPI: ${brief.primary_kpi}`,
      `Target Audience: ${brief.target_audience}`,
      `Offer: ${brief.offer}`,
      `Geo Scope: ${brief.geo_scope}`,
      `Language: ${brief.language}`,
      `Tone: ${brief.tone}`,
      `Compliance Notes: ${brief.compliance_notes}`,
      `Send Window: ${brief.send_window}`,
      `Number of Emails: ${brief.number_of_emails}`,
      keyPoints,
      assumptions,
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
  };

  const handleGenerateBrief = async () => {
    if (!prompt.trim()) return;
    setIsGeneratingBrief(true);
    setError(null);
    try {
      const response = await generateSmartBrief(prompt);
      setSmartBrief(response.brief);
      setBriefQuestions(response.questions ?? []);
    } catch (err) {
      setError(getUserErrorMessage(err, "Could not generate smart brief. Please retry."));
    } finally {
      setIsGeneratingBrief(false);
    }
  };

  const handleGenerate = async (enrichedPrompt?: string, forceProceed = false) => {
    const activePrompt = enrichedPrompt ?? (smartBrief ? buildPromptFromBrief(smartBrief) : prompt);
    if (!activePrompt.trim()) return;
    setError(null);
    setGenerationReport(null);
    setIsGenerating(true);
    console.log("Generating campaign with prompt:", activePrompt);
    const campaignMemory = campaigns
      .filter((c) => c.status === "approved" || c.status === "sent")
      .slice(0, 5)
      .map((c) => `${c.name}: ${c.prompt}`);
    let retrievedMemory: string[] = [];
    try {
      const memory = await retrieveMemory({
        prompt: activePrompt,
        audience: smartBrief?.target_audience ?? "",
        objective: smartBrief?.objective ?? "",
        limit: 5,
      });
      retrievedMemory = memory.snippets.map((item) => item.snippet);
    } catch {
      retrievedMemory = [];
    }

    try {
      const response = await generateCampaign({
        prompt: activePrompt,
        force_proceed: forceProceed,
        // Pass full brand context so backend generates brand-specific copy
        brand_context: brand.brandName ? {
          brandName: brand.brandName,
          voiceGuidelines: brand.voiceGuidelines,
          bannedPhrases: brand.bannedPhrases,
          requiredPhrases: brand.requiredPhrases,
          legalFooter: brand.legalFooter,
          designTokens: brand.designTokens,
        } : undefined,
        campaign_memory: [...campaignMemory, ...retrievedMemory].slice(0, 10),
      });
      console.log("Campaign response:", response);

      if (response.status === "needs_clarification" && response.questions?.length) {
        setClarificationQuestions(response.questions);
        setClarificationAnswers({});
        return;
      }

      setGeneratedEmails(response.emails);
      setGenerationReport(response.ai_report ?? null);
      setStep(1);
      navigate("/review");
    } catch (err) {
      const errorMsg = getUserErrorMessage(
        err,
        "Failed to generate campaign. Check backend status or enable local-only mode in Settings."
      );
      console.error("Campaign generation error:", err);
      setError(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClarificationSubmit = () => {
    const enriched = buildEnrichedPrompt();
    setClarificationQuestions([]);
    handleGenerate(enriched, true);
  };

  const updateBrief = (updates: Partial<SmartBrief>) =>
    setSmartBrief((prev) => (prev ? { ...prev, ...updates } : prev));

  // ── Clarification screen ──────────────────────────────────────────────────
  if (clarificationQuestions.length > 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-3"
        >
          <div className="inline-flex items-center gap-2 rounded border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            A few quick questions
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Help Mark understand your <span className="gradient-text">campaign</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Answer these to get the best results. You can leave any blank to use AI defaults.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4"
        >
          {clarificationQuestions.map((q, i) => (
            <Card key={i} className="border border-border">
              <CardContent className="p-5 space-y-3">
                <p className="text-sm font-medium text-foreground">
                  <span className="text-muted-foreground mr-2">{i + 1}.</span>
                  {q.question}
                </p>
                <Textarea
                  placeholder="Your answer (or leave blank to skip)..."
                  className="min-h-[80px] resize-none text-sm"
                  value={clarificationAnswers[i] ?? ""}
                  onChange={(e) =>
                    setClarificationAnswers((prev) => ({ ...prev, [i]: e.target.value }))
                  }
                />
              </CardContent>
            </Card>
          ))}
        </motion.div>

        <div className="flex gap-3 justify-center">
          <Button
            variant="outline"
            onClick={() => setClarificationQuestions([])}
          >
            Back
          </Button>
          <Button
            size="lg"
            className="h-11 px-8 text-sm font-semibold"
            onClick={handleClarificationSubmit}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                Generate Campaign
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ── Main create screen ────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="text-center space-y-5"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="inline-flex items-center gap-2 rounded border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Powered by Mark AI
        </motion.div>
        <TypewriterHeadline />
        <p className="mx-auto max-w-lg text-base text-muted-foreground leading-relaxed">
          Describe your brief — audience, offer, tone, and goals. Mark turns it
          into a polished, ready-to-send email campaign.
        </p>
      </motion.div>

      {/* Prompt Box */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      >
        <Card className="border border-border shadow-sm">
          <CardContent className="p-5 space-y-4">
            <Textarea
              placeholder="Describe your campaign... e.g. 'Create a 3-email spring sale campaign targeting EU customers aged 25-40. Include GDPR compliance, use a professional but friendly tone, and promote our new collection with a 30% discount code.'"
              className="min-h-[160px] resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex items-center justify-between border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                Be specific about target market, regions, number of emails, tone, and legal requirements.
              </p>
              <span className="text-xs text-muted-foreground font-mono-display">{prompt.length}</span>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateBrief}
                disabled={!prompt.trim() || isGeneratingBrief || isGenerating}
              >
                {isGeneratingBrief ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Generating Brief…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Smart Brief
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {smartBrief && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Card className="border border-border">
            <CardContent className="p-5 space-y-4">
              <p className="text-sm font-semibold text-foreground">Structured Brief Editor</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={smartBrief.campaign_name} onChange={(e) => updateBrief({ campaign_name: e.target.value })} placeholder="Campaign Name" />
                <Input value={smartBrief.primary_kpi} onChange={(e) => updateBrief({ primary_kpi: e.target.value })} placeholder="Primary KPI" />
                <Input value={smartBrief.target_audience} onChange={(e) => updateBrief({ target_audience: e.target.value })} placeholder="Target Audience" />
                <Input value={smartBrief.offer} onChange={(e) => updateBrief({ offer: e.target.value })} placeholder="Offer" />
                <Input value={smartBrief.geo_scope} onChange={(e) => updateBrief({ geo_scope: e.target.value })} placeholder="Geo Scope" />
                <Input value={smartBrief.language} onChange={(e) => updateBrief({ language: e.target.value })} placeholder="Language" />
                <Input value={smartBrief.send_window} onChange={(e) => updateBrief({ send_window: e.target.value })} placeholder="Send Window" />
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={smartBrief.number_of_emails}
                  onChange={(e) =>
                    updateBrief({ number_of_emails: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })
                  }
                  placeholder="Number of Emails"
                />
              </div>
              <Textarea
                value={smartBrief.objective}
                onChange={(e) => updateBrief({ objective: e.target.value })}
                placeholder="Objective"
                className="min-h-[70px] text-sm"
              />
              <Textarea
                value={smartBrief.tone}
                onChange={(e) => updateBrief({ tone: e.target.value })}
                placeholder="Tone"
                className="min-h-[60px] text-sm"
              />
              <Textarea
                value={smartBrief.compliance_notes}
                onChange={(e) => updateBrief({ compliance_notes: e.target.value })}
                placeholder="Compliance Notes"
                className="min-h-[60px] text-sm"
              />
              <Textarea
                value={smartBrief.key_points.join("\n")}
                onChange={(e) =>
                  updateBrief({
                    key_points: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
                  })
                }
                placeholder="Key points (one per line)"
                className="min-h-[80px] text-sm"
              />
              {briefQuestions.length > 0 && (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="text-xs font-medium text-foreground mb-1">Follow-up Questions</p>
                  {briefQuestions.map((q) => (
                    <p key={q} className="text-xs text-muted-foreground">- {q}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Generate Button */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="flex justify-center"
      >
        <Button
          size="lg"
          className="h-11 px-8 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
          onClick={() => handleGenerate()}
          disabled={(!prompt.trim() && !smartBrief) || isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              Generate Campaign
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive text-center"
        >
          {error}
        </motion.div>
      )}
    </div>
  );
}
