import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, Link2, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useHubSpotStore } from "@/lib/hubspot-store";
import { useBrandStore } from "@/lib/brand-store";
import { useHubSpotContactsStore } from "@/lib/hubspot-contacts-store";
import { safeAsync } from "@/core/async/safe-async";
import { fetchCrmData, getHubspotAuthUrl, refreshCrmData } from "@/features/integrations/hubspot-client";
import { DEMO_CRM_DATA } from "@/features/demo/demo-data";
import { getUserErrorMessage } from "@/core/errors/user-message";
import { setLocalOnlyMode } from "@/core/settings/runtime-settings";

export default function Index() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { connected, lastSyncedAt, setConnected, setLastSyncedAt } = useHubSpotStore();
  const populateFromCrm = useBrandStore((s) => s.populateFromCrm);
  const brandName = useBrandStore((s) => s.brand.brandName);
  const populateSegments = useHubSpotContactsStore((s) => s.populateSegments);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // When user comes back from HubSpot (via your backend redirect)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const connected = params.get("connected");
    const error = params.get("error");

    if (connected === "1") {
      setConnected(true);
      safeAsync(async () => {
        const data = await fetchCrmData();
        populateFromCrm(data);
        populateSegments(data);
        setLastSyncedAt(data.fetchedAt ?? new Date().toISOString());
        toast({
          title: "CRM connected and brand imported",
          description: "HubSpot data loaded. Review your brand settings.",
        });
        navigate("/brand", { replace: true });
      }, () => {
        toast({
          title: "CRM connected",
          description: "HubSpot linked, but data import failed. Try Sync or use demo data.",
        });
        navigate("/create", { replace: true });
      });
    } else if (error) {
      toast({
        variant: "destructive",
        title: "Connection failed",
        description:
          "Could not connect to HubSpot. Check app redirect URL and ensure hubspotserver is running on port 3000.",
      });
      // Clear query params so the toast doesn't repeat on refresh
      navigate("/", { replace: true });
    }
  }, [
    location.search,
    toast,
    navigate,
    setConnected,
    populateFromCrm,
    populateSegments,
    setLastSyncedAt,
  ]);

  const handleConnect = () => {
    setConnecting(true);
    window.location.href = getHubspotAuthUrl();
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const data = await refreshCrmData();
      populateFromCrm(data);
      populateSegments(data);
      setLastSyncedAt(data.fetchedAt ?? new Date().toISOString());
      toast({ title: "HubSpot synced", description: "Contacts and brand data are up to date." });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: getUserErrorMessage(error, "Could not refresh HubSpot data. Try reconnecting."),
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-16 py-12">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="text-center space-y-6"
      >
        <motion.img
          src="/mark-logo.png"
          alt="Mark"
          className="mx-auto h-16 w-16"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        />

        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl text-foreground leading-[1.05]">
          <span className="gradient-text">Integrate</span> Your CRM
        </h1>

        <p className="mx-auto max-w-xl text-lg text-muted-foreground leading-relaxed">
          Integrations connect your business tools to Mark. Link your CRM to automatically access customer data,
          populate campaigns with real contacts, and let AI generate personalized content across all your platforms.
        </p>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="flex flex-wrap justify-center gap-3 pt-2"
        >
          {["AI Campaign Generation", "Email Personalization", "Multi-Region Targeting"].map(
            (tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
              >
                <Sparkles className="h-3 w-3 text-primary" />
                {tag}
              </span>
            )
          )}
        </motion.div>
      </motion.div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-6"
      >
        <AnimatePresence mode="wait">
          {connected ? (
            <motion.div
              key="connected"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center gap-11"
            >
              <div className="flex items-center gap-3 rounded-xl px-6 py-4" style={{ backgroundColor: '#F0E8E0', border: '1px solid #E0D7CC' }}>
                <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0" style={{ color: '#8B7355', }} />
                <div className="text-left">
                  <p className="text-sm font-semibold" style={{ color: '#5D4E47' }}>
                    HubSpot configured{brandName ? ` · ${brandName}` : ""}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#8B7355' }}>
                    {lastSyncedAt
                      ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}`
                      : "CRM connected and brand data imported"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  size="lg"
                  className="h-12 px-8 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => navigate("/campaigns")}
                >
                  Go to Campaigns
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 px-4 text-sm"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {syncing ? "Syncing…" : "Sync"}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-12 px-4 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setConnected(false);
                    setConnecting(false);
                  }}
                >
                  Reconnect
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="disconnected"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center gap-3"
            >
              <Button
                size="lg"
                className="h-14 px-10 text-base font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-md"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Connecting to HubSpot…
                  </>
                ) : (
                  <>
                    <Link2 className="h-5 w-5" />
                    Connect your CRM via HubSpot
                    <ArrowRight className="h-5 w-5" />
                  </>
                )}
              </Button>
              <p className="text-sm text-muted-foreground">
                Import contacts and start building campaigns in minutes
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLocalOnlyMode(true);
                  setConnected(true);
                  populateFromCrm(DEMO_CRM_DATA);
                  populateSegments(DEMO_CRM_DATA);
                  setLastSyncedAt(DEMO_CRM_DATA.fetchedAt);
                  toast({
                    title: "Demo mode enabled",
                    description: "Sample CRM data loaded. You can start creating campaigns now.",
                  });
                  navigate("/create");
                }}
              >
                Use demo data
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}