import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import axios from "axios";
import OpenAI from "openai";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY
});

interface RainforestBook {
  title?: string;
  asin?: string;
  link?: string;
  image?: string;
  rating?: number;
  ratings_total?: number;
  reviews_total?: number;
  price?: { value?: number };
  bestsellers_rank?: { rank?: number };
  sales_rank?: number;
  publication_date?: string;
  authors?: { name?: string }[];
}

interface NormalizedBook {
  title: string;
  asin: string;
  link: string;
  image: string | null;
  rating: number;
  reviews: number;
  price: number | null;
  rank: number | null;
  publicationDate: string | null;
  authors: string[];
}

// Genre Detection
function detectGenre(ideaText: string) {
  const lower = ideaText.toLowerCase();
  const genre = {
    category: "nonfiction",
    subtype: "general",
  };

  if (
    lower.includes("novel") ||
    lower.includes("fantasy") ||
    lower.includes("romance") ||
    lower.includes("thriller") ||
    lower.includes("mystery") ||
    lower.includes("sci-fi") ||
    lower.includes("science fiction")
  ) {
    genre.category = "fiction";
    if (lower.includes("fantasy")) genre.subtype = "fantasy";
    else if (lower.includes("romance")) genre.subtype = "romance";
    else if (lower.includes("mystery")) genre.subtype = "mystery";
    else genre.subtype = "general_fiction";
  } else if (lower.includes("devotional")) {
    genre.subtype = "devotional";
  } else if (lower.includes("journal")) {
    genre.subtype = "journal";
  } else if (lower.includes("workbook")) {
    genre.subtype = "workbook";
  } else if (lower.includes("bible study") || lower.includes("study guide")) {
    genre.subtype = "study";
  } else if (
    lower.includes("startup") ||
    lower.includes("entrepreneur") ||
    lower.includes("business")
  ) {
    genre.subtype = "business";
  } else if (
    lower.includes("parent") ||
    lower.includes("mom") ||
    lower.includes("dad")
  ) {
    genre.subtype = "parenting";
  } else if (
    lower.includes("trauma") ||
    lower.includes("anxiety") ||
    lower.includes("healing")
  ) {
    genre.subtype = "mental_health";
  }

  return genre;
}

// Fetch Amazon Data via Rainforest API
async function fetchAmazonBooks(searchTerm: string): Promise<NormalizedBook[]> {
  const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY;
  
  if (!RAINFOREST_API_KEY) {
    throw new Error("RAINFOREST_API_KEY not configured");
  }

  const params = {
    api_key: RAINFOREST_API_KEY,
    type: "search",
    amazon_domain: "amazon.com",
    search_term: searchTerm,
    number_of_results: 30,
    sort_by: "bestseller_rankings",
  };

  const response = await axios.get("https://api.rainforestapi.com/request", {
    params,
  });

  const results: RainforestBook[] = response.data.search_results || [];
  
  // Debug: Log first result to see available fields
  if (results.length > 0) {
    console.log("Sample search result fields:", JSON.stringify(results[0], null, 2));
  }

  const books: NormalizedBook[] = results
    .map((r) => {
      const priceValue =
        r.price && typeof r.price.value === "number" ? r.price.value : null;

      let rank = null;
      if (r.bestsellers_rank && typeof r.bestsellers_rank.rank === "number") {
        rank = r.bestsellers_rank.rank;
      } else if (typeof r.sales_rank === "number") {
        rank = r.sales_rank;
      }

      const authors =
        r.authors && Array.isArray(r.authors)
          ? r.authors
              .map((a) => (typeof a.name === "string" ? a.name : null))
              .filter(Boolean) as string[]
          : [];

      return {
        title: r.title || "",
        asin: r.asin || "",
        link: r.link || "",
        image: r.image || null,
        rating: r.rating || 0,
        reviews: r.ratings_total || r.reviews_total || 0,
        price: priceValue,
        rank,
        publicationDate: r.publication_date || null,
        authors,
      };
    })
    .filter((b) => b.title);

  return books;
}

