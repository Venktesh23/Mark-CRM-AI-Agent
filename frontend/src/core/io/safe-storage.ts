const PREFIX = "mark.local.";

function storageAvailable(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const probe = "__mark_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageSet(key: string, value: unknown): boolean {
  if (!storageAvailable()) return false;
  try {
    window.localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function safeStorageGet<T>(key: string, fallback: T): T {
  if (!storageAvailable()) return fallback;
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeStorageRemove(key: string): void {
  if (!storageAvailable()) return;
  try {
    window.localStorage.removeItem(`${PREFIX}${key}`);
  } catch {
    // no-op
  }
}
