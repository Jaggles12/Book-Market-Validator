import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import axios from "axios";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { storage } from "./storage";
import { AudienceProfile, NicheProfile, NormalizedBook, InferredGenre, CanonicalNiche } from "./types";
import { getAudienceProfile } from "./audience";
import { scoreBooksForNiche, type BookForRelevance } from "./relevance";
import { normalizeSearchTerms, type NormalizedSearchTerms } from "./keywordNormalizer";
import { inferGenreFromBooks, generateFriendlyGenreLabelFromInferred } from "./genreInference";
import { deriveCanonicalNiche, computeSearchResultPurity, scoreCategoryAlignment, generateSearchTermsFromNiche } from "./canonicalNiche";
import { runBookMarketValidation, generateFriendlyGenreLabel } from "./validatorService";
import { amazonClient, RainforestBook, RainforestRankEntry, ProductEnrichmentData } from "./amazon";

// Destructure from the provider-agnostic amazon client
const {
  fetchAmazonBooks,
  computeEffectiveRank,
  generateDemoBooks,
  demoMode,
  setDemoMode,
  extractSubcategoryLabel,
  chooseBestRankFromBestsellers,
  filterToBooksOnly,
  fetchProductBSR,
  enrichBookWithProductDetails,
  batchEnrichBooks,
  applyEnrichmentToBooks,
  buildBooksSearchUrl,
} = amazonClient;


// -----------------------------
// Pipeline Configuration Constants
// -----------------------------
const MIN_CORE_BOOKS = 3;        // Minimum books in core bucket for reliable stats
const MIN_TOTAL_FOR_STATS = 5;   // Minimum core + adjacent for stats computation
const MAX_CANDIDATES_FOR_STATS = 20; // Maximum books to consider for stats
const MAX_BOOKS_TO_ENRICH = 15;  // Maximum books to enrich with product lookups

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

// NOTE: RainforestRankEntry and RainforestBook are now imported from amazonClient.ts

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

// NOTE: demoMode is now imported from amazonClient.ts

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

// NOTE: generateFriendlyGenreLabel and computeEffectiveRank are now imported from validatorService.ts and amazonClient.ts

// NOTE: generateDemoBooks is now imported from amazonClient.ts

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

// NOTE: extractSubcategoryLabel, chooseBestRankFromBestsellers, filterToBooksOnly,
// fetchProductBSR, enrichBookWithProductDetails, batchEnrichBooks, applyEnrichmentToBooks
// are now imported from amazonClient.ts


// NOTE: ProductEnrichmentData, fetchProductBSR, enrichBookWithProductDetails, batchEnrichBooks,
// and applyEnrichmentToBooks are now imported from amazonClient.ts

function hasUsableRank(book: NormalizedBook): boolean {
  const rank = book.effectiveRank ?? book.rank ?? book.rawRank;
  return typeof rank === "number" && rank > 0 && rank < 900_000;
}

/**
 * Dynamic bucket assignment with relaxing thresholds.
 * Ensures we get at least MIN_CORE_BOOKS and MIN_TOTAL_FOR_STATS when possible.
 * 
 * Strategy:
 * 1. Start with strict thresholds (0.70 for core, 0.50 for adjacent)
 * 2. If we don't meet minimums, relax thresholds in steps
 * 3. Only include books with usable rank data or decent relevance scores
 */
interface DynamicBucketResult {
  coreBooks: NormalizedBook[];
  adjacentBooks: NormalizedBook[];
  outOfNicheBooks: NormalizedBook[];
  thresholdsUsed: {
    coreThreshold: number;
    adjacentThreshold: number;
    wasRelaxed: boolean;
  };
}

