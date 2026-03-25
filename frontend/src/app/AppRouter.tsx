import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Index from "@/pages/Index";
import CreatePage from "@/pages/CreatePage";
import ReviewPage from "@/pages/ReviewPage";
import CampaignsPage from "@/pages/CampaignsPage";
import CampaignDetailPage from "@/pages/CampaignDetailPage";
import SendPage from "@/pages/SendPage";
import BrandPage from "@/pages/BrandPage";
import SettingsPage from "@/pages/SettingsPage";
import NotFound from "@/pages/NotFound";
import LoginPage from "@/features/auth/LoginPage";
import SignupPage from "@/features/auth/SignupPage";
import LandingPage from "@/features/auth/LandingPage";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { useCloudCampaigns } from "@/features/campaigns/use-cloud-campaigns";

function ProtectedApp() {
  const cloudInitialized = useCloudAuthStore((s) => s.initialized);
  const cloudUser = useCloudAuthStore((s) => s.user);
  useCloudCampaigns();
  const e2eBypass =
    import.meta.env.VITE_E2E_BYPASS_AUTH === "true" &&
    typeof window !== "undefined" &&
    (
      new URLSearchParams(window.location.search).get("e2eBypass") === "1" ||
      window.localStorage.getItem("mark.e2e.auth.bypass") === "true"
    );

  if (!cloudInitialized) {
    return <div className="min-h-screen bg-background" />;
  }
  if (!cloudUser && !e2eBypass) return <Navigate to="/welcome" replace />;

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/send" element={<SendPage />} />
        <Route path="/brand" element={<BrandPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/welcome" element={<LandingPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<Navigate to="/signup" replace />} />
        <Route path="/cloud-auth" element={<Navigate to="/login" replace />} />
        <Route path="/*" element={<ProtectedApp />} />
      </Routes>
    </BrowserRouter>
  );
}
