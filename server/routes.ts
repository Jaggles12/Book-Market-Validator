import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import axios from "axios";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { storage } from "./storage";
import { AudienceProfile, NicheProfile, NormalizedBook, InferredGenre } from "./types";
import { getAudienceProfile } from "./audience";
import { scoreBooksForNiche, type BookForRelevance } from "./relevance";
import { inferGenreFromBooks, generateFriendlyGenreLabelFromInferred } from "./genreInference";


// -----------------------------
// External clients
// -----------------------------

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// -----------------------------
// Auth types & middleware
// -----------------------------

interface AuthenticatedRequest extends Request {
  userId?: string;
}

async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.substring(7);

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.userId = user.id;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Authentication failed" });
  }
}

// -----------------------------
// Domain types
// -----------------------------

interface RainforestRankEntry {
  category?: string;
  rank?: number;
}

interface RainforestBook {
  title?: string;
  asin?: string;
  link?: string;
  image?: string;

  // Author metadata
  author?: string; // single author string (common in Rainforest payloads)
  authors?: { name?: string }[]; // structured author list
  byline?: string; // "by Author Name" format from search results

  rating?: number;
  ratings_total?: number;
  reviews_total?: number;
  price?: { value?: number } | null;

  bestsellers_rank?: RainforestRankEntry | RainforestRankEntry[];
  sales_rank?: RainforestRankEntry | RainforestRankEntry[] | number;
  rank?: number;

  publication_date?: string;

  // Category metadata used by filterBooksOnly and relevance scoring
  categories?: { name?: string }[];
}

// NormalizedBook is imported from ./types

// === Sales leader types & helper ===

export interface SalesLeader {
  title: string;
  author: string;
  rank: number;
  rating: number | null;
  reviews: number | null;
  price: number | null;
}

/**
 * Compute top-selling books based on effectiveRank,
 * using only solid rank signals and ignoring junk ranks.
 */
export function computeSalesLeaders(books: NormalizedBook[]): SalesLeader[] {
  const candidates = books
    .filter((b) => {
      const r = b.effectiveRank;

      // Must have a numeric, positive effectiveRank
      if (typeof r !== "number" || r <= 0) return false;

      // Only trust strong rank sources as anchors
      if (
        b.rankSource !== "product_lookup" &&
        b.rankSource !== "bestseller"
      ) {
        return false;
      }

      // Ignore ultra-weak ranks (way out of the meaningful sales range)
      return r <= 300_000;
    })
    .sort((a, b) => (a.effectiveRank! - b.effectiveRank!));

  const leaders = candidates.slice(0, 5);

  return leaders.map((b) => ({
    title: b.title,
    author: b.authors && b.authors.length > 0 ? b.authors[0] : "Unknown",
    rank: b.effectiveRank!, // safe: filtered above
    rating: b.rating ?? null,
    reviews: b.reviews ?? null,
    price: b.price ?? null,
  }));
}

type GenreInfo = {
  category: string;
  subtype: string;
};

interface TitleIdea {
  title: string;
  subtitle: string;
  hook: string;
}

interface BlueprintChapter {
  title: string;
  purpose: string;
  notes: string;
}

interface BlueprintSection {
  title: string;
  description: string;
  chapters: BlueprintChapter[];
}

interface BlueprintConstraints {
  word_count_target: number;
  reading_level: string;
  timeframe: string;
}

interface BlueprintStructure {
  overview: string;
  sections: BlueprintSection[];
}

interface FiveBeatStructure {
  setup: string;
  disruption: string;
  risingComplications: string;
  climax: string;
  resolution: string;
}

interface BookBlueprint {
  working_title: string;
  subtitle: string;
  logline: string;
  core_promise: string;
  ideal_reader: string;
  differentiation: string;
  format: string;
  constraints: BlueprintConstraints;
  structure: BlueprintStructure;
  fiveBeatStructure: FiveBeatStructure;
  openingCatalystPrompt: string;
  voice_and_style: string;
  comparable_titles: string;
  positioning_notes: string;
  primary_keywords: string[];
  whitespace_keywords: string[];
}

interface NicheOpportunities {
  intro: string;
  items: string[];
}

interface IdealReader {
  demographics: string;
  psychographics: string;
  painPoints: string[];
  desiredOutcome: string;
  emotionalTrigger: string;
  emotionalPayoff: string;
}

interface FullNicheAnalysis {
  suggestions: string[];
  nicheOpportunities: NicheOpportunities;
  formatGaps: string[];
  idealReader: IdealReader;
  positioningStatement: string;
  differentiationAngles: string[];
  coreKeywords: string[];
  whiteSpaceKeywords: string[];
  suggestedCategories: string[];
  bestCategoryPath: string;
  trendingKeywords: string[];
  bookBlueprint: BookBlueprint;
  titleIdeas: TitleIdea[];
  nextSteps: string[];
}

// -----------------------------
// Demo mode & trending cache
// -----------------------------

// Demo mode flag - set to true when API quota is exceeded
let demoMode = false;

interface TrendingCache {
  niches: string[];
  timestamp: number;
  lastRefreshAttempt: number;
}

const TRENDING_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

let trendingCache: TrendingCache | null = null;

function getCachedTrendingNiches():
  | { niches: string[]; timestamp: number }
  | null {
  if (!trendingCache) return null;
  const now = Date.now();
  const age = now - trendingCache.timestamp;
  if (age < TRENDING_CACHE_TTL) {
    return { niches: trendingCache.niches, timestamp: trendingCache.timestamp };
  }
  return null;
}

function setCachedTrendingNiches(niches: string[]): void {
  trendingCache = {
    niches,
    timestamp: Date.now(),
    lastRefreshAttempt: Date.now(),
  };
}

function clearTrendingCache(): void {
  trendingCache = null;
}

// -----------------------------
// Genre helpers (aligned with current framework)
// -----------------------------

type GenreCategory = "fiction" | "nonfiction";

interface GenreInfo {
  category: GenreCategory;
  /**
   * Simple subtype tags such as:
   * - "thriller"
   * - "mystery"
   * - "romance"
   * - "memoir"
   * - "general"
   *
   * detectGenre() is responsible for setting this,
   * but it NEVER decides fiction vs nonfiction.
   */
  subtype: string;
}

/**
 * Basic title-casing for labels.
 * Turns things like:
 *   "psychological suspense novels" -> "Psychological Suspense Novels"
 *   "ya_thriller"                   -> "Ya Thriller"
 */
function toTitleCaseLabel(raw: string): string {
  return raw
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Generate a short, user-friendly genre label.
 *
 * Priority:
 * 1) Use the extracted search term (best signal).
 * 2) Use a non-generic subtype, with category hint.
 * 3) Fall back to "Fiction (General)" / "Nonfiction (General)".
 */
function generateFriendlyGenreLabel(
  searchTerm: string | null,
  genre: GenreInfo,
  originalIdea: string
): string {
  // 1) Prefer the extracted niche/search term
  const niche = (searchTerm ?? "").trim();
  if (niche.length > 3) {
    return toTitleCaseLabel(niche);
  }

  // 2) Use a non-generic subtype if available
  const rawSubtype = (genre.subtype ?? "").trim().toLowerCase();

  const genericSubtypes = new Set<string>([
    "general",
    "general fiction",
    "general_nonfiction",
    "general nonfiction",
    "unspecified",
    "unknown",
  ]);

  if (rawSubtype && !genericSubtypes.has(rawSubtype)) {
    const subtypeLabel = toTitleCaseLabel(rawSubtype);

    if (genre.category === "fiction") {
      return `${subtypeLabel} (Fiction)`;
    }
    if (genre.category === "nonfiction") {
      return `${subtypeLabel} (Nonfiction)`;
    }

    // If category is somehow missing, just use the subtype label
    return subtypeLabel;
  }

  // 3) Simple category-based fallback
  if (genre.category === "fiction") return "Fiction (General)";
  if (genre.category === "nonfiction") return "Nonfiction (General)";

  // Ultra-fallback: use the original idea or a generic label
  const idea = (originalIdea ?? "").trim();
  if (idea.length > 0) {
    return toTitleCaseLabel(idea);
  }

  return "General";
}

// -----------------------------
// Rank utilities (clean version)
// -----------------------------

/**
 * Compute a single source-of-truth rank for a book.
 *
 * - Prefer rawRank (real BSR from Amazon) if present.
 * - Fall back to any existing rank field if needed.
 * - Treat junk / placeholder ranks (<= 0 or >= 900,000) as "unranked" (null).
 */
function computeEffectiveRank(b: NormalizedBook): number | null {
  let candidate: number | null = null;

  // 1) Prefer the true BSR if we have it
  if (typeof b.rawRank === "number") {
    candidate = b.rawRank;
  }
  // 2) Otherwise fall back to any existing rank (if you have one from elsewhere)
  else if (typeof b.rank === "number") {
    candidate = b.rank;
  }

  // 3) Validate and clamp: only accept reasonable BSRs
  if (
    typeof candidate === "number" &&
    candidate > 0 &&
    candidate < 900_000 // anything beyond this is treated as "unranked"
  ) {
    return candidate;
  }

  // 4) Everything else is effectively unranked
  return null;
}

// -----------------------------
// Demo books
// -----------------------------

function generateDemoBooks(searchTerm: string): NormalizedBook[] {
  const baseBooks = [
    {
      titlePrefix: "The Complete Guide to",
      reviews: 2847,
      rating: 4.6,
      rawRank: 1_250,
      price: 14.99,
    },
    {
      titlePrefix: "Mastering",
      reviews: 1523,
      rating: 4.4,
      rawRank: 3_420,
      price: 12.99,
    },
    {
      titlePrefix: "Essential",
      reviews: 892,
      rating: 4.5,
      rawRank: 8_900,
      price: 9.99,
    },
    {
      titlePrefix: "The Ultimate",
      reviews: 3201,
      rating: 4.7,
      rawRank: 890,
      price: 16.99,
    },
    {
      titlePrefix: "Practical",
      reviews: 456,
      rating: 4.2,
      rawRank: 45_000,
      price: 11.99,
    },
    {
      titlePrefix: "Introduction to",
      reviews: 234,
      rating: 4.0,
      rawRank: 78_000,
      price: 8.99,
    },
    {
      titlePrefix: "Advanced",
      reviews: 678,
      rating: 4.3,
      rawRank: 23_000,
      price: 19.99,
    },
    {
      titlePrefix: "Simple",
      reviews: 1105,
      rating: 4.5,
      rawRank: 5_600,
      price: 10.99,
    },
    {
      titlePrefix: "The Power of",
      reviews: 4521,
      rating: 4.8,
      rawRank: 320,
      price: 15.99,
    },
    {
      titlePrefix: "Secrets of",
      reviews: 789,
      rating: 4.1,
      rawRank: 34_000,
      price: 13.99,
    },
  ];

  const authors = [
    "James Anderson",
    "Sarah Mitchell",
    "Michael Chen",
    "Emily Roberts",
    "David Williams",
    "Jennifer Taylor",
    "Robert Brown",
    "Lisa Johnson",
    "Christopher Lee",
    "Amanda Davis",
    "Matthew Wilson",
    "Rachel Garcia",
  ];

  return baseBooks.map((book, index) => {
    const publicationDate = `2024-${String(
      Math.floor(Math.random() * 12) + 1
    ).padStart(2, "0")}-15`;
    const publicationYear = new Date(publicationDate).getFullYear();
    const effectiveRank = book.rawRank;

    return {
      title: `${book.titlePrefix} ${searchTerm}`,
      asin: `DEMO${String(index).padStart(6, "0")}`,
      link: `https://amazon.com/dp/DEMO${String(index).padStart(6, "0")}`,
      image: null,
      rating: book.rating,
      reviews: book.reviews,
      price: book.price,
      authors: [authors[index % authors.length]],
      publicationDate,
      publicationYear,
      rawRank: book.rawRank,
      effectiveRank,
      rankSource: "bestseller",
      rank: effectiveRank,
      isRelevant: true,
      coverColor: null,
    };
  });
}

// -----------------------------
// Niche extraction
// -----------------------------

