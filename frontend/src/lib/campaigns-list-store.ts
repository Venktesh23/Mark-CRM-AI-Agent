import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GeneratedEmail } from "./api";
import type { AiReport } from "./api";

export type CampaignStatus = "draft" | "in_review" | "approved" | "sent";

export interface ApprovalState {
  legal: boolean;
  marketing: boolean;
  notes: string;
}

export interface SavedCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  createdAt: string;
  prompt: string;
  emails: GeneratedEmail[];
  approvals: Record<string, ApprovalState>;
  emailAssignments: Record<string, string[]>;
  aiReport?: AiReport | null;
}

interface CampaignsListState {
  campaigns: SavedCampaign[];
  setCampaigns: (campaigns: SavedCampaign[]) => void;
  addCampaign: (campaign: SavedCampaign) => void;
  updateCampaign: (id: string, updates: Partial<SavedCampaign>) => void;
  deleteCampaign: (id: string) => void;
  updateApproval: (
    campaignId: string,
    emailId: string,
    approval: Partial<ApprovalState>
  ) => void;
  updateEmailHtml: (campaignId: string, emailId: string, html: string) => void;
  setEmailAssignment: (
    campaignId: string,
    emailId: string,
    recipients: string[]
  ) => void;
}

export const useCampaignsStore = create<CampaignsListState>()(
  persist(
    (set) => ({
      campaigns: [],
      setCampaigns: (campaigns) => set({ campaigns }),

      addCampaign: (campaign) =>
        set((state) => ({ campaigns: [campaign, ...state.campaigns] })),

      updateCampaign: (id, updates) =>
        set((state) => ({
          campaigns: state.campaigns.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        })),

      deleteCampaign: (id) =>
        set((state) => ({
          campaigns: state.campaigns.filter((c) => c.id !== id),
        })),

      updateApproval: (campaignId, emailId, approval) =>
        set((state) => ({
          campaigns: state.campaigns.map((c) => {
            if (c.id !== campaignId) return c;
            const existing: ApprovalState = c.approvals[emailId] ?? {
              legal: false,
              marketing: false,
              notes: "",
            };
            const updated = { ...existing, ...approval };
            const approvals = { ...c.approvals, [emailId]: updated };
            const allApproved = c.emails.every(
              (e) => approvals[e.id]?.legal && approvals[e.id]?.marketing
            );
            return {
              ...c,
              approvals,
              status:
                c.status === "sent"
                  ? "sent"
                  : allApproved
                  ? "approved"
                  : "in_review",
            };
          }),
        })),

      updateEmailHtml: (campaignId, emailId, html) =>
        set((state) => ({
          campaigns: state.campaigns.map((c) => {
            if (c.id !== campaignId) return c;
            return {
              ...c,
              emails: c.emails.map((e) =>
                e.id === emailId ? { ...e, htmlContent: html } : e
              ),
            };
          }),
        })),

      setEmailAssignment: (campaignId, emailId, recipients) =>
        set((state) => ({
          campaigns: state.campaigns.map((c) => {
            if (c.id !== campaignId) return c;
            return {
              ...c,
              emailAssignments: {
                ...c.emailAssignments,
                [emailId]: recipients,
              },
            };
          }),
        })),
    }),
    { name: "mark-campaigns" }
  )
);
