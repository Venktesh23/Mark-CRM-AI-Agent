import { create } from "zustand";
import { persist } from "zustand/middleware";
import { parseContactSegments, type HubSpotSegment, type CrmData } from "./crm-parser";

interface HubSpotContactsState {
  segments: HubSpotSegment[];
  rawContactsCsv: string | null;
  lastFetchedAt: string | null;
  populateSegments: (data: CrmData) => void;
  clearSegments: () => void;
}

export const useHubSpotContactsStore = create<HubSpotContactsState>()(
  persist(
    (set) => ({
      segments: [],
      rawContactsCsv: null,
      lastFetchedAt: null,
      populateSegments: (data) => {
        const segments = parseContactSegments(data);
        set({ segments, rawContactsCsv: data.contactsCsv ?? null, lastFetchedAt: data.fetchedAt });
      },
      clearSegments: () => set({ segments: [], rawContactsCsv: null, lastFetchedAt: null }),
    }),
    { name: "mark-hubspot-contacts" }
  )
);
