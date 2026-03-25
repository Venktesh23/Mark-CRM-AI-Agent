import { create } from "zustand";
import { persist } from "zustand/middleware";

interface HubSpotStore {
  connected: boolean;
  lastSyncedAt: string | null;
  setConnected: (v: boolean) => void;
  setLastSyncedAt: (iso: string) => void;
}

export const useHubSpotStore = create<HubSpotStore>()(
  persist(
    (set) => ({
      connected: false,
      lastSyncedAt: null,
      setConnected: (v) => set({ connected: v }),
      setLastSyncedAt: (iso) => set({ lastSyncedAt: iso }),
    }),
    { name: "mark-hubspot" }
  )
);
