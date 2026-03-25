const CLEAR_VERSION_KEY = "mark.bootstrap.clear.v2";

const LEGACY_KEYS = [
  "mark-auth",
  "mark-campaigns",
  "mark-brand",
  "mark-hubspot",
  "mark-hubspot-contacts",
  "mark.local.settings.localOnly",
];

export function clearLegacyLocalDataOnce(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(CLEAR_VERSION_KEY) === "1") return;

    for (const key of LEGACY_KEYS) {
      window.localStorage.removeItem(key);
    }

    // Supabase auth token cache keys typically look like:
    // sb-<project-ref>-auth-token
    const keysToDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("sb-") && k.includes("-auth-token")) {
        keysToDelete.push(k);
      }
    }
    for (const key of keysToDelete) {
      window.localStorage.removeItem(key);
    }

    // Keep app in cloud mode by default after wipe.
    window.localStorage.setItem("mark.local.settings.localOnly", JSON.stringify(false));
    window.localStorage.setItem(CLEAR_VERSION_KEY, "1");
    window.dispatchEvent(new CustomEvent("mark:local-only-changed"));
  } catch {
    // no-op
  }
}
