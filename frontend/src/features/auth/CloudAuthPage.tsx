import { FormEvent, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/supabase-client";
import { setLocalOnlyMode } from "@/core/settings/runtime-settings";

export default function CloudAuthPage() {
  const navigate = useNavigate();
  const user = useCloudAuthStore((s) => s.user);
  const initialized = useCloudAuthStore((s) => s.initialized);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canSubmit = useMemo(() => email.trim() && password.trim().length >= 6, [email, password]);

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-border">
          <CardHeader>
            <CardTitle>Cloud auth is not configured</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
    );
  }

  if (initialized && user) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !supabase) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: name.trim() || undefined,
            },
          },
        });
        if (signUpError) throw signUpError;
        setMessage("Account created. Check your email confirmation link if required, then sign in.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">{isSignUp ? "Create cloud account" : "Cloud sign in"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {isSignUp
              ? "Create an account to sync campaigns across devices."
              : "Sign in to access your cloud campaigns and profile."}
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            {isSignUp && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Name (optional)</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
            </div>
            {error && (
              <p className="text-sm rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2">
                {error}
              </p>
            )}
            {message && (
              <p className="text-sm rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 px-3 py-2">
                {message}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={!canSubmit || loading}>
              {loading ? "Please wait..." : isSignUp ? "Create account" : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setIsSignUp((v) => !v)}
            >
              {isSignUp ? "Already have an account? Sign in" : "No account? Create one"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
