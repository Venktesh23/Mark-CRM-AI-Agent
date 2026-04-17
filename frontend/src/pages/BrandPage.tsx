import { useState } from "react";
import { motion } from "framer-motion";
import { Save, RotateCcw, Palette, FileText, Shield, CheckCircle2, Plug, Copy, X, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useBrandStore } from "@/lib/brand-store";
import { useCampaignsStore } from "@/lib/campaigns-list-store";
import { trainBrandVoice } from "@/lib/api";
import { HUBSPOT_DESCRIPTION_TEMPLATE } from "@/lib/crm-parser";
import { toast } from "@/hooks/use-toast";

// ── File upload helper ─────────────────────────────────────────────────────

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
};

// ── Tag input for phrase lists ─────────────────────────────────────────────

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
  };

  const remove = (val: string) => onChange(values.filter((v) => v !== val));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="text-sm flex-1"
        />
        <Button
          type="button"
          variant="outline"
          className="text-xs shrink-0"
          onClick={add}
          disabled={!input.trim()}
        >
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Badge
              key={v}
              variant="secondary"
              className="text-xs rounded px-2 py-0.5 cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors"
              onClick={() => remove(v)}
            >
              {v} ×
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Colour swatch input ────────────────────────────────────────────────────

function ColorInput({
  label,
  value,
  onChange,
  description,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  description?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      {description && (
        <p className="text-[11px] text-muted-foreground">{description}</p>
      )}
      <div className="flex items-center gap-2">
        <div
          className="h-9 w-9 rounded-md border border-border shrink-0 cursor-pointer"
          style={{ backgroundColor: value }}
          onClick={() =>
            (
              document.getElementById(`color-${label}`) as HTMLInputElement
            )?.click()
          }
        />
        <input
          id={`color-${label}`}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="sr-only"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="text-sm font-mono-display h-9 uppercase"
          placeholder="#000000"
          maxLength={7}
        />
      </div>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-4 px-6 pt-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
            {icon}
          </div>
          <div>
            <CardTitle className="text-sm font-semibold text-foreground">
              {title}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6 space-y-5">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  description,
  children,
  required = false,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      {description && (
        <p className="text-[11px] text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function BrandPage() {
  const {
    brand,
    voiceProfile,
    updateBrand,
    updateDesignTokens,
    setVoiceProfile,
    reset,
    importedFromCrm,
  } = useBrandStore();
  const campaigns = useCampaignsStore((s) => s.campaigns);
  const [saved, setSaved] = useState(false);
  const [isTrainingVoice, setIsTrainingVoice] = useState(false);
  const [showCrmBanner, setShowCrmBanner] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const validateRequiredFields = () => {
    const errors: string[] = [];

    if (!brand.brandName.trim()) {
      errors.push("Brand Name is required");
    }
    if (!brand.voiceGuidelines.trim()) {
      errors.push("Voice Guidelines is required");
    }
    if (!brand.designTokens.primaryColor.trim()) {
      errors.push("Primary Color is required");
    }
    if (!brand.designTokens.secondaryColor.trim()) {
      errors.push("Secondary Color is required");
    }
    if (!brand.designTokens.accentColor.trim()) {
      errors.push("Accent Color is required");
    }
    if (!brand.designTokens.fontFamilyHeading.trim()) {
      errors.push("Heading Font is required");
    }
    if (!brand.designTokens.fontFamilyBody.trim()) {
      errors.push("Body Font is required");
    }

    return errors;
  };

  const handleSave = () => {
    const errors = validateRequiredFields();

    if (errors.length > 0) {
      const errorMessage = errors.join(", ");
      setValidationError(errorMessage);
      toast({
        title: "Validation Error",
        description: errorMessage,
        variant: "destructive",
      });
      return;
    }

    setValidationError(null);
    setSaved(true);
    toast({ title: "Brand saved", description: "Your brand settings have been saved." });
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTrainVoice = async () => {
    setIsTrainingVoice(true);
    try {
      const approved = campaigns.filter((c) => c.status === "approved" || c.status === "sent");
      const campaignExamples = approved.slice(0, 8).map((c) => `${c.name}: ${c.prompt}`);
      const htmlSamples = approved
        .flatMap((c) => c.emails.map((e) => e.htmlContent))
        .filter(Boolean)
        .slice(0, 6);
      const result = await trainBrandVoice({
        brand_name: brand.brandName,
        current_voice: brand.voiceGuidelines,
        campaign_examples: campaignExamples,
        approved_html_samples: htmlSamples,
      });
      setVoiceProfile(result.profile);
      updateBrand({
        voiceGuidelines: result.profile.style_summary || brand.voiceGuidelines,
      });
      toast({
        title: "Voice profile trained",
        description: result.reasoning || "Brand voice profile updated from approved campaigns.",
      });
    } catch (err) {
      toast({
        title: "Voice training failed",
        description: err instanceof Error ? err.message : "Could not train voice profile.",
        variant: "destructive",
      });
    } finally {
      setIsTrainingVoice(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* HubSpot import banner */}
      {importedFromCrm && showCrmBanner && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm dark:border-[#6B5D54]"
          style={{ backgroundColor: '#F0E8E0', border: '1px solid #E0D7CC', color: '#5D4E47' }}
        >
          <div className="flex items-center gap-3">
            <Plug className="h-4 w-4 shrink-0" style={{ color: '#8B7355' }} />
            <span>
              <strong>Imported from HubSpot CRM.</strong> Review the fields below — anything missing can be added manually or via your HubSpot company description.
            </span>
          </div>
          <button
            onClick={() => setShowCrmBanner(false)}
            className="shrink-0 transition-colors"
            style={{ color: '#8B7355' }}
            onMouseEnter={(e) => e.target.style.color = '#6B5D54'}
            onMouseLeave={(e) => e.target.style.color = '#8B7355'}
            aria-label="Close message"
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-start justify-between"
      >
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">
            Brand
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure your brand identity, voice, and design tokens used
            across all campaigns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="text-xs h-9"
            onClick={() => {
              reset();
              toast({ title: "Reset", description: "Brand settings reset to defaults." });
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button
            className="text-xs h-9 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleSave}
          >
            {saved ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </motion.div>

      <Tabs defaultValue="identity">
        <div className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Fields marked with</span>
          <span className="text-destructive font-semibold">*</span>
          <span>are required for the AI</span>
        </div>
        <TabsList className="mb-6">
          <TabsTrigger value="identity" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" />
            Identity
          </TabsTrigger>
          <TabsTrigger value="design" className="gap-1.5 text-xs">
            <Palette className="h-3.5 w-3.5" />
            Design
          </TabsTrigger>
          <TabsTrigger value="compliance" className="gap-1.5 text-xs">
            <Shield className="h-3.5 w-3.5" />
            Compliance
          </TabsTrigger>
          <TabsTrigger value="voice-training" className="gap-1.5 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Voice Training
          </TabsTrigger>
        </TabsList>

        {/* ── Identity tab ── */}
        <TabsContent value="identity">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <Section
              icon={<FileText className="h-4 w-4 text-primary" />}
              title="Brand Identity"
              description="Core brand information used to personalise every campaign."
            >
              <Field label="Brand Name" description="The name that appears in all email copy and headers." required>
                <Input
                  value={brand.brandName}
                  onChange={(e) => updateBrand({ brandName: e.target.value })}
                  placeholder="e.g. Acme Corp"
                  className="text-sm"
                />
              </Field>

              <Field
                label="Voice Guidelines"
                description="Describe your brand's tone, writing style, and communication principles."
                required
              >
                <Textarea
                  value={brand.voiceGuidelines}
                  onChange={(e) =>
                    updateBrand({ voiceGuidelines: e.target.value })
                  }
                  placeholder="e.g. Friendly, professional, action-oriented. Never use jargon. Keep sentences short."
                  className="min-h-[100px] text-sm resize-none"
                />
              </Field>

              <Field
                label="Banned Phrases"
                description='Words or phrases that must never appear in copy. Press Enter or comma to add.'
              >
                <TagInput
                  values={brand.bannedPhrases}
                  onChange={(v) => updateBrand({ bannedPhrases: v })}
                  placeholder='e.g. "world-class", "revolutionary"'
                />
              </Field>

              <Field
                label="Required Phrases"
                description="Phrases that must appear in every email (e.g. signature copy, trademark notices)."
              >
                <TagInput
                  values={brand.requiredPhrases}
                  onChange={(v) => updateBrand({ requiredPhrases: v })}
                  placeholder='e.g. "Unsubscribe"'
                />
              </Field>
            </Section>
          </motion.div>
        </TabsContent>

        {/* ── Design tab ── */}
        <TabsContent value="design">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <Section
              icon={<Palette className="h-4 w-4 text-primary" />}
              title="Design Tokens"
              description="Colour and typography settings applied to generated HTML emails."
            >
              {/* Auto design toggle */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Auto Design
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Let Mark choose a beautiful, cohesive colour palette
                    automatically. Disable to use your exact tokens below.
                  </p>
                </div>
                <Switch
                  checked={brand.designTokens.autoDesign}
                  onCheckedChange={(v) =>
                    updateDesignTokens({ autoDesign: v })
                  }
                />
              </div>

              {/* Colours */}
              <div
                className={`space-y-4 transition-opacity ${
                  brand.designTokens.autoDesign
                    ? "opacity-40 pointer-events-none"
                    : ""
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Colours
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <ColorInput
                    label="Primary"
                    value={brand.designTokens.primaryColor}
                    onChange={(v) => updateDesignTokens({ primaryColor: v })}
                    description="Header, CTA button"
                    required
                  />
                  <ColorInput
                    label="Secondary"
                    value={brand.designTokens.secondaryColor}
                    onChange={(v) =>
                      updateDesignTokens({ secondaryColor: v })
                    }
                    description="Backgrounds"
                    required
                  />
                  <ColorInput
                    label="Accent"
                    value={brand.designTokens.accentColor}
                    onChange={(v) => updateDesignTokens({ accentColor: v })}
                    description="Highlights"
                    required
                  />
                </div>

                {/* Typography */}
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-2">
                  Typography
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Heading Font"
                    description="Used for h1–h3 in email templates."
                    required
                  >
                    <Input
                      value={brand.designTokens.fontFamilyHeading}
                      onChange={(e) =>
                        updateDesignTokens({ fontFamilyHeading: e.target.value })
                      }
                      placeholder="Georgia, serif"
                      className="text-sm font-mono-display"
                    />
                  </Field>
                  <Field
                    label="Body Font"
                    description="Used for paragraphs and body copy."
                    required
                  >
                    <Input
                      value={brand.designTokens.fontFamilyBody}
                      onChange={(e) =>
                        updateDesignTokens({ fontFamilyBody: e.target.value })
                      }
                      placeholder="Arial, sans-serif"
                      className="text-sm font-mono-display"
                    />
                  </Field>
                </div>

                {/* Font sizing and spacing */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field
                    label="Base Font Size"
                    description="Default text size in emails."
                  >
                    <Input
                      value={brand.designTokens.fontSizeBase}
                      onChange={(e) =>
                        updateDesignTokens({ fontSizeBase: e.target.value })
                      }
                      placeholder="16px"
                      className="text-sm font-mono-display"
                    />
                  </Field>
                  <Field
                    label="Line Height"
                    description="Space between lines of text."
                  >
                    <Input
                      value={brand.designTokens.lineHeight}
                      onChange={(e) =>
                        updateDesignTokens({ lineHeight: e.target.value })
                      }
                      placeholder="1.6"
                      className="text-sm font-mono-display"
                    />
                  </Field>
                  <Field
                    label="Spacing Unit"
                    description="Base spacing increment for layouts."
                  >
                    <Input
                      value={brand.designTokens.spacingUnit}
                      onChange={(e) =>
                        updateDesignTokens({ spacingUnit: e.target.value })
                      }
                      placeholder="8px"
                      className="text-sm font-mono-display"
                    />
                  </Field>
                </div>

                {/* Other tokens */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Border Radius"
                    description="Corner rounding on cards and buttons."
                  >
                    <Input
                      value={brand.designTokens.borderRadius}
                      onChange={(e) =>
                        updateDesignTokens({ borderRadius: e.target.value })
                      }
                      placeholder="6px"
                      className="text-sm font-mono-display"
                    />
                  </Field>
                  <Field
                    label="Logo URL"
                    description="Publicly accessible URL for your logo image."
                  >
                    <div className="flex gap-2">
                      <Input
                        value={brand.designTokens.logoUrl}
                        onChange={(e) =>
                          updateDesignTokens({ logoUrl: e.target.value })
                        }
                        placeholder="https://example.com/logo.png"
                        className="text-sm"
                        type="url"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="text-xs h-10 shrink-0 gap-1.5"
                        onClick={() => document.getElementById("logo-upload")?.click()}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Upload
                      </Button>
                      <input
                        id="logo-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            try {
                              const base64 = await fileToBase64(file);
                              updateDesignTokens({ logoUrl: base64 });
                              toast({ title: "Logo uploaded", description: `${file.name} has been uploaded.` });
                            } catch (error) {
                              toast({ title: "Error", description: "Failed to upload logo.", variant: "destructive" });
                            }
                          }
                        }}
                      />
                    </div>
                  </Field>
                </div>

                {/* Logo preview */}
                {brand.designTokens.logoUrl && (
                  <div className="rounded-lg border border-border overflow-hidden bg-muted/30">
                    <div className="px-3 py-2 border-b border-border bg-muted/50 flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Logo Preview</span>
                    </div>
                    <div className="p-4 flex items-center justify-center">
                      <img
                        src={brand.designTokens.logoUrl}
                        alt="Logo preview"
                        className="max-h-20 max-w-[220px] object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Email Banner */}
                <div className="pt-2 border-t border-border/60 space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Email Banner
                  </p>
                  <Field
                    label="Banner Image URL"
                    description="Full-width hero image shown at the top of every email preview. Use a 600px wide image for best results."
                  >
                    <div className="flex gap-2">
                      <Input
                        value={brand.designTokens.bannerUrl}
                        onChange={(e) => updateDesignTokens({ bannerUrl: e.target.value })}
                        placeholder="https://example.com/banner.png"
                        className="text-sm"
                        type="url"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="text-xs h-10 shrink-0 gap-1.5"
                        onClick={() => document.getElementById("banner-upload")?.click()}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Upload
                      </Button>
                      <input
                        id="banner-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            try {
                              const base64 = await fileToBase64(file);
                              updateDesignTokens({ bannerUrl: base64 });
                              toast({ title: "Banner uploaded", description: `${file.name} has been uploaded.` });
                            } catch (error) {
                              toast({ title: "Error", description: "Failed to upload banner.", variant: "destructive" });
                            }
                          }
                        }}
                      />
                    </div>
                  </Field>
                  {brand.designTokens.bannerUrl && (
                    <div className="rounded-lg border border-border overflow-hidden bg-muted/30">
                      <div className="px-3 py-2 border-b border-border bg-muted/50 flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Banner Preview</span>
                      </div>
                      <img
                        src={brand.designTokens.bannerUrl}
                        alt="Email banner preview"
                        className="w-full max-h-40 object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Signature Image */}
                <div className="pt-2 border-t border-border/60 space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Signature Image
                  </p>
                  <Field
                    label="Signature Image URL"
                    description="Optional signature image shown at the bottom of every email. Best used for handwritten signatures or logos."
                  >
                    <div className="flex gap-2">
                      <Input
                        value={brand.designTokens.signatureImageUrl}
                        onChange={(e) => updateDesignTokens({ signatureImageUrl: e.target.value })}
                        placeholder="https://example.com/signature.png"
                        className="text-sm"
                        type="url"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="text-xs h-10 shrink-0 gap-1.5"
                        onClick={() => document.getElementById("signature-upload")?.click()}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Upload
                      </Button>
                      <input
                        id="signature-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            try {
                              const base64 = await fileToBase64(file);
                              updateDesignTokens({ signatureImageUrl: base64 });
                              toast({ title: "Signature uploaded", description: `${file.name} has been uploaded.` });
                            } catch (error) {
                              toast({ title: "Error", description: "Failed to upload signature.", variant: "destructive" });
                            }
                          }
                        }}
                      />
                    </div>
                  </Field>
                  {brand.designTokens.signatureImageUrl && (
                    <div className="rounded-lg border border-border overflow-hidden bg-muted/30">
                      <div className="px-3 py-2 border-b border-border bg-muted/50 flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Signature Preview</span>
                      </div>
                      <div className="p-4 flex items-center justify-center min-h-[80px]">
                        <img
                          src={brand.designTokens.signatureImageUrl}
                          alt="Signature preview"
                          className="max-h-16 max-w-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Section>
          </motion.div>
        </TabsContent>

        {/* ── Compliance tab ── */}
        <TabsContent value="compliance">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <Section
              icon={<Shield className="h-4 w-4 text-primary" />}
              title="Compliance & Legal"
              description="Text and rules applied to every campaign for regulatory compliance."
            >
              <Field
                label="Legal Footer"
                description="Boilerplate appended to every email — include unsubscribe link, address, copyright."
              >
                <Textarea
                  value={brand.legalFooter}
                  onChange={(e) => updateBrand({ legalFooter: e.target.value })}
                  placeholder="© 2026 Acme Corp. All rights reserved. Unsubscribe | Privacy Policy | 1 Main St, City, Country."
                  className="min-h-[100px] text-sm resize-none"
                />
              </Field>

              <div className="rounded-lg border border-border bg-muted/30 px-5 py-4 space-y-2">
                <p className="text-xs font-semibold text-foreground">
                  How these settings are used
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 leading-relaxed list-disc list-inside">
                  <li>
                    <span className="font-medium text-foreground">
                      Legal footer
                    </span>{" "}
                    is injected into every generated email's footer section.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      Banned phrases
                    </span>{" "}
                    are flagged during generation and won't appear in copy.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      Required phrases
                    </span>{" "}
                    are enforced in the AI prompt for every email.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      Approval workflow
                    </span>{" "}
                    on the Campaign Detail page requires Legal + Marketing
                    sign-off before sending.
                  </li>
                </ul>
              </div>

              {/* HubSpot description template */}
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Plug className="h-3.5 w-3.5 text-primary shrink-0" />
                    <p className="text-xs font-semibold text-foreground">
                      HubSpot auto-import template
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => {
                      navigator.clipboard.writeText(HUBSPOT_DESCRIPTION_TEMPLATE);
                      toast({ title: "Copied", description: "Paste into your HubSpot company Description field." });
                    }}
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste this into your HubSpot company <strong>Description</strong> field and fill in your values. Mark will parse it automatically on the next CRM sync.
                </p>
                <pre className="text-[11px] text-muted-foreground bg-background rounded-md p-3 overflow-x-auto border border-border leading-relaxed">
                  {HUBSPOT_DESCRIPTION_TEMPLATE}
                </pre>
              </div>
            </Section>
          </motion.div>
        </TabsContent>

        <TabsContent value="voice-training">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <Section
              icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
              title="Brand Voice Training Mode"
              description="Learn your writing style from approved and sent campaigns."
            >
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Uses your approved campaign history to infer tone patterns, vocabulary, and writing rules.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  className="text-xs h-9"
                  onClick={handleTrainVoice}
                  disabled={isTrainingVoice}
                >
                  {isTrainingVoice ? "Training..." : "Train Voice Profile"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Source campaigns: {campaigns.filter((c) => c.status === "approved" || c.status === "sent").length}
                </p>
              </div>

              {voiceProfile && (
                <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                  <p className="text-sm font-semibold text-foreground">Trained Voice Profile</p>
                  <p className="text-xs text-muted-foreground">{voiceProfile.style_summary}</p>
                  <p className="text-xs text-muted-foreground">
                    Confidence: <span className="text-foreground font-medium">{voiceProfile.confidence}</span>
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-foreground mb-1">Do</p>
                      {voiceProfile.do_list.slice(0, 5).map((item) => (
                        <p key={item} className="text-xs text-muted-foreground">- {item}</p>
                      ))}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground mb-1">Don't</p>
                      {voiceProfile.dont_list.slice(0, 5).map((item) => (
                        <p key={item} className="text-xs text-muted-foreground">- {item}</p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Section>
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
