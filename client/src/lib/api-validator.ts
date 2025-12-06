import type { MarketAnalysis } from "./mock-validator";
import { getSupabase } from "./supabase";

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { "Authorization": `Bearer ${session.access_token}` };
    }
  } catch (error) {
    console.warn("Failed to get auth session:", error);
  }
  return {};
}

export async function validateBookIdea(idea: string): Promise<MarketAnalysis> {
  const authHeaders = await getAuthHeaders();
  
  const response = await fetch("/api/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ idea }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || "Failed to validate book idea");
  }

  return response.json();
}