// Compute Market Stats
function computeMarketSnapshot(books: NormalizedBook[], genreHint: { category: string; subtype: string }) {
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
      verdict: "RED" as const,
      verdictReason: "No relevant books found — demand appears very low.",
    };
  }

  const ratings = books.map((b) => b.rating || 0);
  const reviews = books.map((b) => b.reviews || 0);
  const pricesRaw = books
    .map((b) => b.price)
    .filter((p): p is number => typeof p === "number" && p > 0);
  const ranks = books.map((b) => b.rank).filter((r): r is number => typeof r === "number");

  const avgRating = ratings.reduce((sum, r) => sum + r, 0) / (ratings.length || 1);
  const avgReviews = reviews.reduce((sum, r) => sum + r, 0) / (reviews.length || 1);

  // Price Analysis
  let priceMin = null;
  let priceMax = null;
  let priceMedian = null;
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

  // BSR Distribution
  const bsrBuckets = {
    veryStrong: ranks.filter((r) => r <= 10000).length,
    strong: ranks.filter((r) => r > 10000 && r <= 100000).length,
    moderate: ranks.filter((r) => r > 100000 && r <= 300000).length,
    weak: ranks.filter((r) => r > 300000).length,
  };

  const strongCompetitors = books.filter((b) => b.reviews >= 1000 && b.rating >= 4.3).length;
  const midCompetitors = books.filter(
    (b) => b.reviews >= 100 && b.reviews < 1000 && b.rating >= 4.0
  ).length;
  const lowReviewBooks = books.filter((b) => b.reviews < 50).length;

  // Author Dominance
  const allAuthors = books.flatMap((b) => b.authors || []);
  const authorFrequency: Record<string, number> = {};
  allAuthors.forEach((a) => {
    authorFrequency[a] = (authorFrequency[a] || 0) + 1;
  });
  const dominantAuthors = Object.entries(authorFrequency)
    .filter(([_, count]) => count >= 3)
    .map(([name, count]) => ({ name, count }));

  // Evergreen Signal
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

  // Verdict Logic
  const isFiction = genreHint.category === "fiction";
  const strongDemandByBSR = bsrBuckets.veryStrong + bsrBuckets.strong >= 3;
  const moderateDemandByBSR = bsrBuckets.moderate > 0 || bsrBuckets.strong > 0 || bsrBuckets.veryStrong > 0;
  const veryWeakDemandByBSR = bsrBuckets.veryStrong + bsrBuckets.strong + bsrBuckets.moderate === 0;
  const veryLowReviews = avgReviews < 20;
  const okReviewVolume = avgReviews >= 30;
  const cheapMarketDominated = cheapBookShare > 0.4;

  let verdict: "GREEN" | "YELLOW" | "RED" = "YELLOW";
  let verdictReason = "Mixed signals. Some demand and competition — success depends on a clear angle.";

  if (isFiction) {
    if ((veryWeakDemandByBSR && veryLowReviews) || (cheapMarketDominated && veryLowReviews)) {
      verdict = "RED";
      verdictReason = "Fiction demand looks weak — low review volume and no clear bestsellers.";
    } else if (dominantAuthors.length > 0 && books.length < 10) {
      verdict = "RED";
      verdictReason = "This fiction niche is dominated by a small number of authors.";
    } else if (strongDemandByBSR && okReviewVolume && !dominantAuthors.length && !cheapMarketDominated) {
      verdict = "GREEN";
      verdictReason = "Strong demand validated by BSR and reviews. Multiple authors succeeding.";
    } else if (moderateDemandByBSR || okReviewVolume) {
      verdict = "YELLOW";
      verdictReason = "Evidence of fiction demand, but not overwhelming. Strong craft and positioning needed.";
    }
  } else {
    // Nonfiction logic
    if (veryWeakDemandByBSR && veryLowReviews) {
      verdict = "RED";
      verdictReason = "Very low demand signals. This niche may be too narrow or not validated.";
    } else if (strongDemandByBSR && strongCompetitors <= 3) {
      verdict = "GREEN";
      verdictReason = "Clear demand with room for new entrants. Good opportunity.";
    } else if (strongCompetitors >= 6 && lowReviewBooks <= 3) {
      verdict = "RED";
      verdictReason = "Oversaturated by giants with almost no small players succeeding.";
    } else if (moderateDemandByBSR) {
      verdict = "YELLOW";
      verdictReason = "Moderate demand. Success requires differentiation and marketing.";
    }
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
  };
}

