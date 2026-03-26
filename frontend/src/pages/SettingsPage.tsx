import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useAuthStore } from "@/core/auth/auth-store";
import { getLocalOnlyMode, setLocalOnlyMode } from "@/core/settings/runtime-settings";
import { resetAllAppData } from "@/core/app/reset-app-data";
import { DEMO_CRM_DATA } from "@/features/demo/demo-data";
import { useHubSpotStore } from "@/lib/hubspot-store";
import { useBrandStore } from "@/lib/brand-store";
import { useHubSpotContactsStore } from "@/lib/hubspot-contacts-store";
import { getAgentMetrics, type AgentMetricItem } from "@/lib/api";

export default function SettingsPage() {
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const sessionTimeoutMs = useAuthStore((s) => s.sessionTimeoutMs);
  const setSessionTimeoutMs = useAuthStore((s) => s.setSessionTimeoutMs);
  const [localOnly, setLocalOnly] = useState(getLocalOnlyMode());
  const [timeoutMinutes, setTimeoutMinutes] = useState(
    Math.round(sessionTimeoutMs / 60000).toString()
  );
  const setConnected = useHubSpotStore((s) => s.setConnected);
  const setLastSyncedAt = useHubSpotStore((s) => s.setLastSyncedAt);
  const populateFromCrm = useBrandStore((s) => s.populateFromCrm);
  const populateSegments = useHubSpotContactsStore((s) => s.populateSegments);
  const [agentMetrics, setAgentMetrics] = useState<AgentMetricItem[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  const timeoutValue = useMemo(() => Number(timeoutMinutes), [timeoutMinutes]);
  const darkModeEnabled = resolvedTheme === "dark";

  const saveTimeout = () => {
    if (!Number.isFinite(timeoutValue) || timeoutValue < 1) {
      toast({
        title: "Invalid timeout",
        description: "Enter a valid number of minutes (minimum 1).",
        variant: "destructive",
      });
      return;
    }
    setSessionTimeoutMs(timeoutValue * 60_000);
    toast({ title: "Session timeout updated", description: `Lock after ${timeoutValue} minute(s).` });
  };

  const toggleLocalOnly = (enabled: boolean) => {
    setLocalOnly(enabled);
    setLocalOnlyMode(enabled);
    toast({
      title: enabled ? "Local-only mode enabled" : "Local-only mode disabled",
      description: enabled
        ? "Campaign features now run without backend dependency."
        : "Backend APIs will be used when available.",
    });
  };

  const loadDemoData = () => {
    setConnected(true);
    setLastSyncedAt(DEMO_CRM_DATA.fetchedAt);
    populateFromCrm(DEMO_CRM_DATA);
    populateSegments(DEMO_CRM_DATA);
    setLocalOnlyMode(true);
    setLocalOnly(true);
    toast({
      title: "Demo data loaded",
      description: "Sample CRM and brand data are ready. Local-only mode is enabled.",
    });
    navigate("/create");
  };

  const resetData = () => {
    resetAllAppData();
    toast({
      title: "App data reset",
      description: "All local data was cleared. You can onboard again.",
    });
    navigate("/signup", { replace: true });
  };

  const refreshAgentMetrics = async () => {
    setLoadingMetrics(true);
    try {
      const data = await getAgentMetrics();
      setAgentMetrics(data.metrics ?? []);
    } catch {
      setAgentMetrics([]);
      toast({
        title: "Metrics unavailable",
        description: "Could not load agent observability metrics right now.",
        variant: "destructive",
      });
    } finally {
      setLoadingMetrics(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage local development options and reset data quickly.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Dark mode</p>
              <p className="text-xs text-muted-foreground">
                Use a darker theme that is easier on the eyes.
              </p>
            </div>
            <Switch
              checked={darkModeEnabled}
              onCheckedChange={(enabled) => setTheme(enabled ? "dark" : "light")}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Lock timeout (minutes)</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={timeoutMinutes}
                onChange={(e) => setTimeoutMinutes(e.target.value)}
                className="max-w-[160px]"
              />
              <Button variant="outline" onClick={saveTimeout}>
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Local Mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Use local-only mode</p>
              <p className="text-xs text-muted-foreground">
                Keep all auth and campaign data on this device. Disable to require cloud login via Supabase.
              </p>
            </div>
            <Switch checked={localOnly} onCheckedChange={toggleLocalOnly} />
          </div>
          <Button variant="outline" onClick={loadDemoData}>
            Load demo data
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Maintenance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Reset all local stores, auth state, and cached data.
          </p>
          <Button variant="destructive" onClick={resetData}>
            Reset app data
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent Observability</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Inspect runtime calls, fallback rate, and average latency for your AI agents.
          </p>
          <Button variant="outline" onClick={refreshAgentMetrics} disabled={loadingMetrics}>
            {loadingMetrics ? "Refreshing…" : "Refresh metrics"}
          </Button>
          {agentMetrics.length > 0 && (
            <div className="rounded-lg border border-border divide-y divide-border">
              {agentMetrics.slice(0, 8).map((item) => (
                <div key={item.agent} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{item.agent}</span>
                  <span className="text-muted-foreground">
                    calls {item.calls} | success {item.success} | fallback {item.fallback} | avg {item.avg_latency_ms}ms
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
