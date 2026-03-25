import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { useAuthStore } from "@/core/auth/auth-store";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/supabase-client";

interface CloudAuthState {
  initialized: boolean;
  user: User | null;
  session: Session | null;
  initializing: boolean;
  initialize: () => Promise<void>;
  setSession: (session: Session | null) => void;
  signOut: () => Promise<void>;
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
    useAuthStore.getState().logout();
    set({ session: null, user: null, initialized: true, initializing: false });
  },
}));