// Generate AI Suggestions
async function generateSuggestions(
  idea: string,
  genre: { category: string; subtype: string },
  stats: any,
  verdict: string
): Promise<string[]> {
  const prompt = `You are a book publishing strategist. A writer wants to write about: "${idea}"

Genre: ${genre.category} - ${genre.subtype}
Market Verdict: ${verdict}
Market Stats:
- Average Reviews: ${stats.avgReviews.toFixed(0)}
- Strong Competitors: ${stats.strongCompetitors}
- Price Range: $${stats.priceMin} - $${stats.priceMax}
- Verdict Reason: ${stats.verdictReason}

Give exactly 3 strategic, actionable suggestions for this writer. Be specific and tactical.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || "";
    const suggestions = response
      .split("\n")
      .filter((line) => line.trim().match(/^\d+\.|^-|^•/))
      .map((line) => line.replace(/^\d+\.\s*|^-\s*|^•\s*/, "").trim())
      .filter((s) => s.length > 10)
      .slice(0, 3);

    return suggestions.length > 0
      ? suggestions
      : [
          "Focus on a specific sub-niche to reduce competition.",
          "Ensure your cover design is professional.",
          "Build an email list before launch.",
        ];
  } catch (error) {
    console.error("OpenAI error:", error);
    return [
      "Research your target audience deeply.",
      "Study successful books in this niche.",
      "Create a strong unique value proposition.",
    ];
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post("/api/validate", async (req, res) => {
    try {
      const { idea } = req.body;

      if (!idea || typeof idea !== "string") {
        return res.status(400).json({ error: "Book idea is required" });
      }

      // Step 1: Detect Genre
      const genre = detectGenre(idea);

      // Step 2: Fetch Amazon Data
      const books = await fetchAmazonBooks(idea);

      // Step 3: Compute Market Stats
      const analysis = computeMarketSnapshot(books, genre);

      // Step 4: Generate AI Suggestions
      const suggestions = await generateSuggestions(idea, genre, analysis, analysis.verdict);

      // Return Full Analysis
      res.json({
        verdict: analysis.verdict,
        verdictReason: analysis.verdictReason,
        genre,
        stats: {
          avgPrice: (analysis.priceMin && analysis.priceMax) 
            ? (analysis.priceMin + analysis.priceMax) / 2 
            : 0,
          avgRating: analysis.avgRating,
          competitionLevel:
            analysis.strongCompetitors > 5 ? "High" : analysis.strongCompetitors > 2 ? "Medium" : "Low",
          demandLevel:
            analysis.bsrBuckets.veryStrong + analysis.bsrBuckets.strong > 5 ? "High" : "Medium",
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
        books: books.slice(0, 15).map((b) => ({
          title: b.title,
          author: b.authors[0] || "Unknown",
          price: b.price || 0,
          rating: b.rating,
          reviews: b.reviews,
          rank: b.rank || 999999,
          image: b.image,
          coverColor: `hsl(${Math.random() * 360}, 70%, 80%)`,
          publicationYear: b.publicationDate ? new Date(b.publicationDate).getFullYear() : new Date().getFullYear(),
        })),
        suggestions,
      });
    } catch (error: any) {
      console.error("Validation error:", error);
      res.status(500).json({ 
        error: "Failed to validate book idea", 
        details: error.message 
      });
    }
  });

  return httpServer;
}
