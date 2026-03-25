import { safeStorageGet, safeStorageSet } from "@/core/io/safe-storage";

const LOCAL_ONLY_KEY = "settings.localOnly";

export function getLocalOnlyMode(): boolean {
  return safeStorageGet<boolean>(LOCAL_ONLY_KEY, false);
}

export function setLocalOnlyMode(enabled: boolean): void {
  safeStorageSet(LOCAL_ONLY_KEY, enabled);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("mark:local-only-changed"));
  }
}
