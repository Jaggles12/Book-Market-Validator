// lib/api-validator.ts

import { getSupabase } from "./supabase";

/**
 * Top sellers / BSR leaders from /api/validate
 * This should match the backend SalesLeader shape.
 */
export interface SalesLeader {
  title: string;
  author: string;
  rank: number | null;
  rating: number | null;
  reviews: number | null;
  price: number | null;
}

/**
 * Shape of the /api/validate response we care about in the UI
 * This MUST stay in sync with what your Express /api/validate route returns.
 */
export interface ValidateResponse {
  verdict: string;
  verdictReason: string;

  genre: {
    category: string;
    subtype: string;
    label?: string;
    friendlyLabel?: string;
    shelf?: string;
    subgenre?: string;
    microgenre?: string;
    amazonPrimaryPath?: string;
    amazonAlternatePaths?: string[];
  };

  normalizedGenre?: {
    category: string;
    subtype: string;
  };

  friendlyGenreLabel: string;
  isDemo: boolean;
  searchTerm: string;
  isExtracted: boolean;

  stats: {
    avgPrice: number;
    avgRating: number;
    competitionLevel: string;
    demandLevel: string;
  };

  detailedStats: {
    totalBooks: number;
    avgReviews: number;
    priceMin: number | null;
    priceMax: number | null;
    priceMedian: number | null;
    strongCompetitors: number;
    midCompetitors: number;
    lowReviewBooks: number;
    bsrBuckets: {
      veryStrong: number;
      strong: number;
      moderate: number;
      weak: number;
    };
    dominantAuthors: {
      name: string;
      count: number;
    }[];
    evergreenSignal: boolean;
    cheapBookShare: number | null;
    premiumBookShare: number | null;
  };

  // Market signal summary with core vs adjacent breakdown
  marketSignal?: {
    coreBookCount: number;
    adjacentBookCount: number;
    totalBookCount: number;
    signalStrength: "strong" | "moderate" | "weak" | "sparse";
    dataSource: "core" | "adjacent" | "combined" | "insufficient";
    explanation: string;
  };

  // Separate stats for core and adjacent books
  coreStats?: {
    totalBooks: number;
    avgRating: number;
    avgReviews: number;
    priceMin: number | null;
    priceMax: number | null;
    priceMedian: number | null;
  };

  adjacentStats?: {
    totalBooks: number;
    avgRating: number;
    avgReviews: number;
    priceMin: number | null;
    priceMax: number | null;
    priceMedian: number | null;
  };

  books: {
    title: string;
    author: string;
    price: number | null;
    rating: number | null;
    reviews: number | null;
    rank: number | null;
    image?: string | null;
    coverColor?: string | null;
    publicationYear: number | null;
  }[];

  suggestions: string[];

  // The deepAnalysis object is rich and nested; we keep it broad here
  // since results.tsx guards most accesses.
  deepAnalysis: any;

  savedResultId?: string;
  salesLeaders?: SalesLeader[];
  adjacentSalesLeaders?: SalesLeader[];
}

/**
 * Blueprint-related types for the Book Blueprint feature
 */

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

export interface BlueprintFiveBeats {
  setup: string;
  disruption: string;
  risingComplications: string;
  climax: string;
  resolution: string;
}

export interface BlueprintData {
  working_title: string;
  subtitle: string;
  logline: string;
  core_promise: string;
  ideal_reader: string;
  differentiation: string;
  format: string;
  constraints: BlueprintConstraints;
  structure: BlueprintStructure;
  fiveBeatStructure: BlueprintFiveBeats;
  openingCatalystPrompt: string;
  voice_and_style: string;
  comparable_titles: string;
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

/**
 * Get Supabase auth headers for the blueprint and validator endpoints
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = await getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
  } catch (error) {
    console.warn("Failed to get auth session:", error);
  }

  return {};
}

/**
 * Genre category for validation: fiction vs nonfiction.
 * This lines up with your backend requirement:
 *   projectType or genreCategory must be "fiction" or "nonfiction".
 */
export type GenreCategory = "fiction" | "nonfiction";

/**
 * Call /api/validate from the frontend.
 *
 * NOTE:
 * - We ALWAYS send a valid genre to the backend.
 * - If caller doesn't pass bookType, we default to "nonfiction"
 *   so your existing calls keep working.
 * - We send the value as BOTH projectType and genreCategory
 *   to satisfy the backend check:
 *   "projectType or genreCategory must be 'fiction' or 'nonfiction'."
 */
export async function validateBookIdea(
  idea: string,
  bookType: GenreCategory = "nonfiction"
): Promise<ValidateResponse> {
  const authHeaders = await getAuthHeaders();

  const bodyPayload = {
    idea,
    projectType: bookType,
    genreCategory: bookType,
  };

  const response = await fetch("/api/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!response.ok) {
    // Log more detail for debugging
    try {
      const errorBody = await response.json();
      console.error(
        "Failed /api/validate response:",
        response.status,
        errorBody
      );
    } catch {
      console.error("Failed /api/validate response:", response.status);
    }
    throw new Error("Failed to validate idea");
  }

  const data = (await response.json()) as ValidateResponse;
  return data;
}

/**
 * Fetch an existing blueprint for a given validation result
 */
export async function fetchBlueprint(
  validationId: string
): Promise<BookBlueprint | null> {
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

/**
 * Ask the backend to generate a new blueprint for a validationId
 */
export async function generateBlueprint(
  validationId: string
): Promise<BookBlueprint> {
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
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Failed to generate blueprint");
  }

  const result = await response.json();
  return result.data as BookBlueprint;
}

/**
 * Save user-edited blueprint fields back to the backend
 */
export async function saveBlueprint(
  validationId: string,
  fields: Partial<BookBlueprint>
): Promise<BookBlueprint> {
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
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Failed to save blueprint");
  }

  const result = await response.json();
  return result.data as BookBlueprint;
}

