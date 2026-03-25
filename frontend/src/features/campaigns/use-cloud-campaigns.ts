import { useEffect, useRef } from "react";
import { useCampaignsStore } from "@/lib/campaigns-list-store";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { loadCloudCampaigns, upsertCloudCampaign } from "@/integrations/supabase/cloud-data";

export function useCloudCampaigns(): void {
  const user = useCloudAuthStore((s) => s.user);
  const campaigns = useCampaignsStore((s) => s.campaigns);
  const setCampaigns = useCampaignsStore((s) => s.setCampaigns);
  const hasLoadedRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const loadedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (activeUserIdRef.current !== nextUserId) {
      setCampaigns([]);
      loadedUserIdRef.current = null;
    }
    activeUserIdRef.current = nextUserId;
    hasLoadedRef.current = false;
  }, [user?.id, setCampaigns]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const userId = user.id;
    void loadCloudCampaigns(user.id)
      .then((rows) => {
        if (cancelled) return;
        if (activeUserIdRef.current !== userId) return;
        setCampaigns(rows);
        loadedUserIdRef.current = userId;
        hasLoadedRef.current = true;
      })
      .catch(() => {
        if (cancelled) return;
        if (activeUserIdRef.current !== userId) return;
        // Fail closed to avoid syncing stale campaigns under the wrong user.
        setCampaigns([]);
        loadedUserIdRef.current = userId;
        hasLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, setCampaigns]);

  useEffect(() => {
    if (!user?.id || !hasLoadedRef.current) return;
    if (loadedUserIdRef.current !== user.id) return;
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      void Promise.all(campaigns.map((campaign) => upsertCloudCampaign(user.id, campaign)));
    }, 350);
    return () => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    };
  }, [campaigns, user?.id]);
}
