import type { MarketAnalysis } from "./mock-validator";
import { getSupabase } from "./supabase";

export interface BlueprintChapter {
  title: string;
  purpose: string;
  notes: string;
}

export interface BlueprintSection {
  title: string;
  description: string;
  chapters: BlueprintChapter[];
}

export interface BlueprintConstraints {
  word_count_target: number;
  reading_level: string;
  timeframe: string;
}

export interface BlueprintStructure {
  overview: string;
  sections: BlueprintSection[];
}

export interface BlueprintData {
  working_title: string;
  subtitle: string;
  core_promise: string;
  ideal_reader: string;
  differentiation: string;
  format: string;
  constraints: BlueprintConstraints;
  structure: BlueprintStructure;
  voice_and_style: string;
  comparable_titles: string;
  positioning_notes: string;
  primary_keywords: string[];
  whitespace_keywords: string[];
}

export interface BookBlueprint {
  id: string;
  userId: string;
  validationId: string;
  blueprintJson: BlueprintData;
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