async function extractNicheFromIdea(
  userInput: string
): Promise<{ niche: string; isExtracted: boolean }> {
  const input = userInput.trim();
  const words = input.split(/\s+/);
  const wordCount = words.length;
  const lowerInput = input.toLowerCase();

  const nicheIndicators = [
    "book about",
    "books about",
    "guide to",
    "how to",
    "self-help",
    "self help",
    "devotional",
    "journal",
    "workbook",
    "cookbook",
    "coloring book",
    "activity book",
    "picture book",
    "romance",
    "thriller",
    "mystery",
    "fantasy",
    "fiction",
    "nonfiction",
    "for beginners",
    "for kids",
    "for children",
    "for adults",
    "for women",
    "for men",
    "parenting",
    "business",
    "productivity",
    "motivation",
    "spirituality",
    "weight loss",
    "diet",
    "fitness",
    "meditation",
    "mindfulness",
  ];

  const hasNicheIndicator = nicheIndicators.some((indicator) =>
    lowerInput.includes(indicator)
  );

  const titleIndicators = [
    /^the\s+\w+\s+\w+/i,
    /:\s+/,
    /—/,
    /'s\s+\w+\s+\w+/i,
    /who\s+\w+|where\s+\w+/i,
  ];

  const hasTitleIndicator = titleIndicators.some((pattern) =>
    pattern.test(input)
  );

  const isGenericNiche = hasNicheIndicator && wordCount <= 8;
  const needsLLMExtraction = hasTitleIndicator && !hasNicheIndicator;
  const isLongUnknownPhrase = wordCount > 6 && !hasNicheIndicator;

  if (isGenericNiche && !needsLLMExtraction && !isLongUnknownPhrase) {
    console.log(
      `Input "${input}" appears to be a generic niche phrase, using directly`
    );
    return { niche: input, isExtracted: false };
  }

  function createFallbackNiche(text: string): string {
    const genre = detectGenre(text);
    const genreToNiche: Record<string, string> = {
      fiction: "fiction books",
      fantasy: "fantasy fiction books",
      romance: "romance novels",
      mystery: "mystery thriller books",
      thriller: "thriller suspense books",
      horror: "horror fiction books",
      science_fiction: "science fiction books",
      general_fiction: "literary fiction",
      religion_spirituality: "christian inspirational books",
      devotional: "daily devotional books",
      bible_study: "bible study guides",
      prayer: "prayer and spirituality books",
      spiritual_growth: "spiritual growth books",
      christian_living: "christian living books",
      christian: "christian books",
      self_help: "self-help personal development",
      habits: "habit building books",
      productivity: "productivity books",
      mindset: "mindset and success books",
      motivation: "motivational self-help",
      personal_development: "personal development books",
      health_wellness: "health and wellness books",
      fitness: "fitness exercise books",
      nutrition: "nutrition diet books",
      mindfulness: "meditation mindfulness books",
      wellness: "wellness lifestyle books",
      psychology: "psychology self-help",
      mental_health: "mental health books",
      business: "business books",
      entrepreneurship: "entrepreneurship startup books",
      leadership: "leadership management books",
      marketing: "marketing strategy books",
      career_development: "career development books",
      family_relationships: "family parenting books",
      parenting: "parenting books",
      marriage: "marriage relationship books",
      relationships: "relationships self-help",
      family: "family life books",
      education: "education learning books",
      learning: "learning education books",
      finance: "personal finance books",
      investing: "investing money books",
      personal_finance: "personal finance budgeting",
      journal: "guided journals",
      workbook: "workbooks guides",
    };

    const niche =
      genreToNiche[genre.subtype] ||
      genreToNiche[genre.category] ||
      "popular books";
    return niche;
  }

  const prompt = `You are a book market analyst. Given the user's book idea or title, extract a broad, Amazon-searchable niche phrase.

User Input: "${input}"

RULES:
1. Output a generic market niche phrase, NOT the literal title
2. Use 3-6 words that describe the market category
3. Focus on the target audience + topic (e.g., "children's book about emotions", "self-help for anxiety")
4. Never include specific character names, places, or creative elements from the title
5. Think about what a reader would search on Amazon to find similar books
6. NEVER output the exact input text - always transform it into a market category

EXAMPLES:
- "The Little Cloud Who Lost His Rain: A Story About Feelings" → "children's book about emotions"
- "Atomic Habits: An Easy & Proven Way to Build Good Habits" → "habit building self-help"
- "The Midnight Library: A Novel" → "literary fiction about life choices"
- "Becoming: Michelle Obama's Memoir" → "celebrity memoir autobiography"
- "The 7 Habits of Highly Effective People" → "personal development productivity"
- "Goodnight Moon" → "children's bedtime stories"
- "The Very Hungry Caterpillar" → "children's picture book"
- "Where the Wild Things Are" → "children's adventure picture book"
- "Charlotte's Web" → "children's classic animal stories"

OUTPUT ONLY the niche phrase, nothing else. No quotes, no explanation.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 50,
    });

    const response = completion.choices[0]?.message?.content?.trim() || "";
    const cleanedNiche = response
      .replace(/^["']|["']$/g, "")
      .replace(/^\*+|\*+$/g, "")
      .trim();

    const nicheWordCount = cleanedNiche.split(/\s+/).length;
    const isDifferentFromOriginal =
      cleanedNiche.toLowerCase() !== input.toLowerCase();

    if (
      cleanedNiche &&
      nicheWordCount >= 2 &&
      nicheWordCount <= 8 &&
      isDifferentFromOriginal
    ) {
      console.log(`Niche extraction: "${input}" → "${cleanedNiche}"`);
      return { niche: cleanedNiche, isExtracted: true };
    }

    const fallbackNiche = createFallbackNiche(input);
    console.log(
      `LLM extraction failed, using genre-based fallback: "${input}" → "${fallbackNiche}"`
    );
    return { niche: fallbackNiche, isExtracted: true };
  } catch (error) {
    console.error("Niche extraction error:", error);
    const fallbackNiche = createFallbackNiche(input);
    console.log(
      `Niche extraction error, using genre-based fallback: "${fallbackNiche}"`
    );
    return { niche: fallbackNiche, isExtracted: true };
  }
}

// -----------------------------
// Safe JSON parse helper
// -----------------------------

async function safeJSONParse(raw: string) {
  try {
    const cleaned = raw
      .replace(/^```json/g, "")
      .replace(/^```/g, "")
      .replace(/```$/g, "")
      .trim();

    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON parse failed:", raw);
    throw new Error("Invalid JSON from OpenAI");
  }
}
// Genre Reference Helper
type GenreCategory = "fiction" | "nonfiction";
type GenreSubtype =
  | "thriller"
  | "mystery"
  | "romance"
  | "fantasy"
  | "sci-fi"
  | "literary"
  | "horror"
  | "memoir"
  | "self-help"
  | "business"
  | "spiritual"
  | "general";

function inferGenreFromSearchTerm(searchTerm: string): { category: GenreCategory; subtype: GenreSubtype } {
  const term = (searchTerm || "").toLowerCase().trim();

  // --- FICTION GUARDS ---
  if (
    term.includes("thriller") ||
    term.includes("suspense") ||
    term.includes("psychological thriller") ||
    term.includes("crime novel") ||
    term.includes("mystery") ||
    term.includes("detective") ||
    term.includes("novel") ||
    term.includes("sci-fi") ||
    term.includes("science fiction") ||
    term.includes("fantasy") ||
    term.includes("romance") ||
    term.includes("urban fantasy") ||
    term.includes("ya ") ||
    term.includes("young adult")
  ) {
    // More specific subtypes
    if (term.includes("thriller") || term.includes("suspense") || term.includes("psychological")) {
      return { category: "fiction", subtype: "thriller" };
    }
    if (term.includes("mystery") || term.includes("detective") || term.includes("crime")) {
      return { category: "fiction", subtype: "mystery" };
    }
    if (term.includes("romance")) {
      return { category: "fiction", subtype: "romance" };
    }
    if (term.includes("fantasy")) {
      return { category: "fiction", subtype: "fantasy" };
    }
    if (term.includes("sci-fi") || term.includes("science fiction")) {
      return { category: "fiction", subtype: "sci-fi" };
    }

    // Fallback fiction
    return { category: "fiction", subtype: "general" };
  }

  // --- NONFICTION GUARDS ---
  if (
    term.includes("memoir") ||
    term.includes("biography") ||
    term.includes("autobiography")
  ) {
    return { category: "nonfiction", subtype: "memoir" };
  }

  if (
    term.includes("self-help") ||
    term.includes("self help") ||
    term.includes("personal growth") ||
    term.includes("personal development")
  ) {
    return { category: "nonfiction", subtype: "self-help" };
  }

  if (
    term.includes("business") ||
    term.includes("entrepreneur") ||
    term.includes("startup") ||
    term.includes("marketing") ||
    term.includes("leadership")
  ) {
    return { category: "nonfiction", subtype: "business" };
  }

  if (
    term.includes("devotional") ||
    term.includes("bible study") ||
    term.includes("spiritual")
  ) {
    return { category: "nonfiction", subtype: "spiritual" };
  }

  // Final fallback
  return { category: "nonfiction", subtype: "general" };
}

// Prefer a meaningful rank from Rainforest's bestsellers_rank array
function chooseBestRankFromBestsellers(entries: any[]): number | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  // 1) Prefer the overall Books store rank if present
  const booksEntry = entries.find(
    (e: any) =>
      typeof e.category === "string" && e.category.trim() === "Books"
  );
  if (booksEntry && typeof booksEntry.rank === "number" && booksEntry.rank > 0) {
    return booksEntry.rank;
  }

  // 2) Otherwise, pick the smallest numeric rank (strongest performance)
  const numericRanks = entries
    .map((e: any) => (typeof e.rank === "number" ? e.rank : null))
    .filter((r: number | null): r is number => r !== null && r > 0);

  if (numericRanks.length === 0) return null;

  return Math.min(...numericRanks);
}

// -----------------------------
// Helpers: filter to "real" books only
// -----------------------------

function filterToBooksOnly(books: NormalizedBook[]): NormalizedBook[] {
  const nonBookKeywords = [
    "planner",
    "calendar",
    "whiteboard",
    "notepad",
    "notepads",
    "magnetic",
    "dry erase",
    "acrylic",
    "duty chart",
    "achievement rewards",
    "refrigerator door",
    "fridge",
  ];

  const positiveKeywords = [
    "cookbook",
    "recipes",
    "a cookbook",
    "guide",
    "book",
    "diet plan",
    "meal plan",
    "workbook",
    "handbook",
    "cook book",
  ];

  return books.filter((b) => {
    const title = (b.title || "").toLowerCase();

    // 1) Drop obvious ecosystem products / stationery
    if (nonBookKeywords.some((kw) => title.includes(kw))) {
      return false;
    }

    // 2) Prefer keeping things that clearly look like books
    if (positiveKeywords.some((kw) => title.includes(kw))) {
      return true;
    }

    // 3) Heuristic: "normal" book-ish items with price + rating
    if (
      b.price != null &&
      b.price > 3 &&
      b.price < 80 &&
      b.rating != null &&
      b.rating >= 3
    ) {
      return true;
    }

    // 4) Default: keep (you can flip this to false if you want stricter filtering)
    return true;
  });
}

// -----------------------------
// Rainforest helpers
// -----------------------------

interface ProductEnrichmentData {
  rank: number | null;
  author: string | null;
  publicationDate: string | null;
  publicationYear: number | null;
}

async function fetchProductBSR(asin: string): Promise<ProductEnrichmentData> {
  const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY;
  if (!RAINFOREST_API_KEY) return { rank: null, author: null, publicationDate: null, publicationYear: null };

  try {
    const params = {
      api_key: RAINFOREST_API_KEY,
      type: "product",
      amazon_domain: "amazon.com",
      asin,
    };

    const resp = await axios.get("https://api.rainforestapi.com/request", {
      params,
    });

    const product = resp.data?.product || {};

    // Debug log to see structure when needed
    console.log(
      "Rainforest product detail debug:",
      JSON.stringify(
        {
          asin,
          bestsellers_rank: product.bestsellers_rank,
          sales_rank: product.sales_rank,
          rank: product.rank,
          authors: product.authors,
          publication_date: product.publication_date,
          product_details: product.product_details,
        },
        null,
        2
      )
    );

    let primaryRank: number | null = null;

    // 1) Try bestsellers_rank array/object
    if (Array.isArray(product.bestsellers_rank)) {
      primaryRank = chooseBestRankFromBestsellers(product.bestsellers_rank);
    } else if (
      product.bestsellers_rank &&
      typeof product.bestsellers_rank.rank === "number"
    ) {
      primaryRank = product.bestsellers_rank.rank;
    }

    // 2) Fallback to sales_rank
    if (
      primaryRank == null &&
      Array.isArray(product.sales_rank) &&
      product.sales_rank.length > 0
    ) {
      const firstSales = product.sales_rank[0];
      if (firstSales && typeof firstSales.rank === "number") {
        primaryRank = firstSales.rank;
      }
    } else if (primaryRank == null && typeof product.sales_rank === "number") {
      primaryRank = product.sales_rank;
    }

    // 3) Fallback to generic rank
    if (primaryRank == null && typeof product.rank === "number") {
      primaryRank = product.rank;
    }

    const finalRank =
      typeof primaryRank === "number" && primaryRank > 0 ? primaryRank : null;

    // Extract author from product detail
    let author: string | null = null;
    if (Array.isArray(product.authors) && product.authors.length > 0) {
      const firstAuthor = product.authors[0];
      if (typeof firstAuthor === "string" && firstAuthor.trim().length > 0) {
        author = firstAuthor.trim();
      } else if (firstAuthor && typeof firstAuthor.name === "string" && firstAuthor.name.trim().length > 0) {
        author = firstAuthor.name.trim();
      }
    } else if (typeof product.author === "string" && product.author.trim().length > 0) {
      author = product.author.trim();
    } else if (typeof product.by === "string" && product.by.trim().length > 0) {
      let byline = product.by.trim();
      if (byline.toLowerCase().startsWith("by ")) {
        byline = byline.substring(3).trim();
      }
      author = byline;
    }

    // Extract publication date
    let publicationDate: string | null = null;
    let publicationYear: number | null = null;
    
    if (typeof product.publication_date === "string" && product.publication_date.trim().length > 0) {
      publicationDate = product.publication_date.trim();
    } else if (product.product_details) {
      // Sometimes publication info is in product_details
      const details = product.product_details;
      if (typeof details.publication_date === "string") {
        publicationDate = details.publication_date;
      } else if (typeof details["Publication date"] === "string") {
        publicationDate = details["Publication date"];
      } else if (typeof details.publisher === "string") {
        // Sometimes publisher includes date like "Publisher (January 1, 2023)"
        const match = details.publisher.match(/\(([^)]+)\)/);
        if (match && match[1]) {
          publicationDate = match[1];
        }
      }
    }

    if (publicationDate) {
      // Try multiple parsing strategies for publication year
      
      // 1) Look for 4-digit year directly in the string
      const yearMatch = publicationDate.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        const year = parseInt(yearMatch[0], 10);
        if (year >= 1900 && year <= 2100) {
          publicationYear = year;
        }
      }
      
      // 2) Fallback to Date parsing if regex didn't find a year
      if (!publicationYear) {
        const parsed = new Date(publicationDate);
        if (!isNaN(parsed.getTime())) {
          const year = parsed.getFullYear();
          if (year >= 1900 && year <= 2100) {
            publicationYear = year;
          }
        }
      }
    }

    console.log("Rainforest product enrichment:", { asin, finalRank, author, publicationDate, publicationYear });

    return { rank: finalRank, author, publicationDate, publicationYear };
  } catch (err: any) {
    console.error("Error fetching product data for ASIN", asin, err?.message || err);
    return { rank: null, author: null, publicationDate: null, publicationYear: null };
  }
}

