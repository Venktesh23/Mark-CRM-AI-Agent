import { FormEvent, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/core/auth/auth-store";
import { isStrongPasscode, isValidEmail, normalizeEmail } from "@/core/auth/auth-utils";
import { useLocalOnlyMode } from "@/core/settings/use-local-only-mode";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const localOnly = useLocalOnlyMode();
  const finishOnboarding = useAuthStore((s) => s.finishOnboarding);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return name.trim().length > 1 && isStrongPasscode(passcode) && passcode === confirmPasscode;
  }, [name, passcode, confirmPasscode]);

  if (!localOnly) return <Navigate to="/cloud-auth" replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Enter a valid email or leave it empty.");
      return;
    }
    if (!isStrongPasscode(passcode)) {
      setError("Passcode must be at least 6 characters.");
      return;
    }
    if (passcode !== confirmPasscode) {
      setError("Passcodes do not match.");
      return;
    }

    finishOnboarding(
      {
        name: name.trim(),
        email: email ? normalizeEmail(email) : undefined,
      },
      passcode
    );
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Welcome to Mark</CardTitle>
          <p className="text-sm text-muted-foreground">
            Set up your local workspace. Your profile and auth stay on this device.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email (optional)</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Local passcode</label>
              <Input value={passcode} onChange={(e) => setPasscode(e.target.value)} type="password" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Confirm passcode</label>
              <Input
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
                type="password"
              />
            </div>

            {error ? (
              <p className="text-sm rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={!canSubmit}>
              Complete setup
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
