import type { SavedCampaign } from "@/lib/campaigns-list-store";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/supabase-client";

interface CampaignRow {
  id: string;
  user_id: string;
  name: string;
  status: SavedCampaign["status"];
  prompt: string;
  created_at: string;
  payload: SavedCampaign;
}

export async function ensureCloudProfile(userId: string, email?: string | null, name?: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const profile = {
    id: userId,
    email: email ?? "",
    display_name: name ?? "",
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("profiles").upsert(profile, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

export async function loadCloudCampaigns(userId: string): Promise<SavedCampaign[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from("campaigns")
    .select("id,user_id,name,status,prompt,created_at,payload")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CampaignRow[]).map((row) => row.payload);
}

export async function upsertCloudCampaign(userId: string, campaign: SavedCampaign): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const row: CampaignRow = {
    id: campaign.id,
    user_id: userId,
    name: campaign.name,
    status: campaign.status,
    prompt: campaign.prompt,
    created_at: campaign.createdAt,
    payload: campaign,
  };
  const { error } = await supabase.from("campaigns").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

export async function deleteCloudCampaign(userId: string, campaignId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