// Force Amazon search into the Books index via URL
function buildBooksSearchUrl(searchTerm: string): string {
  const encoded = encodeURIComponent(searchTerm.trim());
  // i=stripbooks => Books only
  return `https://www.amazon.com/s?k=${encoded}&i=stripbooks`;
}

// Filter Rainforest search results down to "likely books only"
function filterBooksOnly(results: RainforestBook[]): RainforestBook[] {
  return results.filter((item) => {
    const title = (item.title || "").toLowerCase();
    const categories = item.categories || [];

    // 1) If Amazon/Rainforest explicitly says "Books", keep it
    const hasBooksCategory = categories.some((c) =>
      c.name?.toLowerCase().includes("books")
    );
    if (hasBooksCategory) return true;

    // 2) Aggressively drop obvious hardware / kits / devices
    const hardwareKeywords = [
      "kit",
      "system",
      "pods",
      "pod kit",
      "grow light",
      "led grow light",
      "garden",
      "indoor garden",
      "planter",
      "tower",
      "pump",
      "hydroponics growing system",
      "herb garden",
      "seed pod",
    ];

    if (hardwareKeywords.some((kw) => title.includes(kw))) {
      return false;
    }

    // 3) Positive book-ish signals in the title
    const bookKeywords = [
      "guide",
      "handbook",
      "for beginners",
      "manual",
      "the complete",
      "book",
      "edition",
      "volume",
    ];

    if (bookKeywords.some((kw) => title.includes(kw))) {
      return true;
    }

    // 4) Default: if we can't tell, treat it as NOT a book
    return false;
  });
}

// -----------------------------
// Rainforest helper utilities
// -----------------------------

/**
 * Build an Amazon Books search URL for the given term.
 * Name is unique to avoid clashes with any older helpers.
 */
function buildAmazonBooksSearchUrl(searchTerm: string): string {
  const encoded = encodeURIComponent(searchTerm.trim());
  // Hint Amazon toward the Books category
  return `https://www.amazon.com/s?k=${encoded}&i=stripbooks`;
}

// -----------------------------
// Fetch Amazon Data via Rainforest API (with demo mode fallback)
// -----------------------------

async function fetchAmazonBooks(
  searchTerm: string
): Promise<{ books: NormalizedBook[]; isDemo: boolean }> {
  const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY;

  // If no key or we've flipped into demoMode, use demo data
  if (!RAINFOREST_API_KEY || demoMode) {
    console.log("Using demo mode - returning sample book data");
    return { books: generateDemoBooks(searchTerm), isDemo: true };
  }

  try {
    const searchParams = {
      api_key: RAINFOREST_API_KEY,
      type: "search",
      amazon_domain: "amazon.com",
      search_term: searchTerm,
      number_of_results: 30,
      sort_by: "bestseller_rankings",
      // no `url` here; Rainforest doesn't allow url + search_term together
    };

    const searchResponse = await axios.get(
      "https://api.rainforestapi.com/request",
      { params: searchParams }
    );

    const allResults: RainforestBook[] =
      searchResponse.data?.search_results || [];

    console.log(
      `Rainforest search (raw): term="${searchTerm}", results=${allResults.length}`
    );

    // Basic "books-only" filter inline to avoid duplicate helper names.
    // We keep this intentionally conservative; heavy filtering happens later
    // via filterToBooksOnly on NormalizedBook.
    const results: RainforestBook[] = allResults.filter((r) => {
      if (!r) return false;
      if (!r.asin || !r.title) return false;

      const title = r.title.toLowerCase();

      const junkPhrases = [
        "bookmark",
        "t-shirt",
        "t shirt",
        "shirt",
        "mug",
        "poster",
        "wall art",
        "wall decor",
        "sticker",
        "stickers",
        "keychain",
        "key chain",
        "bracelet",
        "necklace",
        "gift card",
      ];

      if (junkPhrases.some((phrase) => title.includes(phrase))) {
        return false;
      }

      return true;
    });

    console.log(
      `Rainforest search (books-only guess): term="${searchTerm}", total=${allResults.length}, books=${results.length}`
    );

    if (results.length > 0) {
      console.log(
        "Sample book-like search result fields:",
        JSON.stringify(results[0], null, 2)
      );
    }

    // Safely extract the primary author name from a Rainforest search result.
    // Returns "" when we truly have no author; we only show "Unknown" at the UI layer.
    function extractPrimaryAuthor(rb: RainforestBook): string {
      // 1) Simple string field
      if (typeof rb.author === "string" && rb.author.trim().length > 0) {
        return rb.author.trim();
      }

      // 2) "authors" can be an array of objects with "name"
      if (Array.isArray(rb.authors) && rb.authors.length > 0) {
        const first = rb.authors[0];
        if (first && typeof first.name === "string" && first.name.trim().length > 0) {
          return first.name.trim();
        }
      }

      // 3) Check "byline" field (often "by Author Name" format)
      if (typeof rb.byline === "string" && rb.byline.trim().length > 0) {
        // Strip common prefixes like "by ", "By ", etc.
        let byline = rb.byline.trim();
        if (byline.toLowerCase().startsWith("by ")) {
          byline = byline.substring(3).trim();
        }
        // Handle multiple authors separated by commas - take first author
        if (byline.includes(",")) {
          byline = byline.split(",")[0].trim();
        }
        // Handle " and " separator
        if (byline.toLowerCase().includes(" and ")) {
          byline = byline.split(/ and /i)[0].trim();
        }
        if (byline.length > 0) {
          return byline;
        }
      }

      return "";
    }

    // 1) Normalize search_results into NormalizedBook[]
    let normalizedBooks: NormalizedBook[] = results
      .map((r) => {
        if (!r.asin || !r.title) return null;

        const priceValue =
          r.price &&
          typeof r.price.value === "number" &&
          r.price.value > 0
            ? r.price.value
            : null;

        const primaryAuthor = extractPrimaryAuthor(r);
        const authors = primaryAuthor ? [primaryAuthor] : [];

        let rawRank: number | null = null;

        // Try to extract any rank from search result
        if (Array.isArray(r.bestsellers_rank) && r.bestsellers_rank.length > 0) {
          const firstRank = r.bestsellers_rank[0];
          if (firstRank && typeof firstRank.rank === "number") {
            rawRank = firstRank.rank;
          }
        } else if (
          r.bestsellers_rank &&
          typeof (r.bestsellers_rank as RainforestRankEntry).rank === "number"
        ) {
          rawRank = (r.bestsellers_rank as RainforestRankEntry).rank!;
        } else if (Array.isArray(r.sales_rank) && r.sales_rank.length > 0) {
          const firstSales = r.sales_rank[0];
          if (firstSales && typeof firstSales.rank === "number") {
            rawRank = firstSales.rank;
          }
        } else if (typeof r.sales_rank === "number") {
          rawRank = r.sales_rank;
        } else if (typeof r.rank === "number") {
          rawRank = r.rank;
        }

        if (rawRank != null && rawRank <= 0) {
          rawRank = null;
        }

        const publicationDate =
          typeof r.publication_date === "string"
            ? r.publication_date
            : null;
        const publicationYear =
          publicationDate != null
            ? new Date(publicationDate).getFullYear()
            : null;

        // Extract category names from Rainforest data
        const rawCategories: string[] = [];
        if (Array.isArray(r.categories)) {
          for (const cat of r.categories) {
            if (typeof cat === "string" && cat.trim().length > 0) {
              rawCategories.push(cat.trim());
            } else if (cat && typeof cat.name === "string" && cat.name.trim().length > 0) {
              rawCategories.push(cat.name.trim());
            }
          }
        }

        // Extract Amazon category paths from bestsellers_rank (full paths like "Books > Self-Help > ...")
        const amazonCategoryPaths: string[] = [];
        let primaryAmazonPath: string | null = null;
        
        if (Array.isArray(r.bestsellers_rank)) {
          for (const rankEntry of r.bestsellers_rank) {
            if (rankEntry && typeof rankEntry.category === "string" && rankEntry.category.trim().length > 0) {
              const catPath = rankEntry.category.trim();
              // Prefer paths starting with "Books"
              if (catPath.toLowerCase().startsWith("books")) {
                amazonCategoryPaths.push(catPath);
                // Set first Books path as primary
                if (!primaryAmazonPath) {
                  primaryAmazonPath = catPath;
                }
              } else {
                amazonCategoryPaths.push(catPath);
              }
            }
          }
        } else if (r.bestsellers_rank && typeof (r.bestsellers_rank as RainforestRankEntry).category === "string") {
          const catPath = (r.bestsellers_rank as RainforestRankEntry).category!.trim();
          if (catPath.length > 0) {
            amazonCategoryPaths.push(catPath);
            if (catPath.toLowerCase().startsWith("books")) {
              primaryAmazonPath = catPath;
            }
          }
        }

        const base: NormalizedBook = {
          title: r.title || "Untitled",
          asin: r.asin || null,
          link: r.link || null,
          image: r.image || null,
          authors,
          rating:
            typeof r.rating === "number" && r.rating > 0 ? r.rating : null,
          reviews:
            typeof r.ratings_total === "number"
              ? r.ratings_total
              : typeof r.reviews_total === "number"
              ? r.reviews_total
              : null,
          price: priceValue,
          publicationDate,
          publicationYear:
            publicationYear && !isNaN(publicationYear)
              ? publicationYear
              : null,
          rawRank,
          effectiveRank: null,
          // initial guess; may be upgraded by product lookup / heuristics
          rankSource: rawRank ? "bestseller" : "missing",
          rank: null,
          isRelevant: true,
          rawCategories,
          amazonCategoryPaths,
          primaryAmazonPath,
          coverColor: null,
        };

        return base;
      })
      .filter((b): b is NormalizedBook => b !== null);

    console.log(
      "Rainforest normalization summary:",
      JSON.stringify(
        {
          totalBooks: normalizedBooks.length,
          withRawRank: normalizedBooks.filter(
            (b) => typeof b.rawRank === "number"
          ).length,
        },
        null,
        2
      )
    );

    // 2) Optional: enrich top few with dedicated product calls (BSR + author + publication)
    const topSearchResults = results.slice(0, 5).filter((r) => r.asin);
    if (topSearchResults.length > 0) {
      const asins = topSearchResults.map((r) => r.asin!);
      console.log("Fetching product enrichment data for top books:", asins.join(", "));

      const enrichmentData = await Promise.all(
        topSearchResults.map((r) => fetchProductBSR(r.asin!))
      );

      enrichmentData.forEach((data, idx) => {
        const asin = topSearchResults[idx].asin!;
        console.log("Product enrichment result:", { asin, ...data });

        const match = normalizedBooks.find((b) => b.asin === asin);
        if (match) {
          // Enrich rank if available
          if (data.rank != null) {
            match.rawRank = data.rank;
            match.rank = data.rank;
            match.effectiveRank = data.rank;
            match.rankSource = "product_lookup";
          }
          
          // Enrich author if missing and available from product detail
          if ((!match.authors || match.authors.length === 0) && data.author) {
            match.authors = [data.author];
          }
          
          // Enrich publication date/year if missing and available from product detail
          if (!match.publicationDate && data.publicationDate) {
            match.publicationDate = data.publicationDate;
          }
          if (!match.publicationYear && data.publicationYear) {
            match.publicationYear = data.publicationYear;
          }
        }
      });
    }

    console.log(
      "Rainforest after BSR enrichment:",
      JSON.stringify(
        {
          totalBooks: normalizedBooks.length,
          withRawRank: normalizedBooks.filter(
            (b) => typeof b.rawRank === "number"
          ).length,
          withRank: normalizedBooks.filter(
            (b) => typeof b.rank === "number"
          ).length,
        },
        null,
        2
      )
    );

    // 3) Filter out non-book ecosystem products at NormalizedBook level
    const beforeFilter = normalizedBooks.length;
    normalizedBooks = filterToBooksOnly(normalizedBooks);
    console.log(
      `Filtered to books only: ${beforeFilter} → ${normalizedBooks.length}`
    );

    // 4) Compute effectiveRank for all books (fallback heuristic where needed)
    normalizedBooks = normalizedBooks.map((b) => {
      const effectiveRank = computeEffectiveRank(b);

      let rankSource: NormalizedBook["rankSource"] = b.rankSource;

      if (typeof b.rawRank === "number" && b.rawRank > 0) {
        // trust the rawRank; source is either product_lookup or bestseller
        rankSource =
          b.rankSource === "product_lookup" ? "product_lookup" : "bestseller";
      } else if (effectiveRank != null) {
        // we only have heuristic / inferred rank
        rankSource =
          b.rankSource === "product_lookup" ? "product_lookup" : "heuristic";
      } else {
        rankSource = "missing";
      }

      return {
        ...b,
        effectiveRank,
        rank: effectiveRank,
        rankSource,
      };
    });

    console.log(
      `Normalized ${normalizedBooks.length} books from Rainforest search`
    );

    return { books: normalizedBooks, isDemo: false };
  } catch (error: any) {
    console.error("Error fetching Amazon books via Rainforest:", error?.message || error);

    if (error?.response?.status === 402) {
      // Quota exceeded → flip into demo mode for subsequent requests
      demoMode = true;
    }

    // Fail gracefully into demo data so the UI still works
    return { books: generateDemoBooks(searchTerm), isDemo: true };
  }
}

// -----------------------------
// Deep niche analysis (single call)
// -----------------------------

