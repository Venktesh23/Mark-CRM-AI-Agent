import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/supabase-client";

export default function ForgotPasswordPage() {
  const cloudInitialized = useCloudAuthStore((s) => s.initialized);
  const cloudUser = useCloudAuthStore((s) => s.user);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (cloudInitialized && cloudUser) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured. Add env keys first.");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }

    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) throw resetError;
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-lg rounded-2xl">
          <CardContent className="space-y-6 px-8 py-8">
            <div className="text-center space-y-2">
              <CardTitle className="text-2xl font-bold">Check your email</CardTitle>
              <p className="text-sm text-muted-foreground">
                We've sent a password reset link to {email}. Click the link to reset your password.
              </p>
            </div>
            <Link to="/welcome" className="block">
              <Button className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg h-12">
                Back to sign in
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-0 shadow-lg rounded-2xl">
        <CardHeader className="space-y-2 pt-8 px-8">
          <CardTitle className="text-3xl font-bold text-foreground">Reset password</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter your email and we'll send you a link to reset your password.
          </p>
        </CardHeader>
        <CardContent className="space-y-6 px-8 pb-8">
          <form className="space-y-5" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                Email Address
              </label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="name@company.com"
                autoFocus
                className="h-12 bg-gray-50 dark:bg-slate-900/50 border-gray-200 dark:border-slate-700 rounded-lg"
              />
            </div>

            {error ? (
              <p className="text-sm rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 px-4 py-3">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg"
            >
              {loading ? "Please wait..." : "Send reset link"}
            </Button>

            <p className="text-sm text-center text-muted-foreground">
              <Link to="/welcome" className="font-semibold text-orange-600 hover:text-orange-700 dark:text-orange-500 dark:hover:text-orange-400">
                Back to sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
