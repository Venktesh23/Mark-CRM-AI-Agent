import { ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/core/errors/ErrorBoundary";
import { supabase } from "@/integrations/supabase/supabase-client";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { ensureCloudProfile } from "@/integrations/supabase/cloud-data";

const queryClient = new QueryClient();

function CloudAuthBootstrap() {
  const initialize = useCloudAuthStore((s) => s.initialize);
  const setSession = useCloudAuthStore((s) => s.setSession);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        void ensureCloudProfile(
          session.user.id,
          session.user.email,
          (session.user.user_metadata?.full_name as string | undefined) ??
            (session.user.user_metadata?.name as string | undefined)
        );
      }
    });
    return () => subscription.unsubscribe();
  }, [setSession]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <CloudAuthBootstrap />
            <Toaster />
            <Sonner />
            {children}
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
