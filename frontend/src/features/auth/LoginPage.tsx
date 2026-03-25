import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/supabase-client";

export default function LoginPage() {
  const navigate = useNavigate();
  const cloudInitialized = useCloudAuthStore((s) => s.initialized);
  const cloudUser = useCloudAuthStore((s) => s.user);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (cloudInitialized && cloudUser) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured. Add env keys first.");
      return;
    }
    if (!email.trim() || !password.trim()) {
      setError("Enter email and password.");
      return;
    }

    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <p className="text-sm text-muted-foreground">Log in to access your cloud workspace.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoFocus
                className="bg-slate-50/85 border-slate-300/80 dark:bg-slate-900/45 dark:border-slate-700/80"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="bg-slate-50/85 border-slate-300/80 dark:bg-slate-900/45 dark:border-slate-700/80"
              />
            </div>
            {error ? (
              <p className="text-sm rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full">
              {loading ? "Please wait..." : "Sign in"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              No account yet?{" "}
              <Link to="/signup" className="text-foreground underline underline-offset-2">
                Sign up
              </Link>
            </p>
            <p className="text-xs text-muted-foreground text-center">
              <Link to="/welcome" className="underline underline-offset-2">
                Back to landing
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
