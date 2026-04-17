import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CrmData } from "./crm-parser";
import { parseCrmData } from "./crm-parser";
import type { VoiceProfile } from "./api";

export interface BrandDesignTokens {
  autoDesign: boolean;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamilyHeading: string;
  fontFamilyBody: string;
  fontSizeBase: string;
  lineHeight: string;
  spacingUnit: string;
  borderRadius: string;
  logoUrl: string;
  bannerUrl: string;
  signatureImageUrl: string;
}

export interface BrandConfig {
  brandName: string;
  voiceGuidelines: string;
  bannedPhrases: string[];
  requiredPhrases: string[];
  legalFooter: string;
  designTokens: BrandDesignTokens;
}

export const DEFAULT_BRAND: BrandConfig = {
  brandName: "",
  voiceGuidelines: "",
  bannedPhrases: [],
  requiredPhrases: [],
  legalFooter: "",
  designTokens: {
    autoDesign: true,
    primaryColor: "#6366f1",
    secondaryColor: "#ffffff",
    accentColor: "#f59e0b",
    fontFamilyHeading: "Georgia, serif",
    fontFamilyBody: "Arial, sans-serif",
    fontSizeBase: "16px",
    lineHeight: "1.6",
    spacingUnit: "8px",
    borderRadius: "6px",
    logoUrl: "",
    bannerUrl: "",
    signatureImageUrl: "",
  },
};

interface BrandState {
  brand: BrandConfig;
  importedFromCrm: boolean;
  voiceProfile: VoiceProfile | null;
  updateBrand: (updates: Partial<BrandConfig>) => void;
  updateDesignTokens: (updates: Partial<BrandDesignTokens>) => void;
  setVoiceProfile: (profile: VoiceProfile | null) => void;
  populateFromCrm: (data: CrmData) => void;
  reset: () => void;
}

export const useBrandStore = create<BrandState>()(
  persist(
    (set) => ({
      brand: DEFAULT_BRAND,
      importedFromCrm: false,
      voiceProfile: null,
      updateBrand: (updates) =>
        set((state) => ({ brand: { ...state.brand, ...updates } })),
      updateDesignTokens: (updates) =>
        set((state) => ({
          brand: {
            ...state.brand,
            designTokens: { ...state.brand.designTokens, ...updates },
          },
        })),
      setVoiceProfile: (profile) => set({ voiceProfile: profile }),
      populateFromCrm: (data: CrmData) => {
        const partial = parseCrmData(data);
        set((state) => ({
          importedFromCrm: true,
          brand: {
            ...state.brand,
            ...partial,
            designTokens: {
              ...state.brand.designTokens,
              ...(partial.designTokens ?? {}),
            },
          },
        }));
      },
      reset: () => set({ brand: DEFAULT_BRAND, importedFromCrm: false, voiceProfile: null }),
    }),
    { name: "mark-brand" }
  )
);