function assignBooksWithDynamicThresholds(
  scoredBooks: NormalizedBook[],
  minCore: number = MIN_CORE_BOOKS,
  minTotal: number = MIN_TOTAL_FOR_STATS
): DynamicBucketResult {
  // Sort books by finalRelevanceScore descending
  const sortedBooks = [...scoredBooks].sort((a, b) => {
    const scoreA = (a as any).finalRelevanceScore ?? a.semanticScore ?? 0;
    const scoreB = (b as any).finalRelevanceScore ?? b.semanticScore ?? 0;
    return scoreB - scoreA;
  });

  // Initial thresholds
  let coreThreshold = 0.70;
  let adjacentThreshold = 0.50;
  const relaxStep = 0.05;
  const minThreshold = 0.15; // Absolute minimum to be considered relevant
  let wasRelaxed = false;

  // Helper to assign buckets with given thresholds
  const assignWithThresholds = (coreT: number, adjT: number) => {
    const core: NormalizedBook[] = [];
    const adjacent: NormalizedBook[] = [];
    const out: NormalizedBook[] = [];

    for (const book of sortedBooks) {
      const score = (book as any).finalRelevanceScore ?? book.semanticScore ?? 0;
      
      if (score >= coreT) {
        core.push({ ...book, relevanceBucket: "core" as any });
      } else if (score >= adjT) {
        adjacent.push({ ...book, relevanceBucket: "adjacent" as any });
      } else {
        out.push({ ...book, relevanceBucket: "out_of_niche" as any });
      }
    }

    return { core, adjacent, out };
  };

  // First pass with strict thresholds
  let { core, adjacent, out } = assignWithThresholds(coreThreshold, adjacentThreshold);

  // Relax thresholds if we don't meet minimums
  while (
    (core.length < minCore || core.length + adjacent.length < minTotal) &&
    adjacentThreshold > minThreshold
  ) {
    wasRelaxed = true;
    
    // Relax adjacent threshold first
    if (core.length + adjacent.length < minTotal && adjacentThreshold > minThreshold) {
      adjacentThreshold = Math.max(minThreshold, adjacentThreshold - relaxStep);
    }
    
    // Then relax core threshold if needed
    if (core.length < minCore && coreThreshold > adjacentThreshold + relaxStep) {
      coreThreshold = Math.max(adjacentThreshold + relaxStep, coreThreshold - relaxStep);
    }

    // Re-assign with new thresholds
    ({ core, adjacent, out } = assignWithThresholds(coreThreshold, adjacentThreshold));
  }

  // Final fallback: if still not enough, use top N regardless of score
  if (core.length === 0 && sortedBooks.length > 0) {
    const fallbackCount = Math.min(minCore, sortedBooks.length);
    core = sortedBooks.slice(0, fallbackCount).map(b => ({
      ...b,
      relevanceBucket: "core" as any,
    }));
    
    const remainingForAdjacent = Math.min(minTotal - core.length, sortedBooks.length - core.length);
    if (remainingForAdjacent > 0) {
      adjacent = sortedBooks.slice(core.length, core.length + remainingForAdjacent).map(b => ({
        ...b,
        relevanceBucket: "adjacent" as any,
      }));
    }
    
    out = sortedBooks.slice(core.length + adjacent.length).map(b => ({
      ...b,
      relevanceBucket: "out_of_niche" as any,
    }));
    
    wasRelaxed = true;
  }

  console.log("=== DYNAMIC THRESHOLD ASSIGNMENT ===");
  console.log({
    coreThreshold: coreThreshold.toFixed(2),
    adjacentThreshold: adjacentThreshold.toFixed(2),
    wasRelaxed,
    coreCount: core.length,
    adjacentCount: adjacent.length,
    outOfNicheCount: out.length,
  });

  return {
    coreBooks: core,
    adjacentBooks: adjacent,
    outOfNicheBooks: out,
    thresholdsUsed: {
      coreThreshold,
      adjacentThreshold,
      wasRelaxed,
    },
  };
}

// NOTE: buildBooksSearchUrl, filterBooksOnly, and fetchAmazonBooks are now imported from amazonClient.ts

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
  avgRating: number | null;  // null when no valid ratings available
  avgReviews: number | null; // null when no valid reviews available
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
  cheapBookShare: number | null;   // null when insufficient price data (< 3 books)
  premiumBookShare: number | null; // null when insufficient price data (< 3 books)
}

