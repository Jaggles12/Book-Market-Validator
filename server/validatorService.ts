// server/validatorService.ts
// Book Market Validation service - extracted from routes.ts

import OpenAI from "openai";
import { storage } from "./storage";
import {
  NormalizedBook,
  NicheProfile,
  AudienceProfile,
  CanonicalNiche,
  InferredGenre,
} from "./types";
import { getAudienceProfile } from "./audience";
import { normalizeSearchTerms } from "./keywordNormalizer";
import {
  deriveCanonicalNiche,
  computeSearchResultPurity,
  scoreCategoryAlignment,
} from "./canonicalNiche";
import { scoreBooksForNiche, BookForRelevance } from "./relevance";
import {
  inferGenreFromBooks,
  generateFriendlyGenreLabelFromInferred,
} from "./genreInference";
import { amazonClient } from "./amazon";

// Destructure from the provider-agnostic amazon client
const {
  fetchAmazonBooks,
  computeEffectiveRank,
  batchEnrichBooks,
  applyEnrichmentToBooks,
} = amazonClient;

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -----------------------------
// Constants
// -----------------------------

const MIN_CORE_BOOKS = 3;
const MIN_TOTAL_FOR_STATS = 5;
const MAX_BOOKS_TO_ENRICH = 15;

// -----------------------------
// Type definitions
// -----------------------------

type GenreCategory = "fiction" | "nonfiction";

interface GenreInfo {
  category: GenreCategory;
  subtype: string;
}

interface TitleIdea {
  title: string;
  subtitle: string;
  hook: string;
}

interface BookBlueprint {
  working_title?: string;
  subtitle?: string;
  logline?: string;
  core_promise?: string;
  ideal_reader?: string;
  differentiation?: string;
  format?: string;
  constraints?: {
    word_count_target?: number;
    reading_level?: string;
    timeframe?: string;
  };
  structure?: {
    overview?: string;
    sections?: Array<{
      title: string;
      description: string;
      chapters?: Array<{
        title: string;
        purpose: string;
        notes: string;
      }>;
    }>;
  };
  fiveBeatStructure?: {
    setup?: string;
    disruption?: string;
    risingComplications?: string;
    climax?: string;
    resolution?: string;
  };
  openingCatalystPrompt?: string;
  voice_and_style?: string;
  comparable_titles?: string;
  positioning_notes?: string;
  primary_keywords?: string[];
  whitespace_keywords?: string[];
}

interface FullNicheAnalysis {
  suggestions: string[];
  nicheOpportunities: { intro: string; items: string[] };
  formatGaps: string[];
  idealReader: {
    demographics: string;
    psychographics: string;
    painPoints: string[];
    desiredOutcome: string;
    emotionalTrigger: string;
    emotionalPayoff: string;
  };
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

interface BucketStats {
  totalBooks: number;
  avgRating: number | null;
  avgReviews: number | null;
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
  cheapBookShare: number | null;
  premiumBookShare: number | null;
}

interface MarketSignalSummary {
  coreBookCount: number;
  adjacentBookCount: number;
  totalBookCount: number;
  signalStrength: "strong" | "moderate" | "weak" | "sparse";
  dataSource: "core" | "adjacent" | "combined" | "insufficient";
  explanation: string;
}

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

// -----------------------------
// Helper functions
// -----------------------------

function toTitleCaseLabel(raw: string): string {
  return raw
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function generateFriendlyGenreLabel(
  searchTerm: string | null,
  genre: GenreInfo,
  originalIdea: string
): string {
  const niche = (searchTerm ?? "").trim();
  if (niche.length > 3) {
    return toTitleCaseLabel(niche);
  }

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

    return subtypeLabel;
  }

  if (genre.category === "fiction") return "Fiction (General)";
  if (genre.category === "nonfiction") return "Nonfiction (General)";

  const idea = (originalIdea ?? "").trim();
  if (idea.length > 0) {
    return toTitleCaseLabel(idea);
  }

  return "General";
}

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

