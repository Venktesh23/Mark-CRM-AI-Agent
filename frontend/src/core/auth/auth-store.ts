import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { AuthProfile, hashPasscode, verifyPasscode } from "@/core/auth/auth-utils";

interface AuthState {
  hasVisited: boolean;
  hasCompletedOnboarding: boolean;
  isAuthenticated: boolean;
  isLocked: boolean;
  profile: AuthProfile | null;
  passcodeHash: string;
  lastActivityAt: number;
  sessionTimeoutMs: number;
  finishOnboarding: (profile: AuthProfile, passcode: string) => void;
  login: (passcode: string) => boolean;
  verifyPasscode: (passcode: string) => boolean;
  lock: () => void;
  unlock: (passcode: string) => boolean;
  touchActivity: () => void;
  setSessionTimeoutMs: (milliseconds: number) => void;
  logout: () => void;
  resetAuth: () => void;
}

const initialState = {
  hasVisited: false,
  hasCompletedOnboarding: false,
  isAuthenticated: false,
  isLocked: false,
  profile: null,
  passcodeHash: "",
  lastActivityAt: 0,
  sessionTimeoutMs: 15 * 60 * 1000,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...initialState,
      finishOnboarding: (profile, passcode) =>
        set({
          hasVisited: true,
          hasCompletedOnboarding: true,
          isAuthenticated: true,
          isLocked: false,
          profile: { ...profile, email: profile.email?.trim() || undefined },
          passcodeHash: hashPasscode(passcode),
          lastActivityAt: Date.now(),
        }),
      login: (passcode) => {
        const ok = verifyPasscode(passcode, get().passcodeHash);
        if (ok) {
          set({
            isAuthenticated: true,
            hasVisited: true,
            isLocked: false,
            lastActivityAt: Date.now(),
          });
        }
        return ok;
      },
      verifyPasscode: (passcode) => verifyPasscode(passcode, get().passcodeHash),
      lock: () => set({ isLocked: true }),
      unlock: (passcode) => {
        const ok = verifyPasscode(passcode, get().passcodeHash);
        if (ok) set({ isLocked: false, lastActivityAt: Date.now() });
        return ok;
      },
      touchActivity: () => set({ lastActivityAt: Date.now() }),
      setSessionTimeoutMs: (milliseconds) =>
        set({
          sessionTimeoutMs: Math.max(60_000, Math.trunc(milliseconds || 0)),
        }),
      logout: () => set({ isAuthenticated: false, isLocked: false, lastActivityAt: 0 }),
      resetAuth: () => set(initialState),
    }),
    {
      name: "mark-auth",
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          try {
            return window.localStorage.getItem(name);
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            window.localStorage.setItem(name, value);
          } catch {
            // no-op
          }
        },
        removeItem: (name) => {
          try {
            window.localStorage.removeItem(name);
          } catch {
            // no-op
          }
        },
      })),
    }
  )
);
