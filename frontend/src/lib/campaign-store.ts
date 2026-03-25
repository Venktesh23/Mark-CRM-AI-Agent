import { create } from "zustand";
import type { GeneratedEmail } from "./mock-api";

interface CampaignState {
  // Step tracking
  currentStep: number;
  setStep: (step: number) => void;

  // Create page
  prompt: string;
  setPrompt: (prompt: string) => void;

  // Review page
  generatedEmails: GeneratedEmail[];
  setGeneratedEmails: (emails: GeneratedEmail[]) => void;
  updateEmailHtml: (id: string, html: string) => void;

  // Send page
  emailAssignments: Record<string, string[]>;
  setRecipients: (emailId: string, recipients: string[]) => void;

  // Loading
  isGenerating: boolean;
  setIsGenerating: (loading: boolean) => void;

  // Reset
  reset: () => void;
}

export const useCampaignStore = create<CampaignState>((set) => ({
  currentStep: 0,
  setStep: (step) => set({ currentStep: step }),

  prompt: "",
  setPrompt: (prompt) => set({ prompt }),

  generatedEmails: [],
  setGeneratedEmails: (emails) => set({ generatedEmails: emails }),
  updateEmailHtml: (id, html) =>
    set((state) => ({
      generatedEmails: state.generatedEmails.map((e) =>
        e.id === id ? { ...e, htmlContent: html } : e
      ),
    })),

  emailAssignments: {},
  setRecipients: (emailId, recipients) =>
    set((state) => ({
      emailAssignments: { ...state.emailAssignments, [emailId]: recipients },
    })),

  isGenerating: false,
  setIsGenerating: (loading) => set({ isGenerating: loading }),

  reset: () =>
    set({
      currentStep: 0,
      prompt: "",
      generatedEmails: [],
      emailAssignments: {},
      isGenerating: false,
    }),
}));
