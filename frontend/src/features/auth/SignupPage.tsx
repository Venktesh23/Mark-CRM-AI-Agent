import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/supabase-client";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";

export default function SignupPage() {
  const navigate = useNavigate();
  const cloudInitialized = useCloudAuthStore((s) => s.initialized);
  const cloudUser = useCloudAuthStore((s) => s.user);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => email.trim().length > 0 && password.trim().length >= 6 && password === confirm,
    [email, password, confirm]
  );

  if (cloudInitialized && cloudUser) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured. Add env keys first.");
      return;
    }
    if (!canSubmit) {
      setError("Enter a valid email and matching password (minimum 6 chars).");
      return;
    }

    setLoading(true);
    try {
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
      setMessage("Account created. Check email confirmation if your Supabase project requires it.");
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <p className="text-sm text-muted-foreground">Create a cloud account to store campaigns per user.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-slate-50/85 border-slate-300/80 dark:bg-slate-900/45 dark:border-slate-700/80"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
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
            <div className="space-y-2">
              <label className="text-sm font-medium">Confirm password</label>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                className="bg-slate-50/85 border-slate-300/80 dark:bg-slate-900/45 dark:border-slate-700/80"
              />
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
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !canSubmit}
            >
              {loading ? "Please wait..." : "Sign up"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Already have an account?{" "}
              <Link to="/login" className="text-foreground underline underline-offset-2">
                Log in
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
