import { useEffect, useRef } from "react";
import { useAuthStore } from "@/core/auth/auth-store";

const ACTIVITY_THROTTLE_MS = 3000;
const CHECK_INTERVAL_MS = 15000;

export function useSessionTimeout(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLocked = useAuthStore((state) => state.isLocked);
  const lastActivityAt = useAuthStore((state) => state.lastActivityAt);
  const sessionTimeoutMs = useAuthStore((state) => state.sessionTimeoutMs);
  const touchActivity = useAuthStore((state) => state.touchActivity);
  const lock = useAuthStore((state) => state.lock);

  const lastEventRef = useRef(0);

  useEffect(() => {
    if (!isAuthenticated || isLocked) return;

    const markActivity = () => {
      const now = Date.now();
      if (now - lastEventRef.current < ACTIVITY_THROTTLE_MS) return;
      lastEventRef.current = now;
      touchActivity();
    };

    const onVisibility = () => {
      if (!document.hidden) markActivity();
    };

    window.addEventListener("mousemove", markActivity);
    window.addEventListener("keydown", markActivity);
    window.addEventListener("click", markActivity);
    window.addEventListener("scroll", markActivity, { passive: true });
    window.addEventListener("touchstart", markActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("mousemove", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("click", markActivity);
      window.removeEventListener("scroll", markActivity);
      window.removeEventListener("touchstart", markActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isAuthenticated, isLocked, touchActivity]);

  useEffect(() => {
    if (!isAuthenticated || isLocked || !lastActivityAt) return;
    const timer = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityAt;
      if (idleFor >= sessionTimeoutMs) lock();
    }, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, isLocked, lastActivityAt, sessionTimeoutMs, lock]);
}