async function generateFullNicheAnalysis(
  idea: string,
  genre: GenreInfo,
  stats: any,
  books: NormalizedBook[],
  friendlyGenreLabel?: string
): Promise<FullNicheAnalysis> {
  const topBooks = books.slice(0, 5).map((b) => ({
    title: b.title,
    price: b.price,
    rating: b.rating,
    reviews: b.reviews,
    rank: b.effectiveRank,
  }));

  const payload = {
    idea,
    genre,
    stats: {
      demandLevel: stats.demandLevel,
      competitionLevel: stats.competitionLevel,
      avgRating: stats.avgRating,
      avgReviews: stats.avgReviews,
      priceMin: stats.priceMin,
      priceMax: stats.priceMax,
      priceMedian: stats.priceMedian,
      strongCompetitors: stats.strongCompetitors,
      midCompetitors: stats.midCompetitors,
      lowReviewBooks: stats.lowReviewBooks,
      bsrBuckets: stats.bsrBuckets,
    },
    friendlyGenreLabel: friendlyGenreLabel ?? null,
    sampleBooks: topBooks,
  };

  const completion = await openai.chat.completions.create({
    model: process.env.ANALYSIS_MODEL || "gpt-4.1",
    response_format: { type: "json_object" },
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `
You are a senior publishing strategist. Return a SINGLE valid JSON object in this exact shape:

{
  "suggestions": string[],
  "nicheOpportunities": {
    "intro": string,
    "items": string[]
  },
  "formatGaps": string[],
  "idealReader": {
    "demographics": string,
    "psychographics": string,
    "painPoints": string[],
    "desiredOutcome": string,
    "emotionalTrigger": string,
    "emotionalPayoff": string
  },
  "positioningStatement": string,
  "differentiationAngles": string[],
  "coreKeywords": string[],
  "whiteSpaceKeywords": string[],
  "suggestedCategories": string[],
  "bestCategoryPath": string,
  "trendingKeywords": string[],
  "bookBlueprint": {
    "working_title": string,
    "subtitle": string,
    "logline": string,
    "core_promise": string,
    "ideal_reader": string,
    "differentiation": string,
    "format": string,
    "constraints": {
      "word_count_target": number,
      "reading_level": string,
      "timeframe": string
    },
    "structure": {
      "overview": string,
      "sections": [
        {
          "title": string,
          "description": string,
          "chapters": [
            {
              "title": string,
              "purpose": string,
              "notes": string
            }
          ]
        }
      ]
    },
    "fiveBeatStructure": {
      "setup": string,
      "disruption": string,
      "risingComplications": string,
      "climax": string,
      "resolution": string
    },
    "openingCatalystPrompt": string,
    "voice_and_style": string,
    "comparable_titles": string,
    "positioning_notes": string,
    "primary_keywords": string[],
    "whitespace_keywords": string[]
  },
  "titleIdeas": { "title": string, "subtitle": string, "hook"?: string }[],
  "nextSteps": string[]
}

Rules:
- All fields MUST be present.
- suggestions: 3–5 specific creative decisions (no marketing tactics).
- titleIdeas: 3–7 strong titles that clearly fit this niche and genre.
- nextSteps: 4–7 short, practical steps for the author.
- JSON ONLY. No markdown, no comments, no extra keys.
      `.trim(),
      },
      {
        role: "user",
        content: "Project context:\n\n" + JSON.stringify(payload, null, 2),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = await safeJSONParse(raw);

  const suggestions: string[] = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.filter(
        (s: any) => typeof s === "string" && s.trim().length > 0
      )
    : [];

  const titleIdeas: TitleIdea[] = Array.isArray(parsed.titleIdeas)
    ? parsed.titleIdeas
        .filter((t: any) => t && typeof t.title === "string")
        .map((t: any) => ({
          title: String(t.title || "").trim(),
          subtitle: String(t.subtitle || "").trim(),
          hook: t.hook ? String(t.hook).trim() : "",
        }))
    : [];

  const nextSteps: string[] = Array.isArray(parsed.nextSteps)
    ? parsed.nextSteps.filter(
        (s: any) => typeof s === "string" && s.trim().length > 0
      )
    : [];

  return {
    suggestions,
    nicheOpportunities: parsed.nicheOpportunities || { intro: "", items: [] },
    formatGaps: Array.isArray(parsed.formatGaps) ? parsed.formatGaps : [],
    idealReader:
      parsed.idealReader || {
        demographics: "",
        psychographics: "",
        painPoints: [],
        desiredOutcome: "",
        emotionalTrigger: "",
        emotionalPayoff: "",
      },
    positioningStatement: parsed.positioningStatement || "",
    differentiationAngles: Array.isArray(parsed.differentiationAngles)
      ? parsed.differentiationAngles
      : [],
    coreKeywords: Array.isArray(parsed.coreKeywords)
      ? parsed.coreKeywords
      : [],
    whiteSpaceKeywords: Array.isArray(parsed.whiteSpaceKeywords)
      ? parsed.whiteSpaceKeywords
      : [],
    suggestedCategories: Array.isArray(parsed.suggestedCategories)
      ? parsed.suggestedCategories
      : [],
    bestCategoryPath: parsed.bestCategoryPath || "",
    trendingKeywords: Array.isArray(parsed.trendingKeywords)
      ? parsed.trendingKeywords
      : [],
    bookBlueprint: parsed.bookBlueprint as BookBlueprint,
    titleIdeas,
    nextSteps,
  };
}

// -----------------------------
// Market snapshot computation
// -----------------------------

interface BucketStats {
  totalBooks: number;
  avgRating: number;
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
  dominantAuthors: { name: string; count: number }[];
  evergreenSignal: boolean;
  cheapBookShare: number;
  premiumBookShare: number;
}

function computeBucketStats(books: NormalizedBook[]): BucketStats {
  if (books.length === 0) {
    return {
      totalBooks: 0,
      avgRating: 0,
      avgReviews: 0,
      priceMin: null,
      priceMax: null,
      priceMedian: null,
      strongCompetitors: 0,
      midCompetitors: 0,
      lowReviewBooks: 0,
      bsrBuckets: { veryStrong: 0, strong: 0, moderate: 0, weak: 0 },
      dominantAuthors: [],
      evergreenSignal: false,
      cheapBookShare: 0,
      premiumBookShare: 0,
    };
  }

  const withRank: NormalizedBook[] = books.map((b) => {
    const effectiveRank = b.effectiveRank ?? computeEffectiveRank(b);
    return { ...b, effectiveRank, rank: effectiveRank };
  });

  const rankedBooks = withRank
    .filter((b) => typeof b.effectiveRank === "number")
    .sort((a, b) => a.effectiveRank! - b.effectiveRank!)
    .slice(0, 10);

  const bsrBuckets = {
    veryStrong: rankedBooks.filter((b) => b.effectiveRank! <= 10_000).length,
    strong: rankedBooks.filter((b) => b.effectiveRank! > 10_000 && b.effectiveRank! <= 100_000).length,
    moderate: rankedBooks.filter((b) => b.effectiveRank! > 100_000 && b.effectiveRank! <= 300_000).length,
    weak: rankedBooks.filter((b) => b.effectiveRank! > 300_000).length,
  };

  const ratings = books.map((b) => b.rating || 0);
  const reviews = books.map((b) => b.reviews || 0);
  const pricesRaw = books.map((b) => b.price).filter((p): p is number => typeof p === "number" && p > 0);

  const avgRating = ratings.reduce((sum, r) => sum + r, 0) / (ratings.length || 1);
  const avgReviews = reviews.reduce((sum, r) => sum + r, 0) / (reviews.length || 1);

  let priceMin: number | null = null;
  let priceMax: number | null = null;
  let priceMedian: number | null = null;
  let cheapBookShare = 0;
  let premiumBookShare = 0;

  if (pricesRaw.length > 0) {
    const sorted = [...pricesRaw].sort((a, b) => a - b);
    priceMin = sorted[0];
    priceMax = sorted[sorted.length - 1];
    priceMedian = sorted[Math.floor(sorted.length / 2)];
    cheapBookShare = pricesRaw.filter((p) => p <= 2.99).length / pricesRaw.length;
    premiumBookShare = pricesRaw.filter((p) => p >= 15).length / pricesRaw.length;
  }

  const strongCompetitors = books.filter((b) => (b.reviews ?? 0) >= 1000 && (b.rating ?? 0) >= 4.3).length;
  const midCompetitors = books.filter((b) => (b.reviews ?? 0) >= 100 && (b.reviews ?? 0) < 1000 && (b.rating ?? 0) >= 4.0).length;
  const lowReviewBooks = books.filter((b) => (b.reviews ?? 0) < 50).length;

  const allAuthors = books.flatMap((b) => b.authors || []);
  const authorFrequency: Record<string, number> = {};
  allAuthors.forEach((a) => { authorFrequency[a] = (authorFrequency[a] || 0) + 1; });
  const dominantAuthors = Object.entries(authorFrequency)
    .filter(([_, count]) => count >= 2)
    .map(([name, count]) => ({ name, count }));

  const pubYears = books
    .map((b) => b.publicationDate ? new Date(b.publicationDate).getFullYear() : null)
    .filter((y): y is number => y !== null && !isNaN(y));
  const currentYear = new Date().getFullYear();
  const recentCount = pubYears.filter((y) => y >= currentYear - 1).length;
  const oldCount = pubYears.filter((y) => y <= currentYear - 5).length;
  const evergreenSignal = recentCount > 0 && oldCount > 0;

  return {
    totalBooks: books.length,
    avgRating,
    avgReviews,
    priceMin,
    priceMax,
    priceMedian,
    strongCompetitors,
    midCompetitors,
    lowReviewBooks,
    bsrBuckets,
    dominantAuthors,
    evergreenSignal,
    cheapBookShare,
    premiumBookShare,
  };
}

interface MarketSignalSummary {
  coreBookCount: number;
  adjacentBookCount: number;
  totalBookCount: number;
  signalStrength: "strong" | "moderate" | "weak" | "sparse";
  dataSource: "core" | "adjacent" | "combined" | "insufficient";
  explanation: string;
}

function computeMarketSignalSummary(coreBooks: NormalizedBook[], adjacentBooks: NormalizedBook[]): MarketSignalSummary {
  const coreCount = coreBooks.length;
  const adjCount = adjacentBooks.length;
  const total = coreCount + adjCount;

  let signalStrength: MarketSignalSummary["signalStrength"];
  let dataSource: MarketSignalSummary["dataSource"];
  let explanation: string;

  if (coreCount >= 5) {
    signalStrength = "strong";
    dataSource = "core";
    explanation = `Strong signal from ${coreCount} direct competitors.`;
  } else if (coreCount >= 2) {
    signalStrength = "moderate";
    dataSource = adjCount > 0 ? "combined" : "core";
    explanation = `Moderate signal from ${coreCount} core competitors${adjCount > 0 ? ` plus ${adjCount} adjacent titles` : ""}.`;
  } else if (coreCount >= 1 && adjCount >= 3) {
    signalStrength = "moderate";
    dataSource = "combined";
    explanation = `Limited direct competitors (${coreCount}), but ${adjCount} strong adjacent titles suggest audience demand.`;
  } else if (adjCount >= 5) {
    signalStrength = "weak";
    dataSource = "adjacent";
    explanation = `No direct competitors found, but ${adjCount} adjacent books indicate potential audience crossover.`;
  } else if (adjCount >= 2) {
    signalStrength = "sparse";
    dataSource = "adjacent";
    explanation = `Sparse data: only ${adjCount} adjacent titles found. Market is unproven but may have whitespace opportunity.`;
  } else {
    signalStrength = "sparse";
    dataSource = "insufficient";
    explanation = `Very limited data (${total} books). This niche appears untested on Amazon.`;
  }

  return {
    coreBookCount: coreCount,
    adjacentBookCount: adjCount,
    totalBookCount: total,
    signalStrength,
    dataSource,
    explanation,
  };
}

function computeMarketSnapshot(
  books: NormalizedBook[],
  genreHint: GenreInfo,
  coreBooks?: NormalizedBook[],
  adjacentBooks?: NormalizedBook[]
) {
  // Compute signal summary if we have bucket data
  const core = coreBooks || books.filter((b) => b.relevanceBucket === "core");
  const adjacent = adjacentBooks || books.filter((b) => b.relevanceBucket === "adjacent");
  const marketSignal = computeMarketSignalSummary(core, adjacent);

  // Compute separate stats for core and adjacent
  const coreStats = computeBucketStats(core);
  const adjacentStats = computeBucketStats(adjacent);

  if (books.length === 0) {
    return {
      totalBooks: 0,
      avgRating: 0,
      avgReviews: 0,
      priceMin: null,
      priceMax: null,
      priceMedian: null,
      strongCompetitors: 0,
      midCompetitors: 0,
      lowReviewBooks: 0,
      bsrBuckets: {
        veryStrong: 0,
        strong: 0,
        moderate: 0,
        weak: 0,
      },
      dominantAuthors: [],
      evergreenSignal: false,
      cheapBookShare: 0,
      premiumBookShare: 0,
      verdict: "YELLOW" as const,
      verdictReason: "No relevant books found — this niche may be untested or use different terminology on Amazon.",
      demandLevel: "LOW" as const,
      competitionLevel: "LOW" as const,
      coreStats,
      adjacentStats,
      marketSignal,
    };
  }

  const withRank: NormalizedBook[] = books.map((b) => {
    const effectiveRank = b.effectiveRank ?? computeEffectiveRank(b);
    return {
      ...b,
      effectiveRank,
      rank: effectiveRank,
    };
  });

  const rankedBooks = withRank
    .filter((b) => typeof b.effectiveRank === "number")
    .sort((a, b) => (a.effectiveRank! - b.effectiveRank!))
    .slice(0, 5);

  const veryStrongBSR = rankedBooks.filter(
    (b) => b.effectiveRank! <= 10_000
  ).length;
  const strongBSR = rankedBooks.filter(
    (b) => b.effectiveRank! > 10_000 && b.effectiveRank! <= 100_000
  ).length;
  const moderateBSR = rankedBooks.filter(
    (b) => b.effectiveRank! > 100_000 && b.effectiveRank! <= 300_000
  ).length;
  const weakBSR = rankedBooks.filter((b) => b.effectiveRank! > 300_000).length;

  const bsrBuckets = {
    veryStrong: veryStrongBSR,
    strong: strongBSR,
    moderate: moderateBSR,
    weak: weakBSR,
  };

  let demandLevel: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  if (rankedBooks.length === 0) {
    demandLevel = "LOW";
  } else {
    const highDemandBooks = veryStrongBSR + strongBSR;
    if (highDemandBooks >= 3) {
      demandLevel = "HIGH";
    } else if (highDemandBooks >= 1 || moderateBSR >= 2) {
      demandLevel = "MEDIUM";
    } else {
      demandLevel = "LOW";
    }
  }

  const ratings = books.map((b) => b.rating || 0);
  const reviews = books.map((b) => b.reviews || 0);

  const pricesRaw = books
    .map((b) => b.price)
    .filter((p): p is number => typeof p === "number" && p > 0);

  const avgRating =
    ratings.reduce((sum, r) => sum + r, 0) / (ratings.length || 1);
  const avgReviews =
    reviews.reduce((sum, r) => sum + r, 0) / (reviews.length || 1);

  let priceMin: number | null = null;
  let priceMax: number | null = null;
  let priceMedian: number | null = null;
  let cheapBookShare = 0;
  let premiumBookShare = 0;

  if (pricesRaw.length > 0) {
    const sorted = [...pricesRaw].sort((a, b) => a - b);
    priceMin = sorted[0];
    priceMax = sorted[sorted.length - 1];
    priceMedian = sorted[Math.floor(sorted.length / 2)];

    cheapBookShare =
      pricesRaw.filter((p) => p <= 2.99).length / pricesRaw.length;
    premiumBookShare =
      pricesRaw.filter((p) => p >= 15).length / pricesRaw.length;
  }

  const strongCompetitors = books.filter(
    (b) => (b.reviews ?? 0) >= 1000 && (b.rating ?? 0) >= 4.3
  ).length;
  const midCompetitors = books.filter(
    (b) =>
      (b.reviews ?? 0) >= 100 &&
      (b.reviews ?? 0) < 1000 &&
      (b.rating ?? 0) >= 4.0
  ).length;
  const lowReviewBooks = books.filter((b) => (b.reviews ?? 0) < 50).length;

  const allAuthors = books.flatMap((b) => b.authors || []);
  const authorFrequency: Record<string, number> = {};
  allAuthors.forEach((a) => {
    authorFrequency[a] = (authorFrequency[a] || 0) + 1;
  });
  const dominantAuthors = Object.entries(authorFrequency)
    .filter(([_, count]) => count >= 3)
    .map(([name, count]) => ({ name, count }));

  const pubYears = books
    .map((b) => {
      if (!b.publicationDate) return null;
      const d = new Date(b.publicationDate);
      const year = d.getFullYear();
      return isNaN(year) ? null : year;
    })
    .filter((y): y is number => y !== null);

  const currentYear = new Date().getFullYear();
  const recentCount = pubYears.filter((y) => y >= currentYear - 1).length;
  const oldCount = pubYears.filter((y) => y <= currentYear - 5).length;
  const evergreenSignal = recentCount > 0 && oldCount > 0;

  let competitionLevel: "HIGH" | "MEDIUM" | "LOW";
  if (strongCompetitors > 5) {
    competitionLevel = "HIGH";
  } else if (strongCompetitors > 2) {
    competitionLevel = "MEDIUM";
  } else {
    competitionLevel = "LOW";
  }

  let verdict: "GREEN" | "YELLOW" | "RED";
  let verdictReason: string;

  // NEW: Use market signal to adjust verdict when core data is sparse
  const hasStrongAdjacent = marketSignal.adjacentBookCount >= 3 && adjacentStats.avgReviews >= 100;
  const hasAnyAdjacent = marketSignal.adjacentBookCount >= 1;
  const isSparseCore = marketSignal.coreBookCount < 3;

  if (demandLevel === "HIGH") {
    if (competitionLevel === "HIGH") {
      verdict = "YELLOW";
      verdictReason =
        "High demand but saturated with strong competitors. Differentiation is key.";
    } else {
      verdict = "GREEN";
      verdictReason =
        "Strong demand with manageable competition. Good opportunity.";
    }
  } else if (demandLevel === "MEDIUM") {
    if (competitionLevel === "LOW") {
      verdict = "GREEN";
      verdictReason =
        "Moderate demand with low competition. Room to establish yourself.";
    } else if (competitionLevel === "MEDIUM") {
      verdict = "YELLOW";
      verdictReason =
        "Moderate demand and competition. Success requires strong positioning.";
    } else {
      verdict = "RED";
      verdictReason =
        "Moderate demand but heavy competition. Hard to break through.";
    }
  } else {
    // LOW demand detected from core books - but check adjacent signal
    if (isSparseCore && hasStrongAdjacent) {
      // Override: sparse core but strong adjacent indicates whitespace opportunity
      verdict = "YELLOW";
      verdictReason = `Limited direct competitors, but strong adjacent titles (${marketSignal.adjacentBookCount} books) suggest audience demand exists. This may be a whitespace opportunity.`;
    } else if (isSparseCore && hasAnyAdjacent) {
      // Soften: some adjacent data
      verdict = "YELLOW";
      verdictReason = `Few direct competitors found, with ${marketSignal.adjacentBookCount} related titles in adjacent niches. Market is emerging or underserved.`;
    } else if (competitionLevel === "LOW") {
      verdict = "YELLOW";
      verdictReason =
        "Low demand but also low competition. Niche may be too small.";
    } else {
      verdict = "RED";
      verdictReason =
        "Low demand with existing competition. Not recommended.";
    }
  }

  // Add context about data quality
  if (rankedBooks.length === 0 && marketSignal.signalStrength !== "sparse") {
    verdictReason += " Rank data is limited, so treat demand estimates with caution.";
  } else if (marketSignal.signalStrength === "sparse") {
    verdictReason += " Note: This assessment is based on limited data.";
  }

  return {
    totalBooks: books.length,
    avgRating,
    avgReviews,
    priceMin,
    priceMax,
    priceMedian,
    strongCompetitors,
    midCompetitors,
    lowReviewBooks,
    bsrBuckets,
    dominantAuthors,
    evergreenSignal,
    cheapBookShare,
    premiumBookShare,
    verdict,
    verdictReason,
    demandLevel,
    competitionLevel,
    // NEW: Include separate bucket stats and market signal
    coreStats,
    adjacentStats,
    marketSignal,
  };
}

function getSalesLeaderRankBand(
  salesLeaders: { rank: number | null }[]
) {
  const ranks = salesLeaders
    .map((b) => b.rank)
    .filter(
      (r): r is number =>
        typeof r === "number" && r > 0 && r < 900_000
    );

  if (ranks.length === 0) {
    return null;
  }

  const best = Math.min(...ranks);
  const worst = Math.max(...ranks);

  return {
    best,
    worst,
    bestFormatted: `#${best.toLocaleString()}`,
    worstFormatted: `#${worst.toLocaleString()}`,
  };
}

// -----------------------------
// Trending niches helpers
// -----------------------------

function getDefaultTrendingNiches(): string[] {
  return [
    "productivity habit guides",
    "cozy small town mysteries",
    "personal finance basics",
  ];
}

async function extractNichesFromTitles(titles: string[]): Promise<string[]> {
  try {
    const prompt = `Analyze these trending Amazon book titles and identify 3 book niche ideas. Each niche MUST be exactly 3-5 words - short enough to be a search query.

Book titles:
${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Return exactly 3 niche ideas as a JSON array of strings. Keep each one SHORT (3-5 words max) so it works as a search term.

Good examples: ["cozy holiday mysteries", "habit building guides", "family drama fiction"]
Bad examples: ["Contemporary fiction exploring complex family dynamics" - TOO LONG]

Example format:
["short niche one", "short niche two", "short niche three"]`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || "";
    console.log("AI response for niches:", response);

    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const niches = JSON.parse(jsonMatch[0]) as string[];
        if (Array.isArray(niches) && niches.length > 0) {
          console.log("Extracted trending niches:", niches.slice(0, 3));
          return niches.slice(0, 3);
        }
      }
    } catch (parseError) {
      console.log("JSON parse failed, trying line-by-line parsing");
    }

    const niches = response
      .split("\n")
      .map((line) =>
        line
          .replace(/^\d+[\.\)]\s*|^[-•*]\s*|^["']|["']$/g, "")
          .trim()
      )
      .filter(
        (line) =>
          line.length > 10 &&
          line.length < 50 &&
          !line.startsWith("[") &&
          !line.startsWith("{")
      )
      .slice(0, 3);

    console.log("Extracted trending niches (fallback):", niches);
    return niches;
  } catch (error: any) {
    console.error(
      "Error extracting niches with AI:",
      error?.message || "Unknown error"
    );
    return [];
  }
}

async function fetchTrendingNiches(): Promise<string[]> {
  const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY;

  if (!RAINFOREST_API_KEY) {
    throw new Error("RAINFOREST_API_KEY not configured");
  }

  try {
    const params = {
      api_key: RAINFOREST_API_KEY,
      type: "search",
      amazon_domain: "amazon.com",
      search_term: "bestseller books 2024 2025",
      sort_by: "bestseller_rankings",
      number_of_results: 30,
    };

    const response = await axios.get("https://api.rainforestapi.com/request", {
      params,
    });

    const products: RainforestBook[] = response.data.search_results || [];
    console.log(
      `Fetched ${products.length} trending books from Amazon search`
    );

    if (products.length === 0) {
      return getDefaultTrendingNiches();
    }

    const bookTitles = products
      .slice(0, 20)
      .map((p) => p.title || "")
      .filter((t) => t.length > 0);

    const trendingNiches = await extractNichesFromTitles(bookTitles);
    return trendingNiches.length > 0
      ? trendingNiches
      : getDefaultTrendingNiches();
  } catch (error: any) {
    console.error(
      "Error fetching trending niches:",
      error?.message || "Unknown error"
    );
    return getDefaultTrendingNiches();
  }
}

// -----------------------------
// Niche profile helper
// -----------------------------

/**
 * Extract a structured NicheProfile from the raw idea.
 *
 * This wraps your existing extractNicheFromIdea(idea) helper so we:
 *  - keep using the same LLM / logic you already have
 *  - but upgrade the result into a richer NicheProfile object
 */
async function extractNicheProfile(
  idea: string,
  uiCategory: "fiction" | "nonfiction",
  audience: AudienceProfile
): Promise<{ nicheProfile: NicheProfile; isExtracted: boolean }> {
  const { niche: searchTermRaw, isExtracted } = await extractNicheFromIdea(idea);

  const searchTerm = (searchTermRaw || idea).trim();
  const lowerIdea = idea.toLowerCase();

  const rawNiche: NicheProfile = {
    rawIdea: idea,
    searchTerm,
    category: uiCategory,
    inferredAudience: audience,
    // add whatever other fields your NicheProfile needs, e.g.:
    // tone: ...,
    // specificity: ...,
  };

  return {
    nicheProfile: rawNiche,
    isExtracted,
  };
}

// -----------------------------
// Route registration
// -----------------------------

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Supabase config endpoint
  app.get("/api/auth/config", (req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    });
  });

  // -----------------------------
  // Trending niches endpoints
  // -----------------------------
  app.get("/api/trending", async (req, res) => {
    try {
      const cached = getCachedTrendingNiches();
      if (cached) {
        console.log("Returning cached trending niches");
        return res.json({
          niches: cached.niches,
          timestamp: cached.timestamp,
          cached: true,
        });
      }

      const niches = await fetchTrendingNiches();
      setCachedTrendingNiches(niches);

      return res.json({
        niches,
        timestamp: Date.now(),
        cached: false,
      });
    } catch (error: any) {
      console.error("Trending fetch error:", error);
      const defaultNiches = getDefaultTrendingNiches();
      return res.json({
        niches: defaultNiches,
        timestamp: Date.now(),
        cached: false,
        isDefault: true,
      });
    }
  });

  app.post("/api/trending/refresh", async (req, res) => {
    try {
      clearTrendingCache();
      console.log("Cleared trending cache, fetching fresh data");

      const niches = await fetchTrendingNiches();
      setCachedTrendingNiches(niches);

      return res.json({
        niches,
        timestamp: Date.now(),
        cached: false,
        refreshed: true,
      });
    } catch (error: any) {
      console.error("Trending refresh error:", error);
      const defaultNiches = getDefaultTrendingNiches();
      return res.status(500).json({
        niches: defaultNiches,
        timestamp: Date.now(),
        cached: false,
        isDefault: true,
        error: "Failed to fetch fresh trending data",
      });
    }
  });

  // ------------------------------------
  // Relevance scoring helpers
  // ------------------------------------

  function computeRelevanceScore(
    book: NormalizedBook,
    niche: NicheProfile,
    audience: AudienceProfile
  ): number {
    let score = 0;

    const title = (book.title || "").toLowerCase();
    const topic = (niche.topic || niche.searchTerm || "").toLowerCase();
    const searchTerm = (niche.searchTerm || "").toLowerCase();

    const categoriesText = Array.isArray((book as any).rawCategories)
      ? (book as any).rawCategories.join(" | ").toLowerCase()
      : "";

    // 1) Core keyword overlap
    const tokens = new Set(
      (searchTerm + " " + topic)
        .split(/[^a-z0-9]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 2)
    );

    let titleHits = 0;
    for (const token of tokens) {
      if (title.includes(token)) {
        titleHits += 1;
      }
    }

    if (titleHits > 0) {
      score += 15 + titleHits * 5;
    }

    if (categoriesText) {
      for (const token of tokens) {
        if (categoriesText.includes(token)) {
          score += 3;
        }
      }
    }

    // 2) Penalize obvious non-book junk
    const nonBookPatterns = [
      "planner",
      "calendar",
      "whiteboard",
      "dry erase",
      "notepad",
      "magnetic",
      "acrylic board",
      "meal planner pad",
      "weekly planner pad",
      "fridge calendar",
    ];

    for (const pattern of nonBookPatterns) {
      if (title.includes(pattern)) {
        score -= 40;
      }
    }

    // 3) Audience mismatch
    const looksKids =
      /for kids|for children|kids'|ages?\s*4-8|ages?\s*8-12|coloring book|activity book|picture book|toddler|preschool/.test(
        title
      ) || /children's/.test(categoriesText);

    const looksTeens =
      /for teens|teenagers|young adult|ya\b/.test(title) ||
      /teen & young adult/.test(categoriesText);

    if (audience.ageGroup === "adult") {
      if (looksKids) score -= 35;
      if (looksTeens) score -= 20;
    }

    if (audience.ageGroup === "kids" || audience.ageGroup === "teens") {
      if (
        /for adults|retirement|career|managers?|leaders?|business & money/.test(
          title + " " + categoriesText
        )
      ) {
        score -= 20;
      }
    }

    // 4) Subtype / vertical alignment
    const subtype = (niche.subtype || "").toLowerCase();

    if (subtype.includes("personal finance")) {
      if (
        /invest|index fund|etf|personal finance|budget|retirement|money skills/.test(
          title + " " + categoriesText
        )
      ) {
        score += 15;
      } else if (/day trading|options trading/.test(title)) {
        score += 2;
      } else {
        score -= 5;
      }
    }

    if (subtype.includes("cookbooks") || subtype.includes("meal planning")) {
      if (
        /cookbook|recipes?|meal prep|meal planning|dinner|slow cooker|instant pot|family meals?/.test(
          title + " " + categoriesText
        )
      ) {
        score += 15;
      } else if (/planner|calendar|whiteboard|notepad/.test(title)) {
        score -= 30;
      }
    }

    // 5) Hook alignment
    if (niche.hook) {
      const hookLower = niche.hook.toLowerCase();
      if (title.includes(hookLower)) {
        score += 10;
      }
    }

    // 6) Safeguard
    if (score === 0 && titleHits === 0) {
      score -= 5;
    }

    return score;
  }

  // Normalize raw relevance score to 0-1 scale
  function normalizeScore(rawScore: number): number {
    // Raw scores typically range from -40 to +50
    // Map to 0-1 scale with sigmoid-like transformation
    const MIN_RAW = -40;
    const MAX_RAW = 50;
    
    // Clamp the raw score
    const clamped = Math.max(MIN_RAW, Math.min(MAX_RAW, rawScore));
    
    // Linear normalization to 0-1
    const normalized = (clamped - MIN_RAW) / (MAX_RAW - MIN_RAW);
    
    return Math.round(normalized * 100) / 100; // Round to 2 decimal places
  }

  // Assign bucket based on normalized semantic score
  function assignBucket(semanticScore: number): "core" | "adjacent" | "out_of_niche" {
    if (semanticScore >= 0.70) return "core";
    if (semanticScore >= 0.50) return "adjacent";
    return "out_of_niche";
  }

  interface RelevanceBuckets {
    coreBooks: NormalizedBook[];
    adjacentBooks: NormalizedBook[];
    outOfNicheBooks: NormalizedBook[];
    allScoredBooks: NormalizedBook[];
  }

  function applyRelevanceFiltering(
    books: NormalizedBook[],
    niche: NicheProfile,
    audience: AudienceProfile
  ): {
    filteredBooks: NormalizedBook[];
    droppedBooks: NormalizedBook[];
    buckets: RelevanceBuckets;
  } {
    // Score and normalize all books
    const scored = books.map((b) => {
      const rawScore = computeRelevanceScore(b, niche, audience);
      const semanticScore = normalizeScore(rawScore);
      const bucket = assignBucket(semanticScore);
      
      // Attach scores to book
      const enrichedBook: NormalizedBook = {
        ...b,
        semanticScore,
        relevanceBucket: bucket,
      };
      
      return { book: enrichedBook, rawScore, semanticScore, bucket };
    });

    // Sort by rank first, then by semantic score
    const sortByRankAndScore = (a: typeof scored[0], b: typeof scored[0]) => {
      const aRank = typeof a.book.rank === "number" ? a.book.rank : Infinity;
      const bRank = typeof b.book.rank === "number" ? b.book.rank : Infinity;
      if (aRank !== bRank) return aRank - bRank;
      return b.semanticScore - a.semanticScore;
    };

    // Bucket books
    const coreBooks = scored
      .filter((s) => s.bucket === "core")
      .sort(sortByRankAndScore)
      .map((s) => s.book);
    
    const adjacentBooks = scored
      .filter((s) => s.bucket === "adjacent")
      .sort(sortByRankAndScore)
      .map((s) => s.book);
    
    const outOfNicheBooks = scored
      .filter((s) => s.bucket === "out_of_niche")
      .sort(sortByRankAndScore)
      .map((s) => s.book);

    // For backward compatibility: filteredBooks = core only
    // droppedBooks = out_of_niche (truly irrelevant)
    const filteredBooks = coreBooks;
    const droppedBooks = outOfNicheBooks;

    console.log("RELEVANCE FILTER DEBUG (with buckets):", {
      total: books.length,
      core: coreBooks.length,
      adjacent: adjacentBooks.length,
      outOfNiche: outOfNicheBooks.length,
      scoreRange: {
        min: Math.min(...scored.map(s => s.semanticScore)),
        max: Math.max(...scored.map(s => s.semanticScore)),
        avg: (scored.reduce((sum, s) => sum + s.semanticScore, 0) / scored.length).toFixed(2),
      },
    });

    // Log sample of each bucket for debugging
    if (coreBooks.length > 0) {
      console.log("CORE bucket sample:", coreBooks.slice(0, 3).map(b => ({
        title: b.title.substring(0, 50),
        score: b.semanticScore,
      })));
    }
    if (adjacentBooks.length > 0) {
      console.log("ADJACENT bucket sample:", adjacentBooks.slice(0, 3).map(b => ({
        title: b.title.substring(0, 50),
        score: b.semanticScore,
      })));
    }
    if (outOfNicheBooks.length > 0) {
      console.log("OUT_OF_NICHE bucket sample:", outOfNicheBooks.slice(0, 3).map(b => ({
        title: b.title.substring(0, 50),
        score: b.semanticScore,
      })));
    }

    return {
      filteredBooks,
      droppedBooks,
      buckets: {
        coreBooks,
        adjacentBooks,
        outOfNicheBooks,
        allScoredBooks: scored.map(s => s.book),
      },
    };
  }

  // -----------------------------
  // Core validation endpoint
  // -----------------------------
  app.post(
    "/api/validate",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const {
          idea,
          projectType,
          genreCategory,
          bookType,
          genreSubtype,
        } = req.body as {
          idea?: string;
          projectType?: string;
          genreCategory?: string;
          bookType?: string;
          genreSubtype?: string;
        };

        if (!idea || typeof idea !== "string" || !idea.trim()) {
          return res.status(400).json({ error: "Book idea is required." });
        }

        const uiCategory: "fiction" | "nonfiction" =
          projectType === "fiction" || genreCategory === "fiction"
            ? "fiction"
            : "nonfiction";

        const audience = getAudienceProfile(idea, uiCategory);
        console.log("AUDIENCE PROFILE:", audience);

        const userId = req.userId!;

        const uiCategoryRaw = (genreCategory || projectType || bookType || "")
          .toString()
          .trim()
          .toLowerCase();

        if (uiCategoryRaw !== "fiction" && uiCategoryRaw !== "nonfiction") {
          return res.status(400).json({
            error:
              "Genre selection required: projectType or genreCategory must be 'fiction' or 'nonfiction'.",
          });
        }

        const lockedCategory = uiCategoryRaw as "fiction" | "nonfiction";

        const lockedSubtype =
          (genreSubtype && genreSubtype.trim()) ||
          (lockedCategory === "fiction"
            ? "general fiction"
            : "general nonfiction");

        const genre = {
          category: lockedCategory,
          subtype: lockedSubtype,
        };

        console.log("HARD-LOCKED GENRE FROM UI:", genre);

        // Step 0: niche profile
        const { nicheProfile, isExtracted } = await extractNicheProfile(
          idea,
          uiCategory,
          audience
        );

        const searchTerm = (nicheProfile.searchTerm || "").trim();

        console.log(
          `Niche extraction result: input="${idea}" → searchTerm="${searchTerm}" ` +
            `(subtype="${nicheProfile.subtype}", topic="${nicheProfile.topic}", hook="${nicheProfile.hook}") ` +
            `(extracted=${isExtracted})`
        );

        // Step 1: Amazon data
        const { books: rawBooks, isDemo } = await fetchAmazonBooks(searchTerm);

        const books: NormalizedBook[] = rawBooks.map((b) => {
          const effectiveRank = computeEffectiveRank(b);

          return {
            ...b,
            effectiveRank,
            rank: effectiveRank,
            rankSource:
              typeof b.rawRank === "number" &&
              b.rawRank > 0 &&
              b.rawRank < 900_000
                ? "bestseller"
                : typeof effectiveRank === "number"
                ? "heuristic"
                : "missing",
          };
        });

        if (!books || books.length === 0) {
          const friendlyGenreLabel = generateFriendlyGenreLabel(
            searchTerm,
            genre,
            idea
          );

          return res.json({
            verdict: "insufficient-data",
            verdictReason:
              "We could not find enough comparable books on Amazon to analyze this niche confidently.",
            genre,
            normalizedGenre: genre,
            friendlyGenreLabel,
            isDemo,
            searchTerm,
            isExtracted,
            stats: {
              avgPrice: null,
              avgRating: 0,
              competitionLevel: "Unknown",
              demandLevel: "Unknown",
            },
            detailedStats: {
              totalBooks: 0,
              avgReviews: 0,
              priceMin: null,
              priceMax: null,
              priceMedian: null,
              strongCompetitors: 0,
              midCompetitors: 0,
              lowReviewBooks: 0,
              bsrBuckets: {
                veryStrong: 0,
                strong: 0,
                moderate: 0,
                weak: 0,
              },
              dominantAuthors: [],
              evergreenSignal: false,
              cheapBookShare: 0,
              premiumBookShare: 0,
            },
            books: [],
            suggestions: [
              "Try a broader keyword or different phrasing for your niche.",
              "Check whether the topic is too new or too specific to have a clear market on Amazon yet.",
            ],
            deepAnalysis: {},
            salesLeaders: [],
            savedResultId: null,
          });
        }

        // Step 2: Relevance filtering (new hybrid scoring with buckets)
        const booksForRelevance: BookForRelevance[] = books.map((b) => ({
          title: b.title,
          categories: b.rawCategories ?? [],
        }));

        const relevance = await scoreBooksForNiche(
          openai,
          searchTerm,
          booksForRelevance
        );

        // Attach relevance scores and buckets to books
        const scoredBooks = books.map((b, idx) => ({
          ...b,
          semanticScore: relevance[idx]?.semanticScore ?? 0,
          finalRelevanceScore: relevance[idx]?.finalScore ?? 0,
          relevanceBucket: relevance[idx]?.bucket ?? "out_of_niche",
        }));

        // Separate into buckets
        const coreBooks = scoredBooks.filter((_, idx) => relevance[idx]?.bucket === "core");
        const adjacentBooks = scoredBooks.filter((_, idx) => relevance[idx]?.bucket === "adjacent");
        const outOfNicheBooks = scoredBooks.filter((_, idx) => relevance[idx]?.bucket === "out_of_niche");

        // Use ONLY core books for primary competition analysis (tighter filtering)
        // But include adjacent books in the UI display
        const workingBooks = coreBooks;
        const displayBooks = [...coreBooks, ...adjacentBooks];

        console.log("=== RELEVANCE DEBUG (with buckets) ===");
        console.log("Relevance filter:", {
          totalBooks: books.length,
          coreBooks: coreBooks.length,
          adjacentBooks: adjacentBooks.length,
          outOfNicheBooks: outOfNicheBooks.length,
          usedForStats: workingBooks.length,
        });

        // Log score distribution
        const allScores = relevance.map(r => r.finalScore);
        console.log("Score distribution:", {
          min: Math.min(...allScores).toFixed(2),
          max: Math.max(...allScores).toFixed(2),
          avg: (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2),
        });

        // Sample titles from each bucket for debugging
        if (coreBooks.length > 0) {
          console.log("CORE sample:", coreBooks.slice(0, 3).map(b => b.title.substring(0, 50)));
        }
        if (adjacentBooks.length > 0) {
          console.log("ADJACENT sample:", adjacentBooks.slice(0, 3).map(b => b.title.substring(0, 50)));
        }
        if (outOfNicheBooks.length > 0) {
          console.log("OUT_OF_NICHE sample:", outOfNicheBooks.slice(0, 3).map(b => b.title.substring(0, 50)));
        }

        // Sales leaders
        const rankedCandidates = workingBooks
          .filter(
            (b) =>
              typeof b.effectiveRank === "number" &&
              b.effectiveRank > 0 &&
              b.effectiveRank < 900_000
          )
          .sort((a, b) => a.effectiveRank! - b.effectiveRank!);

        const salesLeaders = rankedCandidates.slice(0, 5).map((b) => ({
          title: b.title,
          author:
            Array.isArray(b.authors) && b.authors.length > 0
              ? b.authors.join(", ")
              : "Unknown",
          rank: b.effectiveRank as number,
          rating: b.rating ?? null,
          reviews: b.reviews ?? null,
          price: b.price ?? null,
        }));

        // Market stats - now with core/adjacent separation
        const analysis = computeMarketSnapshot(workingBooks, genre, coreBooks, adjacentBooks);

        // Infer genre from Amazon category data (use ALL books for better clustering)
        const inferredGenre = inferGenreFromBooks([...coreBooks, ...adjacentBooks], genre.category);
        const inferredGenreLabel = generateFriendlyGenreLabelFromInferred(inferredGenre);
        
        console.log("=== GENRE INFERENCE DEBUG ===");
        console.log("Inferred genre:", {
          category: inferredGenre.category,
          shelf: inferredGenre.shelf,
          subgenre: inferredGenre.subgenre,
          microgenre: inferredGenre.microgenre,
          primaryPath: inferredGenre.amazonPrimaryPath,
          alternatePaths: inferredGenre.amazonAlternatePaths,
        });

        // Use Amazon category path as primary label when available, with friendly fallback
        const amazonStyleLabel = inferredGenre.amazonPrimaryPath 
          ? inferredGenre.amazonPrimaryPath.replace(/^Books\s*>\s*/i, "").trim()
          : null;
        const friendlyGenreLabel = inferredGenreLabel || generateFriendlyGenreLabel(
          searchTerm,
          genre,
          idea
        );
        // Prefer Amazon-style label for authenticity, fall back to friendly label
        const displayGenreLabel = amazonStyleLabel || friendlyGenreLabel;

        const normalizedGenre = {
          category: genre.category,
          subtype: inferredGenre.subgenre || genre.subtype || "general",
          label: displayGenreLabel,
          friendlyLabel: friendlyGenreLabel,
          // New extended genre fields
          shelf: inferredGenre.shelf,
          subgenre: inferredGenre.subgenre,
          microgenre: inferredGenre.microgenre,
          amazonPrimaryPath: inferredGenre.amazonPrimaryPath,
          amazonAlternatePaths: inferredGenre.amazonAlternatePaths,
        };

        // Deep analysis
        const fullAnalysis = await generateFullNicheAnalysis(
          idea,
          normalizedGenre,
          analysis,
          workingBooks,
          friendlyGenreLabel
        );

        const demandRaw = String(analysis.demandLevel || "")
          .trim()
          .toLowerCase();
        const competitionRaw = String(analysis.competitionLevel || "")
          .trim()
          .toLowerCase();

        const demandLevelPretty =
          demandRaw === "high"
            ? "High"
            : demandRaw === "medium" || demandRaw === "moderate"
            ? "Medium"
            : "Low";

        const competitionLevelPretty =
          competitionRaw === "high"
            ? "High"
            : competitionRaw === "medium" || competitionRaw === "moderate"
            ? "Medium"
            : "Low";

        // Show both core and adjacent books in UI, but mark their bucket
        const uiBooks = displayBooks.slice(0, 15).map((b) => ({
          title: b.title,
          author:
            Array.isArray(b.authors) && b.authors.length > 0
              ? b.authors[0]
              : "Unknown",
          price: b.price ?? null,
          rating: b.rating ?? null,
          reviews: b.reviews ?? null,
          rank: b.rank ?? b.effectiveRank ?? null,
          image: b.image ?? null,
          coverColor: `hsl(${Math.random() * 360}, 70%, 80%)`,
          publicationYear: b.publicationYear ?? null,
          semanticScore: b.semanticScore ?? null,
          finalRelevanceScore: (b as any).finalRelevanceScore ?? null,
          relevanceBucket: b.relevanceBucket ?? null,
        }));

        const pricedBooksForStats = uiBooks.filter(
          (b) => typeof b.price === "number" && (b.price as number) > 0
        );

        const avgPrice =
          pricedBooksForStats.length > 0
            ? pricedBooksForStats.reduce(
                (sum, b) => sum + (b.price as number),
                0
              ) / pricedBooksForStats.length
            : null;

        const rankBand = getSalesLeaderRankBand(salesLeaders);

        const demandDescription =
          demandLevelPretty === "High"
            ? "strong reader demand"
            : demandLevelPretty === "Medium"
            ? "solid, proven demand"
            : "more experimental or emerging demand";

        const competitionDescription =
          competitionLevelPretty === "High"
            ? "heavy competition from established titles"
            : competitionLevelPretty === "Medium"
            ? "a mix of strong players and room for new voices"
            : "relatively low competition and room to stand out";

        let verdictReason: string;

        if (rankBand) {
          verdictReason =
            `Top 5 bestsellers in this niche range from ${rankBand.bestFormatted} ` +
            `to ${rankBand.worstFormatted} in Books, indicating ${demandDescription} ` +
            `with ${competitionDescription}.`;

          if (analysis.verdictReason) {
            verdictReason += ` ${analysis.verdictReason}`;
          }
        } else {
          verdictReason =
            analysis.verdictReason ||
            "We weren’t able to calculate reliable bestseller ranks, but we estimated demand and competition from review counts and pricing patterns.";
        }

        const responseData = {
          verdict: analysis.verdict,
          verdictReason,
          genre: normalizedGenre,
          friendlyGenreLabel: normalizedGenre.label,
          isDemo,
          searchTerm,
          isExtracted,
          stats: {
            avgPrice,
            avgRating: analysis.avgRating ?? null,
            competitionLevel: competitionLevelPretty,
            demandLevel: demandLevelPretty,
          },
          detailedStats: {
            totalBooks: analysis.totalBooks,
            avgReviews: analysis.avgReviews,
            priceMin: analysis.priceMin,
            priceMax: analysis.priceMax,
            priceMedian: analysis.priceMedian,
            strongCompetitors: analysis.strongCompetitors,
            midCompetitors: analysis.midCompetitors,
            lowReviewBooks: analysis.lowReviewBooks,
            bsrBuckets: analysis.bsrBuckets,
            dominantAuthors: analysis.dominantAuthors,
            evergreenSignal: analysis.evergreenSignal,
            cheapBookShare: analysis.cheapBookShare,
            premiumBookShare: analysis.premiumBookShare,
          },
          // NEW: Separate core and adjacent stats with market signal
          coreStats: analysis.coreStats,
          adjacentStats: analysis.adjacentStats,
          marketSignal: analysis.marketSignal,
          books: uiBooks,
          suggestions: fullAnalysis.suggestions,
          deepAnalysis: {
            nicheOpportunities: fullAnalysis.nicheOpportunities,
            formatGaps: fullAnalysis.formatGaps,
            idealReader: fullAnalysis.idealReader,
            positioningStatement: fullAnalysis.positioningStatement,
            differentiationAngles: fullAnalysis.differentiationAngles,
            coreKeywords: fullAnalysis.coreKeywords,
            whiteSpaceKeywords: fullAnalysis.whiteSpaceKeywords,
            suggestedCategories: fullAnalysis.suggestedCategories,
            bestCategoryPath: fullAnalysis.bestCategoryPath,
            trendingKeywords: fullAnalysis.trendingKeywords,
            bookBlueprint: fullAnalysis.bookBlueprint,
            titleIdeas:
              fullAnalysis.titleIdeas && fullAnalysis.titleIdeas.length > 0
                ? fullAnalysis.titleIdeas
                : [
                    {
                      title:
                        fullAnalysis.bookBlueprint?.working_title ||
                        normalizedGenre.label,
                      subtitle: fullAnalysis.bookBlueprint?.subtitle || "",
                      hook:
                        fullAnalysis.bookBlueprint?.logline ||
                        analysis.verdictReason ||
                        "",
                    },
                  ],
            nextSteps: fullAnalysis.nextSteps,
          },
          salesLeaders,
        };

        let savedResultId: string | null = null;
        try {
          const savedResult = await storage.saveResult({
            userId,
            niche: idea,
            verdict: analysis.verdict,
            demandScore: demandLevelPretty,
            competitionScore: competitionLevelPretty,
            keyInsights: (fullAnalysis.suggestions || [])
              .slice(0, 2)
              .join(" | "),
            fullReportJson: responseData,
          });
          savedResultId = savedResult.id;
        } catch (saveError) {
          console.error("Failed to save result to database:", saveError);
        }

        console.log(
          "FULL VALIDATION JSON:",
          JSON.stringify({ ...responseData, savedResultId }, null, 2)
        );

        return res.json({ ...responseData, savedResultId });
      } catch (error: any) {
        console.error("Validation error:", error);

        if (
          error.response?.status === 402 ||
          (typeof error.message === "string" && error.message.includes("402"))
        ) {
          return res.status(503).json({
            error: "API quota exceeded",
            details:
              "The Amazon data service has reached its usage limit. Please try again later or contact support to add more API credits.",
          });
        }

        return res.status(500).json({
          error: "Failed to validate book idea",
          details: error.message || "Unknown error",
        });
      }
    }
  );

  // -----------------------------
  // CSV export
  // -----------------------------
  app.get(
    "/api/saved-results/export/csv",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const userId = req.userId!;
        const results = await storage.getAllResultsByUser(userId);

        const sanitizeForCSV = (value: any): string => {
          if (value === null || value === undefined) return "";
          const str = String(value);
          let sanitized = str.replace(/"/g, '""');
          sanitized = sanitized.replace(/[\r\n]+/g, " ");
          if (/^[=+\-@\t\r]/.test(sanitized)) {
            sanitized = "'" + sanitized;
          }
          return sanitized;
        };

        interface FlattenedResult {
          id: string;
          createdAt: string;
          nicheInput: string;
          verdict: string;
          verdictReason: string;
          genreCategory: string;
          genreSubtype: string;
          friendlyGenreLabel: string;
          demandScore: string;
          competitionScore: string;
          avgPrice: string;
          avgRating: string;
          totalBooks: string;
          avgReviews: string;
          priceMin: string;
          priceMedian: string;
          priceMax: string;
          veryStrongBSR: string;
          strongBSR: string;
          moderateBSR: string;
          weakBSR: string;
          strongCompetitors: string;
          midCompetitors: string;
          lowReviewBooks: string;
          evergreenSignal: string;
          cheapBookShare: string;
          premiumBookShare: string;
          category1: string;
          category2: string;
          category3: string;
          nicheOpportunity1: string;
          nicheOpportunity2: string;
          formatGap1: string;
          formatGap2: string;
          idealReaderDemographics: string;
          idealReaderPsychographics: string;
          idealReaderPainPoint1: string;
          idealReaderPainPoint2: string;
          idealReaderDesiredOutcome: string;
          positioningStatement: string;
          titleIdea1Title: string;
          titleIdea1Subtitle: string;
          titleIdea1Hook: string;
          nextStep1: string;
          nextStep2: string;
          nextStep3: string;
          nextStep4: string;
          coreKeywords: string[];
          whiteSpaceKeywords: string[];
        }

        const flattenResult = (r: any): FlattenedResult => {
          const analysis = r.fullReportJson || {};
          const stats = analysis.stats || {};
          const detailedStats = analysis.detailedStats || {};
          const bsrBuckets = detailedStats.bsrBuckets || {};
          const deepAnalysis = analysis.deepAnalysis || {};
          const idealReader = deepAnalysis.idealReader || {};
          const storedGenre =
            analysis.genre ||
            analysis.normalizedGenre ||
            (r as any).genre ||
            {};

          const genreCategory =
            storedGenre.category &&
            ["fiction", "nonfiction"].includes(
              storedGenre.category.toString().toLowerCase()
            )
              ? storedGenre.category.toString().toLowerCase()
              : null;

          const genreSubtype =
            (storedGenre.subtype && storedGenre.subtype.toString().trim()) ||
            (genreCategory === "fiction"
              ? "general fiction"
              : genreCategory === "nonfiction"
              ? "general nonfiction"
              : "");

          const genre = {
            category: genreCategory || "",
            subtype: genreSubtype || "",
          };

          const suggestedCategories = deepAnalysis.suggestedCategories || [];
          const nicheOpportunitiesData = deepAnalysis.nicheOpportunities || {};
          const nicheOpportunityItems = nicheOpportunitiesData.items || [];
          const formatGaps = deepAnalysis.formatGaps || [];
          const painPoints = idealReader.painPoints || [];
          const titleIdeas = deepAnalysis.titleIdeas || [];
          const nextSteps = deepAnalysis.nextSteps || [];
          const coreKeywords = deepAnalysis.coreKeywords || [];
          const whiteSpaceKeywords = deepAnalysis.whiteSpaceKeywords || [];

          return {
            id: r.id || "",
            createdAt: r.createdAt
              ? new Date(r.createdAt).toISOString()
              : "",
            nicheInput: r.niche || "",
            verdict: r.verdict || "",
            verdictReason: analysis.verdictReason || "",
            genreCategory: genre.category || "",
            genreSubtype: genre.subtype || "",
            friendlyGenreLabel:
              (storedGenre.label && storedGenre.label.toString()) ||
              analysis.friendlyGenreLabel ||
              "",
            demandScore: r.demandScore || "",
            competitionScore: r.competitionScore || "",
            avgPrice:
              stats.avgPrice != null ? String(stats.avgPrice) : "",
            avgRating:
              stats.avgRating != null ? String(stats.avgRating) : "",
            totalBooks:
              detailedStats.totalBooks != null
                ? String(detailedStats.totalBooks)
                : "",
            avgReviews:
              detailedStats.avgReviews != null
                ? String(detailedStats.avgReviews)
                : "",
            priceMin:
              detailedStats.priceMin != null
                ? String(detailedStats.priceMin)
                : "",
            priceMedian:
              detailedStats.priceMedian != null
                ? String(detailedStats.priceMedian)
                : "",
            priceMax:
              detailedStats.priceMax != null
                ? String(detailedStats.priceMax)
                : "",
            veryStrongBSR:
              bsrBuckets.veryStrong != null
                ? String(bsrBuckets.veryStrong)
                : "",
            strongBSR:
              bsrBuckets.strong != null
                ? String(bsrBuckets.strong)
                : "",
            moderateBSR:
              bsrBuckets.moderate != null
                ? String(bsrBuckets.moderate)
                : "",
            weakBSR:
              bsrBuckets.weak != null ? String(bsrBuckets.weak) : "",
            strongCompetitors:
              detailedStats.strongCompetitors != null
                ? String(detailedStats.strongCompetitors)
                : "",
            midCompetitors:
              detailedStats.midCompetitors != null
                ? String(detailedStats.midCompetitors)
                : "",
            lowReviewBooks:
              detailedStats.lowReviewBooks != null
                ? String(detailedStats.lowReviewBooks)
                : "",
            evergreenSignal:
              detailedStats.evergreenSignal != null
                ? String(detailedStats.evergreenSignal)
                : "",
            cheapBookShare:
              detailedStats.cheapBookShare != null
                ? String(detailedStats.cheapBookShare)
                : "",
            premiumBookShare:
              detailedStats.premiumBookShare != null
                ? String(detailedStats.premiumBookShare)
                : "",
            category1: suggestedCategories[0] || "",
            category2: suggestedCategories[1] || "",
            category3: suggestedCategories[2] || "",
            nicheOpportunity1: nicheOpportunityItems[0] || "",
            nicheOpportunity2: nicheOpportunityItems[1] || "",
            formatGap1: formatGaps[0] || "",
            formatGap2: formatGaps[1] || "",
            idealReaderDemographics: idealReader.demographics || "",
            idealReaderPsychographics: idealReader.psychographics || "",
            idealReaderPainPoint1: painPoints[0] || "",
            idealReaderPainPoint2: painPoints[1] || "",
            idealReaderDesiredOutcome: idealReader.desiredOutcome || "",
            positioningStatement: deepAnalysis.positioningStatement || "",
            titleIdea1Title: titleIdeas[0]?.title || "",
            titleIdea1Subtitle: titleIdeas[0]?.subtitle || "",
            titleIdea1Hook: titleIdeas[0]?.hook || "",
            nextStep1: nextSteps[0] || "",
            nextStep2: nextSteps[1] || "",
            nextStep3: nextSteps[2] || "",
            nextStep4: nextSteps[3] || "",
            coreKeywords: Array.isArray(coreKeywords) ? coreKeywords : [],
            whiteSpaceKeywords: Array.isArray(whiteSpaceKeywords)
              ? whiteSpaceKeywords
              : [],
          };
        };

        const flattenedResults = results.map(flattenResult);

        const maxCoreKeywords = Math.max(
          0,
          ...flattenedResults.map((r) => r.coreKeywords.length)
        );
        const maxWhiteSpaceKeywords = Math.max(
          0,
          ...flattenedResults.map((r) => r.whiteSpaceKeywords.length)
        );

        const baseColumns = [
          "id",
          "createdAt",
          "nicheInput",
          "verdict",
          "verdictReason",
          "genreCategory",
          "genreSubtype",
          "friendlyGenreLabel",
          "demandScore",
          "competitionScore",
          "avgPrice",
          "avgRating",
          "totalBooks",
          "avgReviews",
          "priceMin",
          "priceMedian",
          "priceMax",
          "veryStrongBSR",
          "strongBSR",
          "moderateBSR",
          "weakBSR",
          "strongCompetitors",
          "midCompetitors",
          "lowReviewBooks",
          "evergreenSignal",
          "cheapBookShare",
          "premiumBookShare",
          "category1",
          "category2",
          "category3",
          "nicheOpportunity1",
          "nicheOpportunity2",
          "formatGap1",
          "formatGap2",
          "idealReaderDemographics",
          "idealReaderPsychographics",
          "idealReaderPainPoint1",
          "idealReaderPainPoint2",
          "idealReaderDesiredOutcome",
          "positioningStatement",
          "titleIdea1Title",
          "titleIdea1Subtitle",
          "titleIdea1Hook",
          "nextStep1",
          "nextStep2",
          "nextStep3",
          "nextStep4",
        ];

        const coreKeywordColumns = Array.from(
          { length: maxCoreKeywords },
          (_, i) => `coreKeyword${i + 1}`
        );
        const whiteSpaceKeywordColumns = Array.from(
          { length: maxWhiteSpaceKeywords },
          (_, i) => `whiteSpaceKeyword${i + 1}`
        );

        const allColumns = [
          ...baseColumns,
          ...coreKeywordColumns,
          ...whiteSpaceKeywordColumns,
        ];

        const csvHeader = allColumns.join(",") + "\n";

        const csvRows = flattenedResults
          .map((row) => {
            return allColumns
              .map((col) => {
                let value: string;
                if (col.startsWith("coreKeyword")) {
                  const idx = parseInt(col.replace("coreKeyword", ""), 10) - 1;
                  value = row.coreKeywords[idx] || "";
                } else if (col.startsWith("whiteSpaceKeyword")) {
                  const idx = parseInt(
                    col.replace("whiteSpaceKeyword", ""),
                    10
                  ) - 1;
                  value = row.whiteSpaceKeywords[idx] || "";
                } else {
                  value = (row as any)[col] || "";
                }
                return `"${sanitizeForCSV(value)}"`;
              })
              .join(",");
          })
          .join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=book-validation-results.csv"
        );
        res.send(csvHeader + csvRows);
      } catch (error: any) {
        console.error("Error exporting CSV:", error);
        res.status(500).json({ error: "Failed to export CSV" });
      }
    }
  );

  // -----------------------------
  // Book blueprint routes
  // -----------------------------

  app.post(
    "/api/book-blueprints/generate",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const userId = req.userId!;
        const { validationId } = req.body;

        if (!validationId || typeof validationId !== "string") {
          return res
            .status(400)
            .json({ success: false, error: "validationId is required" });
        }

        const validation = await storage.getResultById(validationId, userId);
        if (!validation) {
          return res.status(404).json({
            success: false,
            error: "Validation not found or not owned by this user",
          });
        }

        const analysis = (validation.fullReportJson as any) || {};
        const stats = analysis.stats || {};
        const detailedStats = analysis.detailedStats || {};
        const deepAnalysis = analysis.deepAnalysis || {};

        const storedGenre =
          analysis.genre ||
          analysis.normalizedGenre ||
          (validation as any).genre ||
          {};

        const genreCategoryRaw = (storedGenre.category || "")
          .toString()
          .toLowerCase();
        const genreCategory =
          genreCategoryRaw === "fiction" || genreCategoryRaw === "nonfiction"
            ? (genreCategoryRaw as "fiction" | "nonfiction")
            : null;

        if (!genreCategory) {
          console.error("Locked genre missing or invalid on validation:", storedGenre);
          return res.status(500).json({
            success: false,
            error:
              "Locked genre missing on validation. Please re-run the market validation with a selected genre.",
          });
        }

        const genreSubtype =
          (storedGenre.subtype && storedGenre.subtype.toString().trim()) ||
          (genreCategory === "fiction"
            ? "general fiction"
            : "general nonfiction");

        const genre = {
          category: genreCategory,
          subtype: genreSubtype,
        };

        console.log("Blueprint: using locked genre from validation:", genre);

        const promptContext = `You are a professional book development editor. Your job is to transform MARKET INSIGHTS into a SIMPLE, ACTIONABLE BOOK BLUEPRINT that an author can use to start writing immediately.

GENRE LOCK (DO NOT OVERRIDE):
The author has explicitly selected this genre:
- Category: ${genre.category}
- Subtype: ${genre.subtype}

You MUST treat this as a ${genre.category.toUpperCase()} project.
Do NOT reclassify or reinterpret the genre.
All categories, comps, structure, tropes, pacing, and blueprint decisions must align with this locked genre.

MARKET VALIDATION DATA:
- Niche Input: "${validation.niche}"
- Verdict: ${analysis.verdict || "N/A"} - ${analysis.verdictReason || "N/A"}
- Genre: ${genre.category} / ${genre.subtype}

MARKET METRICS:
- Average Rating: ${stats.avgRating ?? "N/A"}
- Average Reviews: ${detailedStats.avgReviews ?? "N/A"}
- Price Range: $${detailedStats.priceMin ?? "?"} - $${detailedStats.priceMax ?? "?"}
- Strong Competitors (1000+ reviews): ${detailedStats.strongCompetitors ?? 0}
- Mid-Tier Competitors: ${detailedStats.midCompetitors ?? 0}
- Low Review Books (<50): ${detailedStats.lowReviewBooks ?? 0}

KEYWORDS:
- Core Keywords: ${JSON.stringify(deepAnalysis.coreKeywords || [])}
- White Space Keywords: ${JSON.stringify(deepAnalysis.whiteSpaceKeywords || [])}

NICHE OPPORTUNITIES: ${
          (deepAnalysis.nicheOpportunities?.items || []).join("; ") || "N/A"
        }
FORMAT GAPS: ${(deepAnalysis.formatGaps || []).join("; ") || "N/A"}

Create a comprehensive book blueprint. Return STRICT JSON ONLY with this exact structure:

{
  "working_title": "1 strong working title (not multiple options)",
  "subtitle": "1 concise subtitle that clarifies what the book does and for whom",
  "logline": "ONE sentence...",
  "core_promise": "...",
  "ideal_reader": "...",
  "differentiation": "...",
  "format": "...",
  "constraints": {
    "word_count_target": 25000,
    "reading_level": "...",
    "timeframe": "..."
  },
  "structure": {
    "overview": "...",
    "sections": [
      {
        "title": "...",
        "description": "...",
        "chapters": [
          {
            "title": "...",
            "purpose": "...",
            "notes": "..."
          }
        ]
      }
    ]
  },
  "fiveBeatStructure": {
    "setup": "...",
    "disruption": "...",
    "risingComplications": "...",
    "climax": "...",
    "resolution": "..."
  },
  "openingCatalystPrompt": "...",
  "voice_and_style": "...",
  "comparable_titles": "...",
  "positioning_notes": "...",
  "primary_keywords": ["..."],
  "whitespace_keywords": ["..."]
}

CRITICAL INSTRUCTIONS:
1. Be concise and concrete.
2. Avoid fluffy, generic marketing language.
3. Focus on clarity and usability.
4. Structure sections: 3-6 sections, each with 3-8 chapters.
5. word_count_target must be an integer.
6. ALWAYS return valid JSON with double quotes.
7. NO trailing commas, NO markdown, NO extra text outside the JSON object.
8. Start with { and end with }.
`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [{ role: "user", content: promptContext }],
          temperature: 0.7,
          max_tokens: 4000,
        });

        const responseText =
          completion.choices[0]?.message?.content?.trim() || "";

        let parsed: any;
        try {
          let cleanedResponse = responseText;
          if (cleanedResponse.startsWith("```json")) {
            cleanedResponse = cleanedResponse.slice(7);
          }
          if (cleanedResponse.startsWith("```")) {
            cleanedResponse = cleanedResponse.slice(3);
          }
          if (cleanedResponse.endsWith("```")) {
            cleanedResponse = cleanedResponse.slice(0, -3);
          }
          cleanedResponse = cleanedResponse.trim();

          const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error("No JSON object found in response");
          }
          parsed = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error("Failed to parse OpenAI response:", responseText);
          return res.status(500).json({
            success: false,
            error: "Invalid JSON returned from AI. Please try again.",
          });
        }

        if (!parsed.working_title || !parsed.structure) {
          return res.status(500).json({
            success: false,
            error: "AI response missing required fields. Please try again.",
          });
        }

        const blueprintData = {
          working_title: parsed.working_title || "",
          subtitle: parsed.subtitle || "",
          logline: parsed.logline || "",
          core_promise: parsed.core_promise || "",
          ideal_reader: parsed.ideal_reader || "",
          differentiation: parsed.differentiation || "",
          format: parsed.format || "",
          constraints: {
            word_count_target:
              typeof parsed.constraints?.word_count_target === "number"
                ? parsed.constraints.word_count_target
                : 25000,
            reading_level:
              parsed.constraints?.reading_level ||
              (genre.category === "fiction"
                ? "Adult commercial fiction"
                : "Adult popular nonfiction"),
            timeframe: parsed.constraints?.timeframe || "8-12 chapters",
          },
          structure: {
            overview: parsed.structure?.overview || "",
            sections: Array.isArray(parsed.structure?.sections)
              ? parsed.structure.sections.map((s: any) => ({
                  title: s.title || "",
                  description: s.description || "",
                  chapters: Array.isArray(s.chapters)
                    ? s.chapters.map((c: any) => ({
                        title: c.title || "",
                        purpose: c.purpose || "",
                        notes: c.notes || "",
                      }))
                    : [],
                }))
              : [],
          },
          fiveBeatStructure: {
            setup: parsed.fiveBeatStructure?.setup || "",
            disruption: parsed.fiveBeatStructure?.disruption || "",
            risingComplications:
              parsed.fiveBeatStructure?.risingComplications || "",
            climax: parsed.fiveBeatStructure?.climax || "",
            resolution: parsed.fiveBeatStructure?.resolution || "",
          },
          openingCatalystPrompt: parsed.openingCatalystPrompt || "",
          voice_and_style: parsed.voice_and_style || "",
          comparable_titles: parsed.comparable_titles || "",
          positioning_notes: parsed.positioning_notes || "",
          primary_keywords: Array.isArray(parsed.primary_keywords)
            ? parsed.primary_keywords
            : [],
          whitespace_keywords: Array.isArray(parsed.whitespace_keywords)
            ? parsed.whitespace_keywords
            : [],
        };

        const blueprint = await storage.upsertBlueprint(
          userId,
          validationId,
          blueprintData
        );

        return res.json({ success: true, data: blueprint });
      } catch (error: any) {
        console.error("Error generating book blueprint:", error);
        return res.status(500).json({
          success: false,
          error: error.message || "Failed to generate blueprint",
        });
      }
    }
  );

  // Book blueprint save
  app.post(
    "/api/book-blueprints/save",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const userId = req.userId!;
        const { validationId, blueprintData } = req.body as {
          validationId?: string;
          blueprintData?: any;
        };

        if (!validationId || typeof validationId !== "string") {
          return res.status(400).json({
            success: false,
            error: "validationId is required",
          });
        }

        if (!blueprintData || typeof blueprintData !== "object") {
          return res.status(400).json({
            success: false,
            error: "blueprintData is required",
          });
        }

        const blueprint = await storage.upsertBlueprint(
          userId,
          validationId,
          blueprintData
        );

        return res.json({ success: true, data: blueprint });
      } catch (error: any) {
        console.error("Error saving book blueprint:", error);
        return res.status(500).json({
          success: false,
          error: error.message || "Failed to save blueprint",
        });
      }
    }
  );

  // Book blueprint retrieval
  app.get(
    "/api/book-blueprints/:validationId",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const userId = req.userId!;
        const { validationId } = req.params;

        if (!validationId || typeof validationId !== "string") {
          return res.status(400).json({
            success: false,
            error: "validationId is required",
          });
        }

        const blueprint = await storage.getBlueprint(userId, validationId);

        return res.json({
          success: true,
          data: blueprint || null,
        });
      } catch (error: any) {
        console.error("Error fetching book blueprint:", error);
        return res.status(500).json({
          success: false,
          error: error.message || "Failed to fetch blueprint",
        });
      }
    }
  );

  // -----------------------------
  // End of registerRoutes
  // -----------------------------
  return httpServer;
}