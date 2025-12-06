import type { MarketAnalysis } from "./mock-validator";
import { getSupabase } from "./supabase";

export interface BookBlueprint {
  id: string;
  userId: string;
  validationId: string;
  workingTitle: string;
  readerAvatar: string;
  primaryPromise: string;
  coreProblem: string;
  bigDifferentiator: string;
  coreTopics: string;
  contentShape: string;
  targetLengthWords: number | null;
  toneStyle: string;
  compTitles: string;
  positioningNotes: string;
  createdAt: string;
  updatedAt: string;
}

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

export async function validateBookIdea(idea: string): Promise<MarketAnalysis & { savedResultId?: string }> {
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

export async function fetchBlueprint(validationId: string): Promise<BookBlueprint | null> {
  const authHeaders = await getAuthHeaders();
  
  const response = await fetch(`/api/book-blueprints/${validationId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch blueprint");
  }

  const result = await response.json();
  return result.data || null;
}

export async function generateBlueprint(validationId: string): Promise<BookBlueprint> {
  const authHeaders = await getAuthHeaders();
  
  const response = await fetch("/api/book-blueprints/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ validationId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to generate blueprint");
  }

  const result = await response.json();
  return result.data;
}

export async function saveBlueprint(validationId: string, fields: Partial<BookBlueprint>): Promise<BookBlueprint> {
  const authHeaders = await getAuthHeaders();
  
  const response = await fetch("/api/book-blueprints/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ validationId, ...fields }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to save blueprint");
  }

  const result = await response.json();
  return result.data;
}
