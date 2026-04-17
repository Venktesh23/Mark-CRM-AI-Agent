import { FormEvent, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Sparkles, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/supabase-client";
import { setLocalOnlyMode } from "@/core/settings/runtime-settings";

export default function LandingPage() {
  const navigate = useNavigate();
  const cloudInitialized = useCloudAuthStore((s) => s.initialized);
  const cloudUser = useCloudAuthStore((s) => s.user);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => email.trim() && password.trim().length >= 6, [email, password]);

  if (cloudInitialized && cloudUser) return <Navigate to="/" replace />;

  const onAuthSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  const onGoogleSignIn = async () => {
    if (!supabase) return;
    setGoogleLoading(true);
    setError(null);
    try {
      const { error: googleError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (googleError) throw googleError;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign in failed.");
      setGoogleLoading(false);
    }
  };

  if (!isSupabaseConfigured) {
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
                </p>
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
                  <img src="/mark-logo.png" alt="Mark" className="h-11 w-11" />
                  <div>
                    <p className="text-xl font-semibold">Configuration Error</p>
                    <p className="text-base text-muted-foreground">
                      Cloud auth not configured
                    </p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `frontend/.env`.
                </p>
                <Button
                  onClick={() => {
                    setLocalOnlyMode(true);
                    navigate("/onboarding", { replace: true });
                  }}
                >
                  Use local mode instead
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center">
      <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
        <div className="grid gap-12 md:grid-cols-[1.15fr_0.85fr] md:items-center">
          <div className="space-y-8">
            <div className="space-y-5">
              <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl leading-[1.02]">
                Build and send better campaigns with <span className="gradient-text">Mark</span>
              </h1>
              <p className="max-w-2xl text-lg text-muted-foreground leading-relaxed">
                Create campaign emails with AI, review and edit quickly, match recipients, and send in one workflow.
              </p>
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

          <Card className="rounded-[2rem] border-border bg-card/80 backdrop-blur">
            <CardHeader className="space-y-2 text-center">
              <CardTitle className="text-2xl">Welcome back</CardTitle>
              <p className="text-sm text-muted-foreground">Enter your details to access your account.</p>
            </CardHeader>
            <CardContent className="pt-0 space-y-6">
              {/* Google Sign In Button */}
              <Button
                type="button"
                variant="outline"
                className="w-full h-12 border-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 text-foreground"
                onClick={onGoogleSignIn}
                disabled={googleLoading}
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {googleLoading ? "Signing in..." : "Continue with Google"}
              </Button>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300 dark:border-gray-700"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="px-2 bg-card text-muted-foreground font-medium">Or email</span>
                </div>
              </div>

              {/* Email/Password Form */}
              <form className="w-full space-y-4" onSubmit={onAuthSubmit}>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Email Address</label>
                  <Input 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    type="email"
                    placeholder="name@company.com"
                    className="h-12 bg-gray-50 dark:bg-slate-900/50 border-gray-200 dark:border-slate-700 rounded-lg"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Password</label>
                    <a href="/forgot-password" className="text-xs font-medium text-orange-600 hover:text-orange-700 dark:text-orange-500 dark:hover:text-orange-400">
                      Forgot?
                    </a>
                  </div>
                  <div className="relative">
                    <Input 
                      value={password} 
                      onChange={(e) => setPassword(e.target.value)} 
                      type={showPassword ? "text" : "password"}
                      className="h-12 bg-gray-50 dark:bg-slate-900/50 border-gray-200 dark:border-slate-700 rounded-lg pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>
                {error && (
                  <p className="text-sm rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 px-4 py-3">
                    {error}
                  </p>
                )}
                <button 
                  type="submit" 
                  className="w-full h-12 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-orange-600 hover:bg-orange-700"
                  disabled={!canSubmit || loading}
                >
                  {loading ? "Please wait..." : "Sign in to Mark"}
                </button>
                <p className="text-sm text-center text-muted-foreground">
                  No account?{" "}
                  <a href="/signup" className="font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-500 dark:hover:text-orange-400">
                    Create one
                  </a>
                </p>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
