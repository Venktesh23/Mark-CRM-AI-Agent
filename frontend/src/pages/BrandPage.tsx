import { useState } from "react";
import { motion } from "framer-motion";
import { Save, RotateCcw, Palette, FileText, Shield, CheckCircle2, Plug, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useBrandStore } from "@/lib/brand-store";
import { HUBSPOT_DESCRIPTION_TEMPLATE } from "@/lib/crm-parser";
import { toast } from "@/hooks/use-toast";

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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
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
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {description && (
        <p className="text-[11px] text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function BrandPage() {
  const { brand, updateBrand, updateDesignTokens, reset, importedFromCrm } = useBrandStore();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    toast({ title: "Brand saved", description: "Your brand settings have been saved." });
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-8">
      {/* HubSpot import banner */}
      {importedFromCrm && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        >
          <Plug className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>
            <strong>Imported from HubSpot CRM.</strong> Review the fields below — anything missing can be added manually or via your HubSpot company description.
          </span>
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
              <Field label="Brand Name" description="The name that appears in all email copy and headers.">
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
                  />
                  <ColorInput
                    label="Secondary"
                    value={brand.designTokens.secondaryColor}
                    onChange={(v) =>
                      updateDesignTokens({ secondaryColor: v })
                    }
                    description="Backgrounds"
                  />
                  <ColorInput
                    label="Accent"
                    value={brand.designTokens.accentColor}
                    onChange={(v) => updateDesignTokens({ accentColor: v })}
                    description="Highlights"
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
                    <Input
                      value={brand.designTokens.logoUrl}
                      onChange={(e) =>
                        updateDesignTokens({ logoUrl: e.target.value })
                      }
                      placeholder="https://example.com/logo.png"
                      className="text-sm"
                      type="url"
                    />
                  </Field>
                </div>

                {/* Logo preview */}
                {brand.designTokens.logoUrl && (
                  <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-center justify-center">
                    <img
                      src={brand.designTokens.logoUrl}
                      alt="Logo preview"
                      className="max-h-16 max-w-[200px] object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                )}
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
      </Tabs>
    </div>
  );
}
