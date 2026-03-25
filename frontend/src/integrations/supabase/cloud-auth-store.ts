import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { useAuthStore } from "@/core/auth/auth-store";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/supabase-client";

const E2E_AUTH_BYPASS_KEY = "mark.e2e.auth.bypass";

interface CloudAuthState {
  initialized: boolean;
  user: User | null;
  session: Session | null;
  initializing: boolean;
  initialize: () => Promise<void>;
  setSession: (session: Session | null) => void;
  signOut: () => Promise<void>;
}

function getDevBypassUser(): User | null {
  if (import.meta.env.VITE_E2E_BYPASS_AUTH !== "true") return null;
  try {
    const queryEnabled = new URL(window.location.href).searchParams.get("e2eBypass") === "1";
    if (queryEnabled) {
      window.localStorage.setItem(E2E_AUTH_BYPASS_KEY, "true");
    }
    const enabled = queryEnabled || window.localStorage.getItem(E2E_AUTH_BYPASS_KEY) === "true";
    if (!enabled) return null;
    return {
      id: "e2e-user",
      email: "e2e.user@example.com",
      app_metadata: {},
      user_metadata: { full_name: "E2E User" },
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as User;
  } catch {
    return null;
  }
}

function setLocalProfileFromUser(user: User | null): void {
  if (!user) return;
  const name =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    user.email ||
    "Cloud user";

  useAuthStore.setState((prev) => ({
    ...prev,
    hasVisited: true,
    hasCompletedOnboarding: true,
    isAuthenticated: true,
    isLocked: false,
    profile: {
      name,
      email: user.email ?? undefined,
    },
    lastActivityAt: Date.now(),
  }));
}

export const useCloudAuthStore = create<CloudAuthState>((set) => ({
  initialized: false,
  user: null,
  session: null,
  initializing: false,
  initialize: async () => {
    const bypassUser = getDevBypassUser();
    if (bypassUser) {
      set({
        initialized: true,
        user: bypassUser,
        session: null,
        initializing: false,
      });
      setLocalProfileFromUser(bypassUser);
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      set({ initialized: true, user: null, session: null, initializing: false });
      return;
    }
    set({ initializing: true });
    const { data } = await supabase.auth.getSession();
    set({
      initialized: true,
      user: data.session?.user ?? null,
      session: data.session ?? null,
      initializing: false,
    });
    setLocalProfileFromUser(data.session?.user ?? null);
  },
  setSession: (session) => {
    set({ session, user: session?.user ?? null, initialized: true, initializing: false });
    if (session?.user) {
      setLocalProfileFromUser(session.user);
    } else {
      useAuthStore.getState().logout();
    }
  },
  signOut: async () => {
    if (supabase) await supabase.auth.signOut();
    try {
      window.localStorage.removeItem(E2E_AUTH_BYPASS_KEY);
    } catch {
      // no-op
    }
    useAuthStore.getState().logout();
    set({ session: null, user: null, initialized: true, initializing: false });
  },
}));

declare global {
  interface Window {
    __markE2EBypassAuth?: () => void;
  }
}

if (typeof window !== "undefined" && import.meta.env.VITE_E2E_BYPASS_AUTH === "true") {
  window.__markE2EBypassAuth = () => {
    const user = getDevBypassUser();
    if (!user) return;
    useCloudAuthStore.setState({
      initialized: true,
      user,
      session: null,
      initializing: false,
    });
    setLocalProfileFromUser(user);
  };
}
