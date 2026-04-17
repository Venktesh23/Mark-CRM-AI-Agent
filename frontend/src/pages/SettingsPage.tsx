import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useAuthStore } from "@/core/auth/auth-store";
import { getLocalOnlyMode, setLocalOnlyMode } from "@/core/settings/runtime-settings";
import { resetAllAppData } from "@/core/app/reset-app-data";
import { DEMO_CRM_DATA } from "@/features/demo/demo-data";
import { useHubSpotStore } from "@/lib/hubspot-store";
import { useBrandStore } from "@/lib/brand-store";
import { useHubSpotContactsStore } from "@/lib/hubspot-contacts-store";


export default function SettingsPage() {
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const [localOnly, setLocalOnly] = useState(getLocalOnlyMode());
  const setConnected = useHubSpotStore((s) => s.setConnected);
  const setLastSyncedAt = useHubSpotStore((s) => s.setLastSyncedAt);
  const populateFromCrm = useBrandStore((s) => s.populateFromCrm);
  const populateSegments = useHubSpotContactsStore((s) => s.populateSegments);
  const darkModeEnabled = resolvedTheme === "dark";

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
    navigate("/welcome", { replace: true });
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
          <Button variant="default" onClick={resetData}>
            Reset app data
          </Button>
        </CardContent>
      </Card>


    </div>
  );
}
