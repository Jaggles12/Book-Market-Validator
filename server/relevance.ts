// server/relevance.ts
import OpenAI from "openai";

// ------------------------------------
// Minimal book + scoring interfaces
// ------------------------------------

export interface BookForRelevance {
  title: string;
  categories?: string[]; // e.g. ["Gardening & Horticulture > Techniques"]
}

export type RelevanceBucket = "core" | "adjacent" | "out_of_niche";

export interface RelevanceScores {
  index: number;         // index of the book in the original array
  keywordScore: number;  // 0–1 based on token overlap with niche
  categoryScore: number; // 0–1 based on token overlap with niche
  semanticScore: number; // 0–1 from OpenAI
  finalScore: number;    // weighted combined score
  isRelevant: boolean;   // final decision (true = core or adjacent)
  bucket: RelevanceBucket; // core (>=0.70), adjacent (0.50-0.69), out_of_niche (<0.50)
}

export interface RelevanceOptions {
  // Thresholds for each signal
  minKeywordScore?: number;   // default 0.15
  minSemanticScore?: number;  // default 0.45
  minCategoryScore?: number;  // default 0 (categories can be noisy)

  // How many signals must pass their threshold (of keyword / semantic / category)
  minSignalsPassing?: number; // default 2

  // Weights for finalScore (for ordering/ranking, not strict gating)
  keywordWeight?: number;     // default 0.3
  semanticWeight?: number;    // default 0.5
  categoryWeight?: number;    // default 0.2
}

// ------------------------------------
// Helper: safely parse LLM JSON arrays
// ------------------------------------

function parseScoreArrayFromLLM(raw: string, expectedLength: number): number[] {
  let cleaned = (raw || "").trim();

  // Strip markdown code fences like ```json ... ```
  cleaned = cleaned
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // If there's any [ ... ] array inside, grab just that
  const match = cleaned.match(/\[[\s\S]*\]/);
  const jsonText = match ? match[0] : cleaned;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error(
      "Failed to parse semantic relevance JSON, using fallback scores.",
      {
        raw,
        jsonText,
        error,
      }
    );
    // Fallback: neutral scores so we don't crash the validator
    return new Array(expectedLength).fill(0.5);
  }

  if (!Array.isArray(parsed)) {
    console.error(
      "Semantic relevance JSON was not an array, using fallback scores.",
      { parsed }
    );
    return new Array(expectedLength).fill(0.5);
  }

  // Coerce to numbers, sanitize NaNs
  let scores = (parsed as unknown[]).map((v) => {
    const num = typeof v === "number" ? v : Number(v);
    return Number.isFinite(num) ? num : 0;
  });

  // Pad or trim to match book count
  if (scores.length < expectedLength) {
    scores = scores.concat(
      new Array(expectedLength - scores.length).fill(0)
    );
  } else if (scores.length > expectedLength) {
    scores = scores.slice(0, expectedLength);
  }

  return scores;
}

// ------------------------------------
// Tokenization + local scores
// ------------------------------------

/**
 * Simple tokenizer:
 * - lowercase
 * - split on non-alphanumeric
 * - drop stopwords and super-short tokens
 */
function tokenize(input: string): string[] {
  const text = (input || "").toLowerCase();
  const rawTokens = text.split(/[^a-z0-9]+/gi).filter(Boolean);

  const stopwords = new Set([
    "the",
    "and",
    "a",
    "an",
    "of",
    "for",
    "to",
    "in",
    "on",
    "with",
    "your",
    "you",
    "guide",
    "book",
    "how",
    "new",
    "best",
    "complete",
    "series",
    "edition",
    "from",
    "at",
    "by",
    "about",
  ]);

  return rawTokens.filter((t) => t.length > 2 && !stopwords.has(t));
}

/**
 * Keyword score: token overlap between niche and title tokens.
 * Returns 0–1 (fraction of niche tokens that appear in the title).
 */
function computeKeywordScore(niche: string, bookTitle: string): number {
  const nicheTokens = tokenize(niche);
  const titleTokens = new Set(tokenize(bookTitle));

  if (nicheTokens.length === 0 || titleTokens.size === 0) return 0;

  let hits = 0;
  for (const token of nicheTokens) {
    if (titleTokens.has(token)) hits++;
  }

  return hits / nicheTokens.length;
}

