import { useEffect, useRef } from "react";
import { useCampaignsStore } from "@/lib/campaigns-list-store";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { logError } from "@/core/errors/error-logger";
import { toast } from "@/components/ui/sonner";
import {
  deleteCloudCampaign,
  loadCloudCampaigns,
  upsertCloudCampaign,
} from "@/integrations/supabase/cloud-data";

export function useCloudCampaigns(): void {
  const user = useCloudAuthStore((s) => s.user);
  const campaigns = useCampaignsStore((s) => s.campaigns);
  const setCampaigns = useCampaignsStore((s) => s.setCampaigns);
  const hasLoadedRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const loadedUserIdRef = useRef<string | null>(null);
  const syncedIdsRef = useRef<Set<string>>(new Set());
  const lastErrorToastAtRef = useRef<number>(0);
  const hasSyncErrorRef = useRef<boolean>(false);

  const notifySyncIssue = (message: string) => {
    const now = Date.now();
    // Avoid repeated toast spam from debounce-driven sync attempts.
    if (now - lastErrorToastAtRef.current < 30_000) return;
    lastErrorToastAtRef.current = now;
    toast.error("Cloud sync issue", { description: message });
  };

  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (activeUserIdRef.current !== nextUserId) {
      setCampaigns([]);
      loadedUserIdRef.current = null;
      syncedIdsRef.current = new Set();
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
        syncedIdsRef.current = new Set(rows.map((row) => row.id));
        loadedUserIdRef.current = userId;
        hasLoadedRef.current = true;
      })
      .catch(() => {
        logError("cloud.load-campaigns", "Could not load campaigns from Supabase.");
        notifySyncIssue("Could not load cloud campaigns. Using local state for now.");
        if (cancelled) return;
        if (activeUserIdRef.current !== userId) return;
        // Fail closed to avoid syncing stale campaigns under the wrong user.
        setCampaigns([]);
        syncedIdsRef.current = new Set();
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
      void (async () => {
        const currentIds = new Set(campaigns.map((campaign) => campaign.id));
        const removedIds: string[] = [];
        syncedIdsRef.current.forEach((id) => {
          if (!currentIds.has(id)) removedIds.push(id);
        });
        try {
          await Promise.all([
            ...campaigns.map((campaign) => upsertCloudCampaign(user.id, campaign)),
            ...removedIds.map((id) => deleteCloudCampaign(user.id, id)),
          ]);
          syncedIdsRef.current = currentIds;
          if (hasSyncErrorRef.current) {
            hasSyncErrorRef.current = false;
            toast.success("Cloud sync restored", {
              description: "Your latest campaign changes are synced again.",
            });
          }
        } catch {
          hasSyncErrorRef.current = true;
          logError("cloud.sync-campaigns", "Failed to sync campaign changes to Supabase.");
          notifySyncIssue("Recent campaign changes could not sync. Retrying automatically.");
          // Keep last synced ids unchanged; next run retries reconciliation.
        }
      })();
    }, 350);
    return () => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    };
  }, [campaigns, user?.id]);
}