function computeBucketStats(books: NormalizedBook[]): BucketStats {
  if (books.length === 0) {
    return {
      totalBooks: 0,
      avgRating: null,
      avgReviews: null,
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

  // Filter to only include books with actual rating/review values (not null/undefined)
  // Ratings: must be > 0 (0 means no rating)
  // Reviews: can be 0 (meaning "no reviews yet" which is valid data)
  const validRatings = books.map((b) => b.rating).filter((r): r is number => typeof r === "number" && r > 0);
  const validReviews = books.map((b) => b.reviews).filter((r): r is number => typeof r === "number" && r >= 0);
  const pricesRaw = books.map((b) => b.price).filter((p): p is number => typeof p === "number" && p > 0);

  // Return null (not 0) when no valid data - missing data is different from zero
  const avgRating = validRatings.length > 0
    ? validRatings.reduce((sum, r) => sum + r, 0) / validRatings.length
    : null;
  const avgReviews = validReviews.length > 0
    ? validReviews.reduce((sum, r) => sum + r, 0) / validReviews.length
    : null;

  let priceMin: number | null = null;
  let priceMax: number | null = null;
  let priceMedian: number | null = null;
  let cheapBookShare: number | null = null;
  let premiumBookShare: number | null = null;

  // Require minimum 3 books with price data for reliable price statistics
  // Otherwise, a single data point could mislead pricing decisions
  const MIN_PRICE_SAMPLE = 3;
  if (pricesRaw.length >= MIN_PRICE_SAMPLE) {
    const sorted = [...pricesRaw].sort((a, b) => a - b);
    priceMin = sorted[0];
    priceMax = sorted[sorted.length - 1];
    priceMedian = sorted[Math.floor(sorted.length / 2)];
    cheapBookShare = pricesRaw.filter((p) => p <= 2.99).length / pricesRaw.length;
    premiumBookShare = pricesRaw.filter((p) => p >= 15).length / pricesRaw.length;
  }
  // Note: When pricesRaw.length < MIN_PRICE_SAMPLE, all price stats remain null

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
  
  // Improved evergreen detection:
  // 1. Classic signal: both recent AND old books exist (market has staying power + new entrants)
  // 2. NEW: High-review older books (1000+ reviews, 2+ years old) = proven evergreen title
  const classicEvergreen = recentCount > 0 && oldCount > 0;
  const highReviewOlderBooks = books.filter((b) => {
    const reviews = b.reviews ?? 0;
    const pubYear = b.publicationDate ? new Date(b.publicationDate).getFullYear() : null;
    return reviews >= 1000 && pubYear !== null && pubYear <= currentYear - 2;
  }).length;
  const evergreenSignal = classicEvergreen || highReviewOlderBooks > 0;

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
  
  // Count core books with valid BSR data (prefer effectiveRank, fallback to rank)
  const rankedCoreCount = coreBooks.filter(b => {
    const r = b.effectiveRank ?? b.rank;
    return typeof r === 'number' && r > 0 && r < 900_000;
  }).length;

  let signalStrength: MarketSignalSummary["signalStrength"];
  let dataSource: MarketSignalSummary["dataSource"];
  let explanation: string;

  // Factor in BOTH book count AND BSR quality when determining signal strength
  // "Strong" requires sufficient core books WITH valid rank data
  // Branch order matters: check rankedCoreCount === 0 BEFORE rankedCoreCount >= 1
  
  if (coreCount >= 6 && rankedCoreCount >= 3) {
    // Many comps with good BSR data = truly strong signal
    signalStrength = "strong";
    dataSource = "core";
    explanation = `Strong, well-defined niche with ${coreCount} direct competitors and ${rankedCoreCount} titles with measurable sales ranks.`;
  } else if (coreCount >= 5 && rankedCoreCount >= 2) {
    // Good comp count with some BSR data = moderate-to-strong
    signalStrength = "moderate";
    dataSource = "core";
    explanation = `Well-defined niche with ${coreCount} direct competitors and ${rankedCoreCount} with sales rank data.`;
  } else if (coreCount >= 4 && rankedCoreCount === 0) {
    // Several comps but NO BSR data = weak signal (emerging/underexplored)
    signalStrength = "weak";
    dataSource = "core";
    explanation = `${coreCount} direct competitors found but none have measurable sales ranks. This niche may be emerging or underexplored.`;
  } else if (coreCount >= 4 && rankedCoreCount >= 1) {
    // Several comps with thin BSR = moderate signal
    signalStrength = "moderate";
    dataSource = adjCount > 0 ? "combined" : "core";
    explanation = `${coreCount} direct competitors with limited sales rank data (${rankedCoreCount} ranked). Niche shows potential but demand is not fully validated.`;
  } else if (coreCount >= 2) {
    signalStrength = "moderate";
    dataSource = adjCount > 0 ? "combined" : "core";
    explanation = `Moderate signal from ${coreCount} core competitors${adjCount > 0 ? ` plus ${adjCount} adjacent titles` : ""}${rankedCoreCount > 0 ? ` (${rankedCoreCount} with sales data)` : " with thin sales data"}.`;
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
    // No working books - but check if we have adjacent data to report
    const hasAdjacentData = adjacentStats.totalBooks > 0 && adjacentStats.avgRating !== null && adjacentStats.avgRating > 0;
    
    let verdictReason: string;
    if (hasAdjacentData && adjacentStats.avgRating !== null) {
      verdictReason = `No direct competitors found for this exact keyword, but we found ${adjacentStats.totalBooks} adjacent title(s) with an average rating of ${adjacentStats.avgRating.toFixed(1)}★. This suggests the concept may fit into a broader space.`;
    } else {
      verdictReason = "No relevant books found — this niche may be untested or use different terminology on Amazon.";
    }
    
    return {
      totalBooks: 0,
      avgRating: hasAdjacentData ? adjacentStats.avgRating : null,
      avgReviews: hasAdjacentData ? adjacentStats.avgReviews : null,
      priceMin: hasAdjacentData ? adjacentStats.priceMin : null,
      priceMax: hasAdjacentData ? adjacentStats.priceMax : null,
      priceMedian: hasAdjacentData ? adjacentStats.priceMedian : null,
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
      verdict: hasAdjacentData ? "YELLOW" as const : "YELLOW" as const,
      verdictReason,
      demandLevel: hasAdjacentData && (adjacentStats.avgReviews ?? 0) >= 100 ? "MEDIUM" as const : "LOW" as const,
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

  // Only include books with actual ratings (not null/undefined/0) for avg calculation
  // Ratings: must be > 0 (0 means no rating data)
  // Reviews: can be 0 (meaning "no reviews yet" which is valid data point)
  const validRatings = books.map((b) => b.rating).filter((r): r is number => typeof r === "number" && r > 0);
  const validReviews = books.map((b) => b.reviews).filter((r): r is number => typeof r === "number" && r >= 0);

  const pricesRaw = books
    .map((b) => b.price)
    .filter((p): p is number => typeof p === "number" && p > 0);

  // Use valid ratings only, fallback to adjacent stats if no valid ratings in working set
  // Return null (not 0) when no data available - 0 is misleading
  let avgRating: number | null = validRatings.length > 0
    ? validRatings.reduce((sum, r) => sum + r, 0) / validRatings.length
    : (adjacentStats.avgRating !== null && adjacentStats.avgRating > 0 ? adjacentStats.avgRating : null);
  
  const avgReviews: number | null = validReviews.length > 0
    ? validReviews.reduce((sum, r) => sum + r, 0) / validReviews.length
    : (adjacentStats.avgReviews !== null && adjacentStats.avgReviews > 0 ? adjacentStats.avgReviews : null);

  let priceMin: number | null = null;
  let priceMax: number | null = null;
  let priceMedian: number | null = null;
  let cheapBookShare: number | null = null;
  let premiumBookShare: number | null = null;

  // Require minimum 3 books with price data for reliable price statistics
  // Otherwise, a single data point could mislead pricing decisions
  const MIN_PRICE_SAMPLE = 3;
  if (pricesRaw.length >= MIN_PRICE_SAMPLE) {
    const sorted = [...pricesRaw].sort((a, b) => a - b);
    priceMin = sorted[0];
    priceMax = sorted[sorted.length - 1];
    priceMedian = sorted[Math.floor(sorted.length / 2)];

    cheapBookShare =
      pricesRaw.filter((p) => p <= 2.99).length / pricesRaw.length;
    premiumBookShare =
      pricesRaw.filter((p) => p >= 15).length / pricesRaw.length;
  }
  // Note: When pricesRaw.length < MIN_PRICE_SAMPLE, all price stats remain null

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
  
  // Improved evergreen detection:
  // 1. Classic signal: both recent AND old books exist (market has staying power + new entrants)
  // 2. NEW: High-review older books (1000+ reviews, 2+ years old) = proven evergreen title
  const classicEvergreen = recentCount > 0 && oldCount > 0;
  const highReviewOlderBooks = books.filter((b) => {
    const reviews = b.reviews ?? 0;
    if (!b.publicationDate) return false;
    const pubYear = new Date(b.publicationDate).getFullYear();
    return reviews >= 1000 && !isNaN(pubYear) && pubYear <= currentYear - 2;
  }).length;
  const evergreenSignal = classicEvergreen || highReviewOlderBooks > 0;

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

  // Determine if data is thin/lightly validated BEFORE verdict selection
  const isLightlyValidatedData = coreStats.totalBooks < 5 || 
    (coreStats.totalBooks > 0 && coreStats.lowReviewBooks / coreStats.totalBooks > 0.66);

  if (demandLevel === "HIGH") {
    if (competitionLevel === "HIGH") {
      verdict = "YELLOW";
      verdictReason = isLightlyValidatedData
        ? "Promising demand signals with competition. Data is thin, so differentiation may be easier than expected."
        : "High demand but saturated with strong competitors. Differentiation is key.";
    } else {
      verdict = "GREEN";
      verdictReason = isLightlyValidatedData
        ? "Promising demand signals with manageable competition. Lightly validated - good pioneer opportunity."
        : "Strong demand with manageable competition. Good opportunity.";
    }
  } else if (demandLevel === "MEDIUM") {
    if (competitionLevel === "LOW") {
      verdict = "GREEN";
      verdictReason = isLightlyValidatedData
        ? "Emerging demand with low competition. Lightly validated niche with room to pioneer."
        : "Moderate demand with low competition. Room to establish yourself.";
    } else if (competitionLevel === "MEDIUM") {
      verdict = "YELLOW";
      verdictReason = isLightlyValidatedData
        ? "Emerging demand with moderate competition. Data is thin, but positioning matters."
        : "Moderate demand and competition. Success requires strong positioning.";
    } else {
      verdict = "RED";
      verdictReason = isLightlyValidatedData
        ? "Thin demand signals with established competition. May be difficult to break through."
        : "Moderate demand but heavy competition. Hard to break through.";
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
        "Low demand but also low competition. Niche may be too small or underexplored.";
    } else {
      verdict = "RED";
      verdictReason =
        "Low demand with existing competition. Not recommended.";
    }
  }

  // === VERDICT GUARDRAILS: Prevent overly optimistic verdicts with thin data ===
  
  // Guardrail 1: Cap at YELLOW when core books < 5
  if (verdict === "GREEN" && coreStats.totalBooks < 5) {
    console.log(`⚠️ VERDICT GUARDRAIL: Downgrading GREEN → YELLOW (only ${coreStats.totalBooks} core books)`);
    verdict = "YELLOW";
    // Reason already uses lightly validated language from isLightlyValidatedData check above
  }
  
  // Guardrail 2: Cap at YELLOW when signal strength is sparse
  if (verdict === "GREEN" && marketSignal.signalStrength === "sparse") {
    console.log(`⚠️ VERDICT GUARDRAIL: Downgrading GREEN → YELLOW (sparse market signal)`);
    verdict = "YELLOW";
    // Reason already uses lightly validated language from isLightlyValidatedData check above
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
        const result = await runBookMarketValidation(req.body, req.userId);
        return res.json(result);
      } catch (error: any) {
        console.error("Validation error:", error);
        if (error.response?.status === 402 || error.message?.includes("402")) {
          return res.status(503).json({
            error: "API quota exceeded",
            details: "The Amazon data service has reached its usage limit."
          });
        }
        return res.status(500).json({
          error: "Failed to validate book idea",
          details: error.message || "Unknown error"
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