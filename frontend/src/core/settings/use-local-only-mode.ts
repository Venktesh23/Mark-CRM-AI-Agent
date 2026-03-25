import { useEffect, useState } from "react";
import { getLocalOnlyMode } from "@/core/settings/runtime-settings";

export function useLocalOnlyMode(): boolean {
  const [localOnly, setLocalOnly] = useState(getLocalOnlyMode());

  useEffect(() => {
    const onChange = () => setLocalOnly(getLocalOnlyMode());
    window.addEventListener("mark:local-only-changed", onChange as EventListener);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("mark:local-only-changed", onChange as EventListener);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return localOnly;
}