    return { category: "fiction", subtype: "general" };
  }

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

  return { category: "nonfiction", subtype: "general" };
}

// detectGenre alias for inferGenreFromSearchTerm (fixes missing function reference)
const detectGenre = inferGenreFromSearchTerm;

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

async function extractNicheProfile(
  idea: string,
  uiCategory: "fiction" | "nonfiction",
  audience: AudienceProfile
): Promise<{ nicheProfile: NicheProfile; isExtracted: boolean }> {
  const { niche: searchTermRaw, isExtracted } = await extractNicheFromIdea(idea);

  const searchTerm = (searchTermRaw || idea).trim();

  const rawNiche: NicheProfile = {
    rawIdea: idea,
    searchTerm,
    category: uiCategory,
    inferredAudience: audience,
    subtype: "",
    topic: "",
    hook: null,
  } as NicheProfile;

  return {
    nicheProfile: rawNiche,
    isExtracted,
  };
}

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

function hasUsableRank(book: NormalizedBook): boolean {
  const rank = book.effectiveRank ?? book.rank ?? book.rawRank;
  return typeof rank === "number" && rank > 0 && rank < 900_000;
}

function assignBooksWithDynamicThresholds(
  scoredBooks: NormalizedBook[],
  minCore: number = MIN_CORE_BOOKS,
  minTotal: number = MIN_TOTAL_FOR_STATS
): DynamicBucketResult {
  const sortedBooks = [...scoredBooks].sort((a, b) => {
    const scoreA = (a as any).finalRelevanceScore ?? a.semanticScore ?? 0;
    const scoreB = (b as any).finalRelevanceScore ?? b.semanticScore ?? 0;
    return scoreB - scoreA;
  });

  let coreThreshold = 0.70;
  let adjacentThreshold = 0.50;
  const relaxStep = 0.05;
  const minThreshold = 0.15;
  let wasRelaxed = false;

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

  let { core, adjacent, out } = assignWithThresholds(coreThreshold, adjacentThreshold);

  while (
    (core.length < minCore || core.length + adjacent.length < minTotal) &&
    adjacentThreshold > minThreshold
  ) {
    wasRelaxed = true;
    
    if (core.length + adjacent.length < minTotal && adjacentThreshold > minThreshold) {
      adjacentThreshold = Math.max(minThreshold, adjacentThreshold - relaxStep);
    }
    
    if (core.length < minCore && coreThreshold > adjacentThreshold + relaxStep) {
      coreThreshold = Math.max(adjacentThreshold + relaxStep, coreThreshold - relaxStep);
    }

    ({ core, adjacent, out } = assignWithThresholds(coreThreshold, adjacentThreshold));
  }

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

  const validRatings = books.map((b) => b.rating).filter((r): r is number => typeof r === "number" && r > 0);
  const validReviews = books.map((b) => b.reviews).filter((r): r is number => typeof r === "number" && r >= 0);
  const pricesRaw = books.map((b) => b.price).filter((p): p is number => typeof p === "number" && p > 0);

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

  const MIN_PRICE_SAMPLE = 3;
  if (pricesRaw.length >= MIN_PRICE_SAMPLE) {
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

function computeMarketSignalSummary(coreBooks: NormalizedBook[], adjacentBooks: NormalizedBook[]): MarketSignalSummary {
  const coreCount = coreBooks.length;
  const adjCount = adjacentBooks.length;
  const total = coreCount + adjCount;
  
  const rankedCoreCount = coreBooks.filter(b => {
    const r = b.effectiveRank ?? b.rank;
    return typeof r === 'number' && r > 0 && r < 900_000;
  }).length;

  let signalStrength: MarketSignalSummary["signalStrength"];
  let dataSource: MarketSignalSummary["dataSource"];
  let explanation: string;

  if (coreCount >= 6 && rankedCoreCount >= 3) {
    signalStrength = "strong";
    dataSource = "core";
    explanation = `Strong, well-defined niche with ${coreCount} direct competitors and ${rankedCoreCount} titles with measurable sales ranks.`;
  } else if (coreCount >= 5 && rankedCoreCount >= 2) {
    signalStrength = "moderate";
    dataSource = "core";
    explanation = `Well-defined niche with ${coreCount} direct competitors and ${rankedCoreCount} with sales rank data.`;
  } else if (coreCount >= 4 && rankedCoreCount === 0) {
    signalStrength = "weak";
    dataSource = "core";
    explanation = `${coreCount} direct competitors found but none have measurable sales ranks. This niche may be emerging or underexplored.`;
  } else if (coreCount >= 4 && rankedCoreCount >= 1) {
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
  const core = coreBooks || books.filter((b) => b.relevanceBucket === "core");
  const adjacent = adjacentBooks || books.filter((b) => b.relevanceBucket === "adjacent");
  const marketSignal = computeMarketSignalSummary(core, adjacent);

  const coreStats = computeBucketStats(core);
  const adjacentStats = computeBucketStats(adjacent);

  const rankedBooks = books
    .map((b) => {
      const effectiveRank = b.effectiveRank ?? computeEffectiveRank(b);
      return { ...b, effectiveRank, rank: effectiveRank };
    })
    .filter((b) => typeof b.effectiveRank === "number")
    .sort((a, b) => a.effectiveRank! - b.effectiveRank!)
    .slice(0, 10);

  const bsrBuckets = {
    veryStrong: rankedBooks.filter((b) => b.effectiveRank! <= 10_000).length,
    strong: rankedBooks.filter((b) => b.effectiveRank! > 10_000 && b.effectiveRank! <= 100_000).length,
    moderate: rankedBooks.filter((b) => b.effectiveRank! > 100_000 && b.effectiveRank! <= 300_000).length,
    weak: rankedBooks.filter((b) => b.effectiveRank! > 300_000).length,
  };

  let demandLevel: "HIGH" | "MEDIUM" | "LOW";
  if (bsrBuckets.veryStrong > 0 || bsrBuckets.strong >= 2) {
    demandLevel = "HIGH";
  } else if (bsrBuckets.strong >= 1 || bsrBuckets.moderate >= 2) {
    demandLevel = "MEDIUM";
  } else {
    demandLevel = "LOW";
  }

  const validRatings = books.map((b) => b.rating).filter((r): r is number => typeof r === "number" && r > 0);
  const validReviews = books.map((b) => b.reviews).filter((r): r is number => typeof r === "number" && r >= 0);
  const pricesRaw = books.map((b) => b.price).filter((p): p is number => typeof p === "number" && p > 0);

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

  const hasStrongAdjacent = marketSignal.adjacentBookCount >= 3 && adjacentStats.avgReviews !== null && adjacentStats.avgReviews >= 100;
  const hasAnyAdjacent = marketSignal.adjacentBookCount >= 1;
  const isSparseCore = marketSignal.coreBookCount < 3;

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
    if (isSparseCore && hasStrongAdjacent) {
      verdict = "YELLOW";
      verdictReason = `Limited direct competitors, but strong adjacent titles (${marketSignal.adjacentBookCount} books) suggest audience demand exists. This may be a whitespace opportunity.`;
    } else if (isSparseCore && hasAnyAdjacent) {
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

  if (verdict === "GREEN" && coreStats.totalBooks < 5) {
    console.log(`⚠️ VERDICT GUARDRAIL: Downgrading GREEN → YELLOW (only ${coreStats.totalBooks} core books)`);
    verdict = "YELLOW";
  }
  
  if (verdict === "GREEN" && marketSignal.signalStrength === "sparse") {
    console.log(`⚠️ VERDICT GUARDRAIL: Downgrading GREEN → YELLOW (sparse market signal)`);
    verdict = "YELLOW";
  }

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
// Main validation function
// -----------------------------

export async function runBookMarketValidation(body: any, userId?: string): Promise<any> {
  const {
    idea,
    projectType,
    genreCategory,
    bookType,
    genreSubtype,
  } = body as {
    idea?: string;
    projectType?: string;
    genreCategory?: string;
    bookType?: string;
    genreSubtype?: string;
  };

  if (!idea || typeof idea !== "string" || !idea.trim()) {
    throw new Error("Book idea is required.");
  }

  const uiCategory: "fiction" | "nonfiction" =
    projectType === "fiction" || genreCategory === "fiction"
      ? "fiction"
      : "nonfiction";

  const audience = getAudienceProfile(idea, uiCategory);
  console.log("AUDIENCE PROFILE:", audience);

  const uiCategoryRaw = (genreCategory || projectType || bookType || "")
    .toString()
    .trim()
    .toLowerCase();

  if (uiCategoryRaw !== "fiction" && uiCategoryRaw !== "nonfiction") {
    throw new Error(
      "Genre selection required: projectType or genreCategory must be 'fiction' or 'nonfiction'."
    );
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

  const normalizedTerms = await normalizeSearchTerms(openai, idea, lockedCategory);
  console.log("=== NORMALIZED SEARCH TERMS ===", {
    canonicalGenre: normalizedTerms.canonicalGenre,
    primarySearch: normalizedTerms.primarySearch,
    fallbackSearches: normalizedTerms.fallbackSearches,
    keywordTokens: normalizedTerms.keywordTokens,
  });

  const canonicalNiche = deriveCanonicalNiche(idea, nicheProfile, audience);
  console.log("=== CANONICAL NICHE ANCHOR ===", {
    expectedGenre: canonicalNiche.expectedGenre,
    expectedDomains: canonicalNiche.expectedDomains,
    worldview: canonicalNiche.worldview,
    category: canonicalNiche.category,
    validCategories: canonicalNiche.validAmazonCategories.slice(0, 5),
    invalidCategories: canonicalNiche.invalidCategories.slice(0, 5),
  });

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

    return {
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
    };
  }

  const booksForRelevance: BookForRelevance[] = books.map((b) => ({
    title: b.title,
    categories: b.rawCategories ?? [],
  }));

  const relevance = await scoreBooksForNiche(
    openai,
    searchTerm,
    booksForRelevance,
    {
      boostKeywords: normalizedTerms.keywordTokens,
      useAdaptiveThresholds: false,
    }
  );

  const scoredBooks: NormalizedBook[] = books.map((b, idx) => ({
    ...b,
    semanticScore: relevance[idx]?.semanticScore ?? 0,
    finalRelevanceScore: relevance[idx]?.finalScore ?? 0,
  }));

  const sortedByRelevance = [...scoredBooks].sort((a, b) => {
    const scoreA = (a as any).finalRelevanceScore ?? 0;
    const scoreB = (b as any).finalRelevanceScore ?? 0;
    return scoreB - scoreA;
  });

  console.log("=== RELEVANCE SCORING COMPLETE ===");
  console.log(`Scored ${sortedByRelevance.length} books`);
  console.log("Top 5 by relevance:", sortedByRelevance.slice(0, 5).map(b => ({
    title: b.title.substring(0, 40),
    score: ((b as any).finalRelevanceScore ?? 0).toFixed(3),
  })));

  const purityCheck = computeSearchResultPurity(
    sortedByRelevance.map(b => ({
      amazonCategoryPaths: b.amazonCategoryPaths,
      semanticScore: b.semanticScore,
      relevanceBucket: b.relevanceBucket,
    })),
    canonicalNiche
  );
  
  console.log("=== CATEGORY PURITY CHECK ===", {
    categoryPurity: purityCheck.categoryPurity.toFixed(3),
    domainAlignment: purityCheck.domainAlignment.toFixed(3),
    coreCount: purityCheck.coreCount,
    driftBooks: purityCheck.driftBooks,
    isDrifted: purityCheck.driftBooks > sortedByRelevance.length * 0.3,
  });

  const filteredByPurity = sortedByRelevance.filter(book => {
    if (!book.amazonCategoryPaths || book.amazonCategoryPaths.length === 0) {
      return true;
    }
    
    let hasValidCategory = false;
    let hasInvalidCategory = false;
    
    for (const path of book.amazonCategoryPaths) {
      const alignment = scoreCategoryAlignment(path, canonicalNiche);
      if (alignment.isDrift) {
        hasInvalidCategory = true;
      }
      if (alignment.score >= 0.5) {
        hasValidCategory = true;
      }
    }
    
    if (hasInvalidCategory && !hasValidCategory) {
      console.log(`🚫 Dropping drifted book: "${book.title.substring(0, 40)}..."`);
      return false;
    }
    return true;
  });
  
  console.log(`=== CATEGORY ENFORCEMENT ===`);
  console.log(`Before filter: ${sortedByRelevance.length} books`);
  console.log(`After filter: ${filteredByPurity.length} books`);
  console.log(`Dropped: ${sortedByRelevance.length - filteredByPurity.length} drifted books`);

  const booksForBuckets = filteredByPurity.length >= 5 ? filteredByPurity : sortedByRelevance;

  const { coreBooks, adjacentBooks, outOfNicheBooks, thresholdsUsed } = 
    assignBooksWithDynamicThresholds(booksForBuckets, MIN_CORE_BOOKS, MIN_TOTAL_FOR_STATS);

  const totalComps = coreBooks.length + adjacentBooks.length;
  let usedFallback = false;
  let fallbackAttempts = 0;
  let currentCoreBooks = coreBooks;
  let currentAdjacentBooks = adjacentBooks;
  let currentOutOfNicheBooks = outOfNicheBooks;

  if (totalComps < MIN_TOTAL_FOR_STATS && normalizedTerms.fallbackSearches.length > 0) {
    console.log(`=== TRYING FALLBACK SEARCHES (only ${totalComps} comps) ===`);
    
    for (const fallbackTerm of normalizedTerms.fallbackSearches) {
      fallbackAttempts++;
      console.log(`Fallback attempt ${fallbackAttempts}: "${fallbackTerm}"`);
      
      const { books: fallbackRawBooks } = await fetchAmazonBooks(fallbackTerm);
      if (!fallbackRawBooks || fallbackRawBooks.length === 0) continue;

      const fallbackBooks: NormalizedBook[] = fallbackRawBooks.map((b) => ({
        ...b,
        effectiveRank: computeEffectiveRank(b),
        rank: computeEffectiveRank(b),
        rankSource: typeof b.rawRank === "number" && b.rawRank > 0 && b.rawRank < 900_000
          ? "bestseller" : "heuristic",
      }));

      const fallbackForRelevance: BookForRelevance[] = fallbackBooks.map((b) => ({
        title: b.title,
        categories: b.rawCategories ?? [],
      }));

      const fallbackRelevance = await scoreBooksForNiche(
        openai,
        idea,
        fallbackForRelevance,
        { boostKeywords: normalizedTerms.keywordTokens, useAdaptiveThresholds: false }
      );

      const scoredFallback: NormalizedBook[] = fallbackBooks.map((b, idx) => ({
        ...b,
        semanticScore: fallbackRelevance[idx]?.semanticScore ?? 0,
        finalRelevanceScore: fallbackRelevance[idx]?.finalScore ?? 0,
      }));

      const existingAsins = new Set(sortedByRelevance.map(b => b.asin).filter(Boolean));
      const newBooks = scoredFallback.filter(b => b.asin && !existingAsins.has(b.asin));
      
      if (newBooks.length > 0) {
        const mergedBooks = [...sortedByRelevance, ...newBooks].sort((a, b) => {
          const scoreA = (a as any).finalRelevanceScore ?? 0;
          const scoreB = (b as any).finalRelevanceScore ?? 0;
          return scoreB - scoreA;
        });

        const newBuckets = assignBooksWithDynamicThresholds(
          mergedBooks, MIN_CORE_BOOKS, MIN_TOTAL_FOR_STATS
        );

        const newTotal = newBuckets.coreBooks.length + newBuckets.adjacentBooks.length;
        if (newTotal > totalComps) {
          currentCoreBooks = newBuckets.coreBooks;
          currentAdjacentBooks = newBuckets.adjacentBooks;
          currentOutOfNicheBooks = newBuckets.outOfNicheBooks;
          usedFallback = true;
          console.log(`Fallback improved: ${totalComps} → ${newTotal} comps`);
        }

        if (newTotal >= MIN_TOTAL_FOR_STATS) {
          console.log(`Fallback success: reached ${newTotal} comps`);
          break;
        }
      }
    }
  }

  const workingBooks = currentCoreBooks;
  const displayBooks = [...currentCoreBooks, ...currentAdjacentBooks];

  console.log("=== FINAL BUCKET DISTRIBUTION ===");
  console.log({
    coreBooks: currentCoreBooks.length,
    adjacentBooks: currentAdjacentBooks.length,
    outOfNicheBooks: currentOutOfNicheBooks.length,
    usedForStats: workingBooks.length,
    usedFallback,
    fallbackAttempts,
  });

  const booksToEnrich = displayBooks
    .sort((a, b) => {
      const scoreA = (a as any).finalRelevanceScore ?? 0;
      const scoreB = (b as any).finalRelevanceScore ?? 0;
      return scoreB - scoreA;
    })
    .slice(0, MAX_BOOKS_TO_ENRICH);
  
  const enrichmentMap = await batchEnrichBooks(booksToEnrich, MAX_BOOKS_TO_ENRICH);
  
  const enrichedCoreBooks = applyEnrichmentToBooks(currentCoreBooks, enrichmentMap);
  const enrichedAdjacentBooks = applyEnrichmentToBooks(currentAdjacentBooks, enrichmentMap);
  const enrichedDisplayBooks = [...enrichedCoreBooks, ...enrichedAdjacentBooks];
  
  const useUnifiedPool = enrichedCoreBooks.length < MIN_CORE_BOOKS;
  const enrichedWorkingBooks = useUnifiedPool 
    ? enrichedDisplayBooks
    : enrichedCoreBooks;

  console.log("=== ENRICHMENT SUMMARY ===");
  const enrichedCount = enrichedDisplayBooks.filter(b => b.isEnriched).length;
  const withCategoryCount = enrichedDisplayBooks.filter(b => b.categoriesFlat).length;
  console.log(`Enriched ${enrichedCount}/${enrichedDisplayBooks.length} books, ${withCategoryCount} have category paths`);
  console.log(`Using ${useUnifiedPool ? "UNIFIED (core+adjacent)" : "CORE-ONLY"} pool for stats (${enrichedWorkingBooks.length} books)`);

  const rankedCandidates = enrichedWorkingBooks
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
    relevanceBucket: b.relevanceBucket ?? "unknown",
  }));

  const adjacentRankedCandidates = enrichedAdjacentBooks
    .filter(
      (b) =>
        typeof b.effectiveRank === "number" &&
        b.effectiveRank > 0 &&
        b.effectiveRank < 900_000
    )
    .sort((a, b) => a.effectiveRank! - b.effectiveRank!);

  const adjacentSalesLeaders = adjacentRankedCandidates.slice(0, 3).map((b) => ({
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

  const analysis = computeMarketSnapshot(enrichedWorkingBooks, genre, enrichedCoreBooks, enrichedAdjacentBooks);

  let inferredGenre = inferGenreFromBooks(enrichedDisplayBooks, genre.category, canonicalNiche);
  const inferredGenreLabel = generateFriendlyGenreLabelFromInferred(inferredGenre);
  
  console.log("=== GENRE INFERENCE DEBUG ===");
  console.log("Inferred genre (after path filtering):", {
    category: inferredGenre.category,
    shelf: inferredGenre.shelf,
    subgenre: inferredGenre.subgenre,
    microgenre: inferredGenre.microgenre,
    primaryPath: inferredGenre.amazonPrimaryPath,
    alternatePaths: inferredGenre.amazonAlternatePaths,
  });

  const inferredPath = inferredGenre.amazonPrimaryPath || `${inferredGenre.shelf} > ${inferredGenre.subgenre}`;
  const categoryCheck = scoreCategoryAlignment(inferredPath, canonicalNiche);
  
  if (categoryCheck.isDrift) {
    console.warn(
      `⚠️ GENRE DRIFT BLOCKED: Amazon inferred "${inferredGenre.shelf} > ${inferredGenre.subgenre}" ` +
      `but this conflicts with the canonical niche "${canonicalNiche.expectedGenre}". ` +
      `Reason: ${categoryCheck.reason}. Falling back to canonical niche.`
    );
    
    inferredGenre = {
      ...inferredGenre,
      shelf: canonicalNiche.expectedGenre,
      subgenre: canonicalNiche.expectedDomains[0] || "General",
      microgenre: null,
    };
    
    console.log("Inferred genre (after anchor correction):", {
      shelf: inferredGenre.shelf,
      subgenre: inferredGenre.subgenre,
    });
  } else {
    console.log(`✅ Genre alignment OK: purity score ${categoryCheck.score.toFixed(2)}`);
  }

  const extractSpecificNiche = (path: string | null | undefined): string | null => {
    if (!path) return null;
    if (path.toLowerCase().includes("kindle")) return null;
    const segments = path.split(">").map(s => s.trim());
    const lastSegment = segments[segments.length - 1];
    if (["Books", "Literature & Fiction", "Genre Fiction", "Nonfiction", "eBooks"].includes(lastSegment)) {
      return segments.length > 1 ? segments[segments.length - 2] : null;
    }
    return lastSegment || null;
  };
  
  let specificNiche = inferredGenre.microgenre || 
                     inferredGenre.subgenre || 
                     extractSpecificNiche(inferredGenre.amazonPrimaryPath);
  
  if (specificNiche) {
    specificNiche = specificNiche.split(/[\s-]+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }
  
  let friendlyGenreLabel = specificNiche || inferredGenreLabel || generateFriendlyGenreLabel(
    searchTerm,
    genre,
    idea
  );
  let displayGenreLabel = friendlyGenreLabel;
  
  if (displayGenreLabel.includes("General")) {
    const searchTermLower = searchTerm.toLowerCase();
    if (searchTermLower.includes("thriller")) {
      const modifiers: string[] = [];
      if (searchTermLower.includes("psychological")) modifiers.push("Psychological");
      if (searchTermLower.includes("domestic")) modifiers.push("Domestic");
      if (searchTermLower.includes("southern")) modifiers.push("Southern");
      if (searchTermLower.includes("small-town") || searchTermLower.includes("small town")) modifiers.push("Small-Town");
      const base = modifiers.length > 0 ? `${modifiers.join(" ")} Thriller` : "Thriller";
      displayGenreLabel = base;
      friendlyGenreLabel = base;
    } else if (searchTermLower.includes("mystery")) {
      displayGenreLabel = "Mystery";
      friendlyGenreLabel = "Mystery";
    } else if (searchTermLower.includes("romance")) {
      displayGenreLabel = "Romance";
      friendlyGenreLabel = "Romance";
    } else if (searchTermLower.includes("self-help") || searchTermLower.includes("self help")) {
      displayGenreLabel = "Self-Help";
      friendlyGenreLabel = "Self-Help";
    } else if (searchTermLower.includes("personal finance")) {
      displayGenreLabel = "Personal Finance";
      friendlyGenreLabel = "Personal Finance";
    }
  }

  const normalizedGenre = {
    category: genre.category,
    subtype: inferredGenre.subgenre || genre.subtype || "general",
    label: displayGenreLabel,
    friendlyLabel: friendlyGenreLabel,
    shelf: inferredGenre.shelf,
    subgenre: inferredGenre.subgenre,
    microgenre: inferredGenre.microgenre,
    amazonPrimaryPath: inferredGenre.amazonPrimaryPath,
    amazonAlternatePaths: inferredGenre.amazonAlternatePaths,
  };

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

  const uiBooks = enrichedDisplayBooks.slice(0, 15).map((b) => ({
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

  const categoryFrequency: Record<string, number> = {};
  for (const b of enrichedDisplayBooks) {
    if (b.rankCategory && (b.rank || b.effectiveRank)) {
      categoryFrequency[b.rankCategory] = (categoryFrequency[b.rankCategory] || 0) + 1;
    }
  }
  const topRankCategories = Object.entries(categoryFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  const coreBookCount = analysis.coreStats?.totalBooks ?? 0;
  const lowReviewBooksStat = analysis.coreStats?.lowReviewBooks ?? 0;
  const lowReviewRatio = coreBookCount > 0 ? lowReviewBooksStat / coreBookCount : 0;
  const isLightlyValidated = coreBookCount < 5 || lowReviewRatio > 0.66;
  const isSparseData = analysis.marketSignal?.signalStrength === "sparse";
  
  let demandDescription: string;
  if (isLightlyValidated || isSparseData) {
    demandDescription = demandLevelPretty === "High"
      ? "promising demand signals (though lightly validated)"
      : demandLevelPretty === "Medium"
      ? "emerging demand with room to pioneer"
      : "experimental or underexplored demand";
  } else {
    demandDescription = demandLevelPretty === "High"
      ? "strong reader demand"
      : demandLevelPretty === "Medium"
      ? "solid, proven demand"
      : "more experimental or emerging demand";
  }

  const competitionDescription =
    competitionLevelPretty === "High"
      ? "heavy competition from established titles"
      : competitionLevelPretty === "Medium"
      ? "a mix of strong players and room for new voices"
      : "relatively low competition and room to stand out";

  let verdictReason: string;

  if (rankBand) {
    const rankedCount = salesLeaders.filter(b => typeof b.rank === 'number' && b.rank > 0 && b.rank < 900_000).length;
    const isSingleRank = rankedCount === 1 || rankBand.best === rankBand.worst;
    
    const rankLabel = "the overall Books store";
    
    if (isSingleRank) {
      verdictReason =
        `Top comparable title ranks around ${rankBand.bestFormatted} in ${rankLabel}, indicating ${demandDescription} ` +
        `with ${competitionDescription}.`;
    } else {
      verdictReason =
        `Top comparable titles rank from ${rankBand.bestFormatted} to ${rankBand.worstFormatted} in ${rankLabel}, indicating ${demandDescription} ` +
        `with ${competitionDescription}.`;
    }

    if (analysis.verdictReason) {
      verdictReason += ` ${analysis.verdictReason}`;
    }
  } else {
    verdictReason =
      analysis.verdictReason ||
      "We weren't able to calculate reliable bestseller ranks, but we estimated demand and competition from review counts and pricing patterns.";
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
      topRankCategories,
    },
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
    adjacentSalesLeaders: salesLeaders.length === 0 ? adjacentSalesLeaders : [],
  };

  let savedResultId: string | null = null;
  if (userId) {
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
  }

  console.log(
    "FULL VALIDATION JSON:",
    JSON.stringify({ ...responseData, savedResultId }, null, 2)
  );

  return { ...responseData, savedResultId };
}
