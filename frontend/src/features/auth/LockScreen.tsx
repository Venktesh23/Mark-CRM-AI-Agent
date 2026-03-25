import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/core/auth/auth-store";

export default function LockScreen() {
  const profile = useAuthStore((s) => s.profile);
  const unlock = useAuthStore((s) => s.unlock);
  const logout = useAuthStore((s) => s.logout);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!passcode.trim()) {
      setError("Enter your passcode.");
      return;
    }
    const ok = unlock(passcode);
    if (!ok) {
      setError("Incorrect passcode.");
      return;
    }
    setPasscode("");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Session locked</CardTitle>
          <p className="text-sm text-muted-foreground">
            {profile?.name ? `${profile.name}, enter your passcode to continue.` : "Enter passcode to continue."}
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleUnlock}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Passcode</label>
              <Input
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                type="password"
                autoFocus
              />
            </div>
            {error ? (
              <p className="text-sm rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button type="submit" className="flex-1">
                Unlock
              </Button>
              <Button type="button" variant="outline" onClick={logout}>
                Sign out
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
