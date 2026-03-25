import { toErrorMessage } from "@/core/async/safe-async";

export function getUserErrorMessage(error: unknown, fallback: string): string {
  const raw = toErrorMessage(error, fallback);
  const lower = raw.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Cannot reach local services. Start backend with `make dev` and HubSpot server with `node hubspotserver/server.cjs`.";
  }
  if (lower.includes("hubspot")) {
    return "HubSpot connection failed. Verify port 3000 is running and try reconnecting.";
  }
  if (lower.includes("api error 503")) {
    return "Service unavailable right now. Enable local-only mode in Settings or retry when backend is running.";
  }
  if (lower.includes("api error 401")) {
    return "Session or credentials issue detected. Reconnect CRM and try again.";
  }
  if (lower.includes("invalid crm payload")) {
    return "CRM response format was invalid. Try syncing again from Integrations.";
  }

  return raw;
}
