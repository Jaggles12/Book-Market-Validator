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

  // Amazon category paths (full human-readable paths)
  amazonCategoryPaths?: string[];
  primaryAmazonPath?: string | null;

  // Enriched category data from product endpoint
  categoryIds?: string[];  // Amazon browse node IDs
  categoriesFlat?: string;  // Full path like "Books > Parenting > Family Activities"
  enrichedCategories?: { name: string; categoryId: string }[];

  // Enriched product data (from product endpoint lookup)
  enrichedRating?: number | null;
  enrichedReviews?: number | null;
  isEnriched?: boolean;

  // Extras
  coverColor?: string | null;
}

// Enrichment result from product endpoint
export interface ProductEnrichmentResult {
  asin: string;
  rank: number | null;
  rating: number | null;
  reviews: number | null;
  categoryIds: string[];
  categoriesFlat: string | null;
  categories: { name: string; categoryId: string }[];
  publicationDate: string | null;
  publicationYear: number | null;
  author: string | null;
}

// Inferred genre from Amazon category analysis
export interface InferredGenre {
  category: "fiction" | "nonfiction";
  shelf: string;
  subgenre: string;
  microgenre: string | null;
  amazonPrimaryPath: string | null;
  amazonAlternatePaths: string[];
}
