import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CrmData } from "./crm-parser";
import { parseCrmData } from "./crm-parser";

export interface BrandDesignTokens {
  autoDesign: boolean;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamilyHeading: string;
  fontFamilyBody: string;
  borderRadius: string;
  logoUrl: string;
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
    borderRadius: "6px",
    logoUrl: "",
  },
};

interface BrandState {
  brand: BrandConfig;
  importedFromCrm: boolean;
  updateBrand: (updates: Partial<BrandConfig>) => void;
  updateDesignTokens: (updates: Partial<BrandDesignTokens>) => void;
  populateFromCrm: (data: CrmData) => void;
  reset: () => void;
}

export const useBrandStore = create<BrandState>()(
  persist(
    (set) => ({
      brand: DEFAULT_BRAND,
      importedFromCrm: false,
      updateBrand: (updates) =>
        set((state) => ({ brand: { ...state.brand, ...updates } })),
      updateDesignTokens: (updates) =>
        set((state) => ({
          brand: {
            ...state.brand,
            designTokens: { ...state.brand.designTokens, ...updates },
          },
        })),
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
      reset: () => set({ brand: DEFAULT_BRAND, importedFromCrm: false }),
    }),
    { name: "mark-brand" }
  )
);
