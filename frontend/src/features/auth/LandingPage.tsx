import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import markLogo from "@/assets/mark-logo.png";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";

export default function LandingPage() {
  const navigate = useNavigate();
  const cloudInitialized = useCloudAuthStore((s) => s.initialized);
  const cloudUser = useCloudAuthStore((s) => s.user);

  if (cloudInitialized && cloudUser) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background flex items-center">
      <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
        <div className="grid gap-12 md:grid-cols-[1.15fr_0.85fr] md:items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              AI campaign generation for student builders
            </div>
            <div className="space-y-5">
              <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl leading-[1.02]">
                Build and send better campaigns with <span className="gradient-text">Mark</span>
              </h1>
              <p className="max-w-2xl text-lg text-muted-foreground leading-relaxed">
                Create campaign emails with AI, review and edit quickly, match recipients, and send in one workflow.
                Sign in to enter your workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                className="h-12 px-9 text-base"
                onClick={() => navigate("/signup")}
              >
                Create account
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-9 text-base"
                onClick={() => navigate("/login")}
              >
                Log in
              </Button>
            </div>
            <div className="flex flex-wrap gap-3.5 pt-2">
              {["AI Drafting", "Approval Flow", "CRM Integration", "Local Demo Mode"].map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground"
                >
                  <CheckCircle2 className="h-3 w-3 text-primary" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <Card className="border-border bg-card/80 backdrop-blur">
            <CardContent className="p-9 space-y-6">
              <div className="flex items-center gap-3.5">
                <img src={markLogo} alt="Mark" className="h-11 w-11" />
                <div>
                  <p className="text-xl font-semibold">Mark Workspace</p>
                  <p className="text-base text-muted-foreground">
                    Cloud auth mode enabled
                  </p>
                </div>
              </div>
              <div className="space-y-3 text-base text-muted-foreground">
                <p>Use Supabase sign-up/login to sync campaigns per user.</p>
                <p>
                  After login, you will see the in-app home with <span className="font-medium text-foreground">Meet Mark</span> and CRM connection.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                Tip: Complete sign up once, then use login on future visits.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
