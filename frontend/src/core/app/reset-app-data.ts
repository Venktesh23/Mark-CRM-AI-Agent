import { safeStorageRemove } from "@/core/io/safe-storage";
import { useAuthStore } from "@/core/auth/auth-store";
import { useCampaignStore } from "@/lib/campaign-store";
import { useCampaignsStore } from "@/lib/campaigns-list-store";
import { useBrandStore } from "@/lib/brand-store";
import { useHubSpotStore } from "@/lib/hubspot-store";
import { useHubSpotContactsStore } from "@/lib/hubspot-contacts-store";
import { supabase } from "@/integrations/supabase/supabase-client";

const PERSIST_KEYS = [
  "mark-auth",
  "mark-campaigns",
  "mark-brand",
  "mark-hubspot",
  "mark-hubspot-contacts",
];

export function resetAllAppData(): void {
  if (supabase) {
    void supabase.auth.signOut();
  }
  useCampaignStore.getState().reset();
  useCampaignsStore.setState({ campaigns: [] });
  useBrandStore.getState().reset();
  useHubSpotStore.setState({ connected: false, lastSyncedAt: null });
  useHubSpotContactsStore.getState().clearSegments();
  useAuthStore.getState().resetAuth();

  for (const key of PERSIST_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // no-op
    }
  }
  safeStorageRemove("settings.localOnly");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("mark:local-only-changed"));
  }
}
