// server/types.ts

export interface AudienceProfile {
  ageGroup: "kids" | "teens" | "young_adult" | "adult" | "mixed" | "unsure";
  lifeStage?: "students" | "parents" | "retirees" | "professionals" | "unspecified";
  experienceLevel?: "beginner" | "intermediate" | "advanced" | "unspecified";
  primaryGenderFocus?: "women" | "men" | "mixed" | "unspecified";
}

export interface NicheProfile {
  rawIdea: string;
  category: "fiction" | "nonfiction";
  subtype: string;
  topic: string;
  hook: string | null;
  toneOrFlavor?: string | null;
  searchTerm: string;
}

export interface NormalizedBook {
  // Core metadata
  title: string;
  asin: string | null;
  link: string | null;
  image: string | null;

  // Author(s)
  authors: string[];

  // Ratings & reviews
  rating: number | null;
  reviews: number | null;

  // Pricing
  price: number | null;

  // Publication
  publicationDate: string | null;
  publicationYear: number | null;

  // Ranks
  rawRank: number | null;
  effectiveRank: number | null;
  rankSource?: "bestseller" | "heuristic" | "missing" | "product_lookup";
  rank?: number | null;

  // Relevance flag
  isRelevant?: boolean;

  // Semantic relevance scoring (normalized 0-1)
  semanticScore?: number;
  relevanceBucket?: "core" | "adjacent" | "out_of_niche";

  // Contextual fields for relevance scoring
  categoryPaths?: string[];
  rawCategories?: string[];
  audienceHint?: "kids" | "teens" | "adult" | "mixed" | "unsure";

  // Extras
  coverColor?: string | null;
}
