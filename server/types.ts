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
  // Your existing fields
  title: string;
  author: string;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  rank: number | null;
  image?: string;

  // New contextual fields for relevance scoring
  categoryPaths?: string[]; 
  rawCategories?: string[];
  audienceHint?: "kids" | "teens" | "adult" | "mixed" | "unsure";
}
