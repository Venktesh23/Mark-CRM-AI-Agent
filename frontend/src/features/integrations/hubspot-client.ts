import type { CrmData } from "@/lib/crm-parser";

export const HUBSPOT_BASE_URL = "http://localhost:3000";

export function getHubspotAuthUrl(): string {
  return `${HUBSPOT_BASE_URL}/auth/hubspot`;
}

async function fetchHubspot<T>(path: string): Promise<T> {
  const response = await fetch(`${HUBSPOT_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`HubSpot server error (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function asCrmData(payload: unknown): CrmData {
  const obj = payload as Partial<CrmData>;
  if (
    !obj ||
    typeof obj !== "object" ||
    typeof obj.fetchedAt !== "string" ||
    typeof obj.contactsCsv !== "string" ||
    typeof obj.companiesCsv !== "string" ||
    typeof obj.contactsCount !== "number" ||
    typeof obj.companiesCount !== "number"
  ) {
    throw new Error("Invalid CRM payload");
  }
  return obj as CrmData;
}

export async function fetchCrmData(): Promise<CrmData> {
  const payload = await fetchHubspot<unknown>("/api/crm-data");
  return asCrmData(payload);
}

export async function refreshCrmData(): Promise<CrmData> {
  const payload = await fetchHubspot<unknown>("/api/refresh");
  return asCrmData(payload);
}