/**
 * Category score: token overlap between niche tokens and category tokens.
 * Returns 0–1 based on overlap.
 */
function computeCategoryScore(niche: string, categories?: string[]): number {
  if (!categories || categories.length === 0) return 0;

  const nicheTokens = new Set(tokenize(niche));
  if (nicheTokens.size === 0) return 0;

  const catTokens = new Set<string>();
  for (const cat of categories) {
    tokenize(cat).forEach((t) => catTokens.add(t));
  }

  if (catTokens.size === 0) return 0;

  let hits = 0;
  for (const t of nicheTokens) {
    if (catTokens.has(t)) hits++;
  }

  return hits / nicheTokens.size;
}

// ------------------------------------
// Batch semantic scoring via OpenAI
// ------------------------------------

/**
 * Batch semantic scoring: one OpenAI call that scores all titles for the niche.
 *
 * We ask the model to return JSON: an array of numbers (0–1),
 * one per book in order.
 */
async function computeSemanticScoresBatch(
  openai: OpenAI,
  niche: string,
  books: BookForRelevance[]
): Promise<number[]> {
  if (books.length === 0) return [];

  const titles = books.map((b, i) => `${i}: ${b.title}`);

  const prompt = `
You are helping evaluate how relevant book titles are to a specific niche.

Niche:
"${niche}"

Here are the book titles, each prefixed with its index:

${titles.join("\n")}

For each title, return a relevance score from 0 to 1
(0 = completely irrelevant, 1 = perfectly about this niche).

Return ONLY a JSON array of numbers in order, with length ${books.length}.
Example: [0.9, 0.1, 0.75]
  `.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a precise relevance scoring engine. Return ONLY a JSON array of numbers, no prose, no code fences.",
      },
      { role: "user", content: prompt },
    ],
  });

  const raw = completion.choices[0].message.content?.trim() ?? "[]";

  // Robust parsing with fallback; NO direct JSON.parse(raw) elsewhere.
  const scores = parseScoreArrayFromLLM(raw, books.length);
  return scores;
}

// ------------------------------------
// Main entry: score all books for a niche
// ------------------------------------

export async function scoreBooksForNiche(
  openai: OpenAI,
  niche: string,
  books: BookForRelevance[],
  options: RelevanceOptions = {}
): Promise<RelevanceScores[]> {
  const {
    minKeywordScore = 0.15,
    minSemanticScore = 0.45,
    minCategoryScore = 0,
    minSignalsPassing = 2,
    keywordWeight = 0.3,
    semanticWeight = 0.5,
    categoryWeight = 0.2,
  } = options;

  if (!niche || books.length === 0) {
    return books.map((_, index) => ({
      index,
      keywordScore: 0,
      categoryScore: 0,
      semanticScore: 0,
      finalScore: 0,
      isRelevant: false,
      bucket: "out_of_niche" as RelevanceBucket,
    }));
  }

  // Local lexical scores
  const keywordScores = books.map((b) => computeKeywordScore(niche, b.title));
  const categoryScores = books.map((b) =>
    computeCategoryScore(niche, b.categories)
  );

  // One batch semantic call for all books
  const semanticScores = await computeSemanticScoresBatch(openai, niche, books);

  // Debug: inspect semantic scores from the LLM
  console.log("Semantic scores:", semanticScores);

  const results: RelevanceScores[] = books.map((_, index) => {
    const keywordScore = keywordScores[index] ?? 0;
    const categoryScore = categoryScores[index] ?? 0;
    const semanticScore = semanticScores[index] ?? 0;

    // Weighted combined score (for ranking / sorting and bucket assignment)
    const finalScore =
      keywordScore * keywordWeight +
      semanticScore * semanticWeight +
      categoryScore * categoryWeight;

    // Assign bucket based on finalScore thresholds
    let bucket: RelevanceBucket;
    if (finalScore >= 0.70) {
      bucket = "core";
    } else if (finalScore >= 0.50) {
      bucket = "adjacent";
    } else {
      bucket = "out_of_niche";
    }

    // isRelevant = true for core and adjacent (used for primary analysis)
    // Only core books are used for main competition stats
    const isRelevant = bucket === "core" || bucket === "adjacent";

    return {
      index,
      keywordScore,
      categoryScore,
      semanticScore,
      finalScore,
      isRelevant,
      bucket,
    };
  });

  return results;
}
