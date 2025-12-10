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
  rankCategory?: string | null; // Specific subcategory for this rank (e.g., "Cozy > Animals")

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

// Canonical niche - the semantic anchor that prevents category drift
// This is derived from user input BEFORE Amazon search, and serves as
// a filter to ensure Amazon categories don't override the user's intent
export interface CanonicalNiche {
  // The expected high-level genre (more specific than just fiction/nonfiction)
  expectedGenre: string; // e.g., "Self-Help", "Romance", "Mystery", "Business"
  
  // Expected domain areas the book should cover
  expectedDomains: string[]; // e.g., ["Personal Transformation", "Motivation", "Purpose"]
  
  // Worldview orientation (affects which categories are acceptable)
  worldview: "secular" | "spiritual" | "religious" | "mixed";
  
  // Target audience summary
  audience: {
    ageGroup: "kids" | "teens" | "young_adult" | "adult" | "mixed" | "unsure";
    focus?: string; // e.g., "women entrepreneurs", "new parents"
  };
  
  // Fiction vs nonfiction (hard lock - never overridden by Amazon)
  category: "fiction" | "nonfiction";
  
  // Categories that are VALID for this niche (Amazon categories must align)
  validAmazonCategories: string[]; // e.g., ["Self-Help", "Personal Transformation", "Motivation"]
  
  // Categories that would indicate drift (should trigger rejection)
  invalidCategories: string[]; // e.g., ["New Age", "Divination", "Romance", "Fiction"]
}

// Search term candidate with purity scoring
export interface SearchTermCandidate {
  term: string;
  source: "niche" | "domain" | "topic" | "keyword";
  priority: number; // 1 = highest priority
}

// Search result scoring for multi-search selection
export interface SearchResultScore {
  term: string;
  totalBooks: number;
  coreBooks: number;
  adjacentBooks: number;
  categoryPurity: number; // 0-1, how well categories align with canonical niche
  domainAlignment: number; // 0-1, how well book topics match expected domains
  overallScore: number; // Combined score for selection
}
