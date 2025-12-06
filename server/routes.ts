import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import axios from "axios";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

interface AuthenticatedRequest extends Request {
  userId?: string;
}

async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.substring(7);
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }
    
    req.userId = user.id;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Authentication failed" });
  }
}

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

// Demo mode flag - set to true when API quota is exceeded
let demoMode = false;

// Trending niches cache with 6-hour TTL
interface TrendingCache {
  niches: string[];
  timestamp: number;
  lastRefreshAttempt: number;
}

const TRENDING_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
let trendingCache: TrendingCache | null = null;

function getCachedTrendingNiches(): { niches: string[]; timestamp: number } | null {
  if (!trendingCache) return null;
  
  const now = Date.now();
  const age = now - trendingCache.timestamp;
  
  // Return cache if it's still valid (less than 6 hours old)
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

// Generate demo books based on search term to simulate real data
function generateDemoBooks(searchTerm: string): NormalizedBook[] {
  const baseBooks = [
    { titlePrefix: "The Complete Guide to", reviews: 2847, rating: 4.6, rank: 1250, price: 14.99 },
    { titlePrefix: "Mastering", reviews: 1523, rating: 4.4, rank: 3420, price: 12.99 },
    { titlePrefix: "Essential", reviews: 892, rating: 4.5, rank: 8900, price: 9.99 },
    { titlePrefix: "The Ultimate", reviews: 3201, rating: 4.7, rank: 890, price: 16.99 },
    { titlePrefix: "Practical", reviews: 456, rating: 4.2, rank: 45000, price: 11.99 },
    { titlePrefix: "Introduction to", reviews: 234, rating: 4.0, rank: 78000, price: 8.99 },
    { titlePrefix: "Advanced", reviews: 678, rating: 4.3, rank: 23000, price: 19.99 },
    { titlePrefix: "Simple", reviews: 1105, rating: 4.5, rank: 5600, price: 10.99 },
    { titlePrefix: "The Power of", reviews: 4521, rating: 4.8, rank: 320, price: 15.99 },
    { titlePrefix: "Secrets of", reviews: 789, rating: 4.1, rank: 34000, price: 13.99 },
    { titlePrefix: "How to Master", reviews: 567, rating: 4.4, rank: 56000, price: 12.49 },
    { titlePrefix: "The Art of", reviews: 2134, rating: 4.6, rank: 2100, price: 17.99 },
    { titlePrefix: "Building Your", reviews: 345, rating: 4.0, rank: 89000, price: 9.49 },
    { titlePrefix: "Transform Your Life with", reviews: 923, rating: 4.3, rank: 12000, price: 14.49 },
    { titlePrefix: "The Beginner's Guide to", reviews: 1678, rating: 4.5, rank: 4500, price: 11.49 },
  ];

  const authors = [
    "James Anderson", "Sarah Mitchell", "Michael Chen", "Emily Roberts",
    "David Williams", "Jennifer Taylor", "Robert Brown", "Lisa Johnson",
    "Christopher Lee", "Amanda Davis", "Matthew Wilson", "Rachel Garcia"
  ];

  return baseBooks.map((book, index) => ({
    title: `${book.titlePrefix} ${searchTerm}`,
    asin: `DEMO${String(index).padStart(6, '0')}`,
    link: `https://amazon.com/dp/DEMO${String(index).padStart(6, '0')}`,
    image: null,
    rating: book.rating,
    reviews: book.reviews,
    price: book.price,
    rank: book.rank,
    publicationDate: `2024-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-15`,
    authors: [authors[index % authors.length]],
  }));
}

// Genre Detection - Expanded for more specific categories
function detectGenre(ideaText: string) {
  const lower = ideaText.toLowerCase();
  const genre = {
    category: "nonfiction",
    subtype: "general",
  };

  // Fiction Detection
  if (
    lower.includes("novel") ||
    lower.includes("fantasy") ||
    lower.includes("romance") ||
    lower.includes("thriller") ||
    lower.includes("mystery") ||
    lower.includes("sci-fi") ||
    lower.includes("science fiction") ||
    lower.includes("fiction") ||
    lower.includes("horror") ||
    lower.includes("suspense")
  ) {
    genre.category = "fiction";
    if (lower.includes("fantasy")) genre.subtype = "fantasy";
    else if (lower.includes("romance")) genre.subtype = "romance";
    else if (lower.includes("mystery") || lower.includes("suspense")) genre.subtype = "mystery";
    else if (lower.includes("thriller")) genre.subtype = "thriller";
    else if (lower.includes("horror")) genre.subtype = "horror";
    else if (lower.includes("sci-fi") || lower.includes("science fiction")) genre.subtype = "science_fiction";
    else genre.subtype = "general_fiction";
  }
  // Christian / Religious / Spiritual
  else if (
    lower.includes("christian") ||
    lower.includes("faith") ||
    lower.includes("spiritual") ||
    lower.includes("prayer") ||
    lower.includes("bible") ||
    lower.includes("god") ||
    lower.includes("jesus") ||
    lower.includes("church") ||
    lower.includes("gospel") ||
    lower.includes("devotional") ||
    lower.includes("scripture") ||
    lower.includes("religious") ||
    lower.includes("worship") ||
    lower.includes("discipleship") ||
    lower.includes("formation")
  ) {
    genre.category = "religion_spirituality";
    if (lower.includes("devotional")) genre.subtype = "devotional";
    else if (lower.includes("bible study") || lower.includes("study guide")) genre.subtype = "bible_study";
    else if (lower.includes("prayer")) genre.subtype = "prayer";
    else if (lower.includes("formation") || lower.includes("discipleship")) genre.subtype = "spiritual_growth";
    else if (lower.includes("christian living") || lower.includes("faith")) genre.subtype = "christian_living";
    else genre.subtype = "christian";
  }
  // Self-Help / Personal Development
  else if (
    lower.includes("self-help") ||
    lower.includes("self help") ||
    lower.includes("personal development") ||
    lower.includes("personal growth") ||
    lower.includes("motivation") ||
    lower.includes("habits") ||
    lower.includes("mindset") ||
    lower.includes("success") ||
    lower.includes("productivity") ||
    lower.includes("goal") ||
    lower.includes("transform")
  ) {
    genre.category = "self_help";
    if (lower.includes("habits")) genre.subtype = "habits";
    else if (lower.includes("productivity")) genre.subtype = "productivity";
    else if (lower.includes("mindset")) genre.subtype = "mindset";
    else if (lower.includes("motivation")) genre.subtype = "motivation";
    else genre.subtype = "personal_development";
  }
  // Health & Wellness
  else if (
    lower.includes("health") ||
    lower.includes("wellness") ||
    lower.includes("fitness") ||
    lower.includes("diet") ||
    lower.includes("nutrition") ||
    lower.includes("exercise") ||
    lower.includes("weight loss") ||
    lower.includes("yoga") ||
    lower.includes("meditation")
  ) {
    genre.category = "health_wellness";
    if (lower.includes("fitness") || lower.includes("exercise")) genre.subtype = "fitness";
    else if (lower.includes("diet") || lower.includes("nutrition")) genre.subtype = "nutrition";
    else if (lower.includes("meditation") || lower.includes("yoga")) genre.subtype = "mindfulness";
    else genre.subtype = "wellness";
  }
  // Mental Health / Psychology
  else if (
    lower.includes("trauma") ||
    lower.includes("anxiety") ||
    lower.includes("depression") ||
    lower.includes("mental health") ||
    lower.includes("therapy") ||
    lower.includes("healing") ||
    lower.includes("psychology") ||
    lower.includes("emotional")
  ) {
    genre.category = "psychology";
    genre.subtype = "mental_health";
  }
  // Business / Professional
  else if (
    lower.includes("startup") ||
    lower.includes("entrepreneur") ||
    lower.includes("business") ||
    lower.includes("leadership") ||
    lower.includes("management") ||
    lower.includes("marketing") ||
    lower.includes("sales") ||
    lower.includes("career") ||
    lower.includes("professional") ||
    lower.includes("corporate") ||
    lower.includes("executive")
  ) {
    genre.category = "business";
    if (lower.includes("entrepreneur") || lower.includes("startup")) genre.subtype = "entrepreneurship";
    else if (lower.includes("leadership") || lower.includes("management")) genre.subtype = "leadership";
    else if (lower.includes("marketing")) genre.subtype = "marketing";
    else if (lower.includes("career") || lower.includes("professional")) genre.subtype = "career_development";
    else genre.subtype = "business";
  }
  // Parenting / Family
  else if (
    lower.includes("parent") ||
    lower.includes("mom") ||
    lower.includes("dad") ||
    lower.includes("mother") ||
    lower.includes("father") ||
    lower.includes("child") ||
    lower.includes("family") ||
    lower.includes("marriage") ||
    lower.includes("relationship")
  ) {
    genre.category = "family_relationships";
    if (lower.includes("parent") || lower.includes("mom") || lower.includes("dad")) genre.subtype = "parenting";
    else if (lower.includes("marriage")) genre.subtype = "marriage";
    else if (lower.includes("relationship")) genre.subtype = "relationships";
    else genre.subtype = "family";
  }
  // Education / Learning
  else if (
    lower.includes("education") ||
    lower.includes("learning") ||
    lower.includes("teaching") ||
    lower.includes("study") ||
    lower.includes("course") ||
    lower.includes("training")
  ) {
    genre.category = "education";
    genre.subtype = "learning";
  }
  // Finance / Money
  else if (
    lower.includes("finance") ||
    lower.includes("money") ||
    lower.includes("investing") ||
    lower.includes("wealth") ||
    lower.includes("budget") ||
    lower.includes("debt") ||
    lower.includes("retirement")
  ) {
    genre.category = "finance";
    if (lower.includes("investing")) genre.subtype = "investing";
    else if (lower.includes("budget") || lower.includes("debt")) genre.subtype = "personal_finance";
    else genre.subtype = "finance";
  }
  // Journals / Workbooks
  else if (lower.includes("journal")) {
    genre.subtype = "journal";
  } else if (lower.includes("workbook")) {
    genre.subtype = "workbook";
  }

  return genre;
}

// Fetch product details to get BSR data
async function fetchProductDetails(asin: string, apiKey: string): Promise<number | null> {
  try {
    const params = {
      api_key: apiKey,
      type: "product",
      amazon_domain: "amazon.com",
      asin: asin,
    };

    const response = await axios.get("https://api.rainforestapi.com/request", {
      params,
    });

    const product = response.data.product;
    if (!product) return null;

    // Extract BSR from bestsellers_rank array (primary location)
    if (product.bestsellers_rank && Array.isArray(product.bestsellers_rank)) {
      // Find the main "Books" category rank (usually has the broadest category)
      const booksRank = product.bestsellers_rank.find(
        (r: any) => r.category?.toLowerCase().includes('books') || r.ladder?.some((l: any) => l.name?.toLowerCase() === 'books')
      );
      if (booksRank && typeof booksRank.rank === 'number') {
        return booksRank.rank;
      }
      // If no specific books category, use the first rank
      if (product.bestsellers_rank[0] && typeof product.bestsellers_rank[0].rank === 'number') {
        return product.bestsellers_rank[0].rank;
      }
    }

    // Fallback: check for sales_rank field
    if (typeof product.sales_rank === 'number') {
      return product.sales_rank;
    }

    return null;
  } catch (error) {
    console.error(`Error fetching product details for ASIN ${asin}:`, error);
    return null;
  }
}

// Fetch Amazon Data via Rainforest API (with demo mode fallback)
async function fetchAmazonBooks(searchTerm: string): Promise<{ books: NormalizedBook[], isDemo: boolean }> {
  const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY;
  
  // If no API key or demo mode is active, return demo data
  if (!RAINFOREST_API_KEY || demoMode) {
    console.log("Using demo mode - returning sample book data");
    return { books: generateDemoBooks(searchTerm), isDemo: true };
  }

  try {
    // Step 1: Search for books
    const searchParams = {
      api_key: RAINFOREST_API_KEY,
      type: "search",
      amazon_domain: "amazon.com",
      search_term: searchTerm,
      number_of_results: 30,
      sort_by: "bestseller_rankings",
    };

    const searchResponse = await axios.get("https://api.rainforestapi.com/request", {
      params: searchParams,
    });

    const results: RainforestBook[] = searchResponse.data.search_results || [];
    
    // Debug: Log first result to see available fields
    if (results.length > 0) {
      console.log("Sample search result fields:", JSON.stringify(results[0], null, 2));
    }

    // Step 2: Normalize search results (without BSR for now)
    const books: NormalizedBook[] = results
      .map((r) => {
        const priceValue =
          r.price && typeof r.price.value === "number" ? r.price.value : null;

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
          rank: null as number | null,
          publicationDate: r.publication_date || null,
          authors,
        };
      })
      .filter((b) => b.title && b.asin);

    // Step 3: Fetch product details for top 15 books to get BSR data
    const topBooks = books.slice(0, 15);
    console.log(`Fetching BSR data for ${topBooks.length} books...`);
    
    const bsrPromises = topBooks.map((book) => 
      fetchProductDetails(book.asin, RAINFOREST_API_KEY)
    );
    
    const bsrResults = await Promise.all(bsrPromises);
    
    // Merge BSR data back into books
    topBooks.forEach((book, index) => {
      const bsr = bsrResults[index];
      if (bsr !== null) {
        book.rank = bsr;
        console.log(`BSR for "${book.title.substring(0, 40)}...": ${bsr}`);
      }
    });

    // Return top books with BSR + remaining books without
    const remainingBooks = books.slice(15);
    return { books: [...topBooks, ...remainingBooks], isDemo: false };
  } catch (error: any) {
    // Check for API quota exceeded (402 Payment Required)
    if (error.response?.status === 402) {
      console.log("API quota exceeded - switching to demo mode");
      demoMode = true;
      return { books: generateDemoBooks(searchTerm), isDemo: true };
    }
    throw error;
  }
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

  // Demand Level based on BSR
  const highDemandBooks = bsrBuckets.veryStrong + bsrBuckets.strong;
  let demandLevel: "HIGH" | "MEDIUM" | "LOW";
  if (highDemandBooks >= 3) {
    demandLevel = "HIGH";
  } else if (highDemandBooks >= 1 || bsrBuckets.moderate >= 2) {
    demandLevel = "MEDIUM";
  } else {
    demandLevel = "LOW";
  }

  // Competition Level based on strong competitors
  // Matches existing calculation: >5 = High, >2 = Medium, ≤2 = Low
  let competitionLevel: "HIGH" | "MEDIUM" | "LOW";
  if (strongCompetitors > 5) {
    competitionLevel = "HIGH";
  } else if (strongCompetitors > 2) {
    competitionLevel = "MEDIUM";
  } else {
    competitionLevel = "LOW";
  }

  // Verdict Matrix Lookup
  // HIGH demand: GREEN (low/med comp), YELLOW (high comp)
  // MEDIUM demand: GREEN (low comp), YELLOW (med comp), RED (high comp)
  // LOW demand: YELLOW (low comp), RED (med/high comp)
  let verdict: "GREEN" | "YELLOW" | "RED";
  let verdictReason: string;

  if (demandLevel === "HIGH") {
    if (competitionLevel === "HIGH") {
      verdict = "YELLOW";
      verdictReason = "High demand but saturated with strong competitors. Differentiation is key.";
    } else {
      verdict = "GREEN";
      verdictReason = "Strong demand with manageable competition. Good opportunity.";
    }
  } else if (demandLevel === "MEDIUM") {
    if (competitionLevel === "LOW") {
      verdict = "GREEN";
      verdictReason = "Moderate demand with low competition. Room to establish yourself.";
    } else if (competitionLevel === "MEDIUM") {
      verdict = "YELLOW";
      verdictReason = "Moderate demand and competition. Success requires strong positioning.";
    } else {
      verdict = "RED";
      verdictReason = "Moderate demand but heavy competition. Hard to break through.";
    }
  } else {
    // LOW demand
    if (competitionLevel === "LOW") {
      verdict = "YELLOW";
      verdictReason = "Low demand but also low competition. Niche may be too small.";
    } else {
      verdict = "RED";
      verdictReason = "Low demand with existing competition. Not recommended.";
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

// Niche Extraction Layer - Convert user input (titles, ideas) into search-friendly market phrases
// This ensures full book titles like "The Little Cloud Who Lost His Rain" become
// searchable market phrases like "children's book about feelings"
async function extractNicheFromIdea(userInput: string): Promise<{ niche: string; isExtracted: boolean }> {
  const input = userInput.trim();
  const words = input.split(/\s+/);
  const wordCount = words.length;
  const lowerInput = input.toLowerCase();
  
  // Generic niche indicator words - if the input contains these, it's likely already a market phrase
  const nicheIndicators = [
    "book about", "books about", "guide to", "how to",
    "self-help", "self help", "devotional", "journal", "workbook",
    "cookbook", "coloring book", "activity book", "picture book",
    "romance", "thriller", "mystery", "fantasy", "fiction", "nonfiction",
    "for beginners", "for kids", "for children", "for adults", "for women", "for men",
    "parenting", "business", "productivity", "motivation", "spirituality",
    "weight loss", "diet", "fitness", "meditation", "mindfulness",
  ];
  
  const hasNicheIndicator = nicheIndicators.some(indicator => lowerInput.includes(indicator));
  
  // Title indicators - if input has these patterns, it's likely a book title needing extraction
  // Note: We avoid simple title-case detection as it catches legitimate niche phrases like "Self-Help Books"
  const titleIndicators = [
    /^the\s+\w+\s+\w+/i,           // Starts with "The" followed by 2+ words (The Little Cloud...)
    /:\s+/,                        // Has colon (subtitle)
    /—/,                           // Em dash
    /'s\s+\w+\s+\w+/i,             // Possessive with 2+ following words (Charlotte's Web, etc.)
    /who\s+\w+|where\s+\w+/i,      // Story-like phrases with continuation
  ];
  
  const hasTitleIndicator = titleIndicators.some(pattern => pattern.test(input));
  
  // Determine if this is a generic niche phrase that should pass through
  // Key insight: if input has strong niche indicators, trust them over weak title patterns
  // The possessive pattern can match niches like "children's book about emotions" so we prioritize niche indicators
  const isGenericNiche = hasNicheIndicator && wordCount <= 8;
  
  // Only require LLM extraction if it has title indicators AND no niche indicators
  const needsLLMExtraction = hasTitleIndicator && !hasNicheIndicator;
  
  // Also extract if it's a long phrase (>6 words) without niche indicators - likely a title or complex idea
  const isLongUnknownPhrase = wordCount > 6 && !hasNicheIndicator;
  
  if (isGenericNiche && !needsLLMExtraction) {
    console.log(`Input "${input}" appears to be a generic niche phrase, using directly`);
    return { niche: input, isExtracted: false };
  }
  
  // If we reach here, we're calling the LLM - this means input needs transformation.
  // If LLM fails, we MUST use fallback, never return the original title.
  
  // Helper function to create a fallback niche based on genre detection
  function createFallbackNiche(text: string): string {
    const genre = detectGenre(text);
    const genreToNiche: Record<string, string> = {
      "fiction": "fiction books",
      "fantasy": "fantasy fiction books",
      "romance": "romance novels",
      "mystery": "mystery thriller books",
      "thriller": "thriller suspense books",
      "horror": "horror fiction books",
      "science_fiction": "science fiction books",
      "general_fiction": "literary fiction",
      "religion_spirituality": "christian inspirational books",
      "devotional": "daily devotional books",
      "bible_study": "bible study guides",
      "prayer": "prayer and spirituality books",
      "spiritual_growth": "spiritual growth books",
      "christian_living": "christian living books",
      "christian": "christian books",
      "self_help": "self-help personal development",
      "habits": "habit building books",
      "productivity": "productivity books",
      "mindset": "mindset and success books",
      "motivation": "motivational self-help",
      "personal_development": "personal development books",
      "health_wellness": "health and wellness books",
      "fitness": "fitness exercise books",
      "nutrition": "nutrition diet books",
      "mindfulness": "meditation mindfulness books",
      "wellness": "wellness lifestyle books",
      "psychology": "psychology self-help",
      "mental_health": "mental health books",
      "business": "business books",
      "entrepreneurship": "entrepreneurship startup books",
      "leadership": "leadership management books",
      "marketing": "marketing strategy books",
      "career_development": "career development books",
      "family_relationships": "family parenting books",
      "parenting": "parenting books",
      "marriage": "marriage relationship books",
      "relationships": "relationships self-help",
      "family": "family life books",
      "education": "education learning books",
      "learning": "learning education books",
      "finance": "personal finance books",
      "investing": "investing money books",
      "personal_finance": "personal finance budgeting",
      "journal": "guided journals",
      "workbook": "workbooks guides",
    };
    
    // Try subtype first, then category
    const niche = genreToNiche[genre.subtype] || genreToNiche[genre.category] || "popular books";
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
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 50,
    });

    const response = completion.choices[0]?.message?.content?.trim() || "";
    
    // Clean up the response - remove quotes, extra punctuation but preserve casing
    const cleanedNiche = response
      .replace(/^["']|["']$/g, "")
      .replace(/^\*+|\*+$/g, "")
      .trim();
    
    // Validate: must be different from original and have reasonable word count
    const nicheWordCount = cleanedNiche.split(/\s+/).length;
    const isDifferentFromOriginal = cleanedNiche.toLowerCase() !== input.toLowerCase();
    
    if (cleanedNiche && nicheWordCount >= 2 && nicheWordCount <= 8 && isDifferentFromOriginal) {
      console.log(`Niche extraction: "${input}" → "${cleanedNiche}"`);
      return { niche: cleanedNiche, isExtracted: true };
    }
    
    // We're in the LLM path, so if LLM fails, ALWAYS use genre-based fallback
    // Never return the original input from here - we explicitly decided it needs transformation
    const fallbackNiche = createFallbackNiche(input);
    console.log(`LLM extraction failed, using genre-based fallback: "${input}" → "${fallbackNiche}"`);
    return { niche: fallbackNiche, isExtracted: true };
  } catch (error) {
    console.error("Niche extraction error:", error);
    // On error in LLM path, always use genre-based fallback
    const fallbackNiche = createFallbackNiche(input);
    console.log(`Niche extraction error, using genre-based fallback: "${fallbackNiche}"`);
    return { niche: fallbackNiche, isExtracted: true };
  }
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

Give exactly 3 strategic, actionable suggestions for this writer. 

IMPORTANT: Output ONLY the 3 suggestions as plain numbered list (1. 2. 3.). No headings, no bold text, no markdown formatting, no introductions. Start directly with suggestion 1.`;

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
      .filter((s) => {
        if (s.length <= 10) return false;
        if (s.includes("**")) return false;
        if (s.endsWith(":")) return false;
        if (s.toLowerCase().includes("tactical steps")) return false;
        if (s.toLowerCase().includes("strategic advice")) return false;
        return true;
      })
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

// Deep Analysis Interface - Structured JSON for comprehensive niche insights
interface TitleIdea {
  title: string;
  subtitle: string;
  hook: string;
}

interface BookBlueprint {
  format: string;
  totalDays: number;
  sections: { name: string; days: string; theme: string }[];
  dailyStructure: string[];
  uniqueElements: string[];
}

interface DeepAnalysis {
  nicheOpportunities: string[];
  formatGaps: string[];
  idealReader: {
    demographics: string;
    psychographics: string;
    painPoints: string[];
    desiredOutcome: string;
  };
  positioningStatement: string;
  differentiationAngles: string[];
  coreKeywords: string[];
  whiteSpaceKeywords: string[];
  suggestedCategories: string[];
  bookBlueprint: BookBlueprint;
  titleIdeas: TitleIdea[];
}

// Generate Deep Analysis using OpenAI with structured JSON output
async function generateDeepAnalysis(
  idea: string,
  genre: { category: string; subtype: string },
  stats: any,
  verdict: string,
  books: NormalizedBook[]
): Promise<DeepAnalysis> {
  // Build context about competing books for the AI
  const topBooksContext = books.slice(0, 10).map(b => ({
    title: b.title,
    rating: b.rating,
    reviews: b.reviews,
    price: b.price,
    rank: b.rank
  }));

  const prompt = `You are an expert book market analyst and publishing strategist. Analyze the following book niche and provide a comprehensive deep analysis.

NICHE/IDEA: "${idea}"
GENRE: ${genre.category} - ${genre.subtype}
MARKET VERDICT: ${verdict}

MARKET DATA:
- Total Books Analyzed: ${stats.totalBooks}
- Average Reviews: ${stats.avgReviews?.toFixed(0) || 'N/A'}
- Price Range: $${stats.priceMin || 0} - $${stats.priceMax || 0} (Median: $${stats.priceMedian || 0})
- Strong Competitors (1000+ reviews, 4.3+ rating): ${stats.strongCompetitors}
- Mid-tier Competitors (100-999 reviews): ${stats.midCompetitors}
- Low Review Books (<50 reviews): ${stats.lowReviewBooks}
- BSR Distribution: ${stats.bsrBuckets?.veryStrong || 0} very strong, ${stats.bsrBuckets?.strong || 0} strong, ${stats.bsrBuckets?.moderate || 0} moderate
- Dominant Authors: ${stats.dominantAuthors?.join(', ') || 'None'}

TOP COMPETING BOOKS:
${JSON.stringify(topBooksContext, null, 2)}

Provide a comprehensive deep analysis in the following JSON structure. Be specific, actionable, and data-driven:

{
  "nicheOpportunities": ["3-5 specific underserved audiences or angles not well covered by existing books"],
  "formatGaps": ["2-4 format opportunities like devotionals, workbooks, audio companions, series, etc."],
  "idealReader": {
    "demographics": "Age range, gender distribution, life stage, profession",
    "psychographics": "Values, beliefs, lifestyle, interests",
    "painPoints": ["3-4 specific problems they're trying to solve"],
    "desiredOutcome": "What transformation do they seek?"
  },
  "positioningStatement": "One compelling sentence: For [audience] who [problem], this book provides [solution] unlike [alternatives] because [unique value]",
  "differentiationAngles": ["4-6 specific ways to stand out from competitors"],
  "coreKeywords": ["8-12 main keywords readers would search for"],
  "whiteSpaceKeywords": ["5-8 underutilized keyword opportunities with less competition"],
  "suggestedCategories": ["3-5 Amazon categories where this book could rank well"],
  "bookBlueprint": {
    "format": "Recommended format (30-day devotional, guide, workbook, etc.)",
    "totalDays": 30,
    "sections": [
      {"name": "Section name", "days": "Days 1-7", "theme": "Section theme/focus"}
    ],
    "dailyStructure": ["Element 1", "Element 2 like scripture/quote", "Element 3 like reflection question"],
    "uniqueElements": ["2-3 unique features to differentiate your book"]
  },
  "titleIdeas": [
    {"title": "Main title", "subtitle": "Descriptive subtitle with keywords", "hook": "Why this title works"}
  ]
}

IMPORTANT: Return ONLY valid JSON. No markdown formatting, no code blocks, no explanatory text. Start with { and end with }.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 2500,
    });

    const response = completion.choices[0]?.message?.content || "";
    
    // Parse the JSON response
    let cleanedResponse = response.trim();
    
    // Remove markdown code blocks if present
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

    const parsed = JSON.parse(cleanedResponse) as DeepAnalysis;
    
    // Validate required fields exist
    if (!parsed.nicheOpportunities || !parsed.idealReader || !parsed.titleIdeas) {
      throw new Error("Missing required fields in AI response");
    }
    
    return parsed;
  } catch (error) {
    console.error("Deep analysis OpenAI error:", error);
    
    // Return a structured fallback response
    return {
      nicheOpportunities: [
        "Target a specific demographic underserved by current offerings",
        "Focus on practical, actionable content over theory",
        "Address a timely topic or current trend in this space"
      ],
      formatGaps: [
        "Interactive workbook with exercises",
        "Audio companion or narrated version",
        "Series format with progressive depth"
      ],
      idealReader: {
        demographics: "Adults 25-55, seeking personal or professional growth",
        psychographics: "Self-motivated learners who value practical solutions",
        painPoints: [
          "Overwhelmed by information without clear direction",
          "Seeking actionable steps rather than theory",
          "Looking for a trusted guide in this topic"
        ],
        desiredOutcome: "Achieve measurable improvement and confidence in this area"
      },
      positioningStatement: `For readers seeking ${idea}, this book provides practical, actionable guidance that goes beyond theory to deliver real results.`,
      differentiationAngles: [
        "Include real-world case studies and examples",
        "Provide step-by-step implementation guides",
        "Add downloadable resources and templates",
        "Focus on a specific audience segment"
      ],
      coreKeywords: [
        idea.split(' ').slice(0, 3).join(' '),
        `${genre.subtype} guide`,
        `${genre.category} book`,
        "practical tips",
        "how to guide"
      ],
      whiteSpaceKeywords: [
        `${idea} for beginners`,
        `${idea} workbook`,
        `${idea} journal`,
        `simple ${genre.subtype}`
      ],
      suggestedCategories: [
        `Books > ${genre.category.charAt(0).toUpperCase() + genre.category.slice(1)}`,
        `Kindle eBooks > ${genre.category.charAt(0).toUpperCase() + genre.category.slice(1)}`,
        "Self-Help > Personal Transformation"
      ],
      bookBlueprint: {
        format: "Comprehensive guide with practical exercises",
        totalDays: 30,
        sections: [
          { name: "Foundation", days: "Days 1-7", theme: "Building core understanding" },
          { name: "Development", days: "Days 8-21", theme: "Practical application and growth" },
          { name: "Mastery", days: "Days 22-30", theme: "Advanced techniques and maintenance" }
        ],
        dailyStructure: [
          "Key concept or principle",
          "Real-world example or story",
          "Practical exercise or action step",
          "Reflection questions"
        ],
        uniqueElements: [
          "Progress tracking checklists",
          "Downloadable bonus resources",
          "Community discussion prompts"
        ]
      },
      titleIdeas: [
        {
          title: `The ${idea.split(' ').slice(0, 2).join(' ')} Blueprint`,
          subtitle: "A Practical Guide to Success",
          hook: "Clear promise with actionable framework"
        },
        {
          title: `Mastering ${idea.split(' ')[0]}`,
          subtitle: `The Complete ${genre.subtype.charAt(0).toUpperCase() + genre.subtype.slice(1)} Guide`,
          hook: "Authority positioning with comprehensive scope"
        },
        {
          title: `The 30-Day ${idea.split(' ').slice(0, 2).join(' ')} Challenge`,
          subtitle: "Transform Your Life One Day at a Time",
          hook: "Time-bound promise with daily structure"
        }
      ]
    };
  }
}

// Fetch trending book niches by searching for current bestsellers
async function fetchTrendingNiches(): Promise<string[]> {
  const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY;
  
  if (!RAINFOREST_API_KEY) {
    throw new Error("RAINFOREST_API_KEY not configured");
  }

  try {
    // Search for current trending books using a broad search term
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

    const products = response.data.search_results || [];
    console.log(`Fetched ${products.length} trending books from Amazon search`);

    if (products.length === 0) {
      return getDefaultTrendingNiches();
    }

    // Extract book titles for analysis
    const bookTitles = products
      .slice(0, 20)
      .map((p: any) => p.title || "")
      .filter((t: string) => t.length > 0);

    // Use OpenAI to identify trending themes/niches from these titles
    const trendingNiches = await extractNichesFromTitles(bookTitles);
    
    return trendingNiches.length > 0 ? trendingNiches : getDefaultTrendingNiches();
  } catch (error: any) {
    // Log error safely without exposing API keys
    console.error("Error fetching trending niches:", error?.message || "Unknown error");
    return getDefaultTrendingNiches();
  }
}

// Use AI to extract niche themes from book titles
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
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || "";
    console.log("AI response for niches:", response);
    
    // Try to parse as JSON array
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
    
    // Fallback: parse line by line, removing numbering and bullets
    const niches = response
      .split("\n")
      .map((line) => line.replace(/^\d+[\.\)]\s*|^[-•*]\s*|^["']|["']$/g, "").trim())
      .filter((line) => line.length > 10 && line.length < 50 && !line.startsWith("[") && !line.startsWith("{"))
      .slice(0, 3);

    console.log("Extracted trending niches (fallback):", niches);
    return niches;
  } catch (error: any) {
    // Log error safely without exposing API keys
    console.error("Error extracting niches with AI:", error?.message || "Unknown error");
    return [];
  }
}

// Fallback trending niches if API fails
function getDefaultTrendingNiches(): string[] {
  return [
    "productivity habit guides",
    "cozy small town mysteries",
    "personal finance basics"
  ];
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Supabase config endpoint (anon key is safe to expose - it's designed for public use)
  app.get("/api/auth/config", (req, res) => {
    res.json({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    });
  });

  // Trending niches endpoint with caching
  app.get("/api/trending", async (req, res) => {
    try {
      // Check cache first
      const cached = getCachedTrendingNiches();
      if (cached) {
        console.log("Returning cached trending niches");
        return res.json({ 
          niches: cached.niches, 
          timestamp: cached.timestamp,
          cached: true 
        });
      }

      // Fetch fresh data
      const niches = await fetchTrendingNiches();
      setCachedTrendingNiches(niches);
      
      res.json({ 
        niches, 
        timestamp: Date.now(),
        cached: false 
      });
    } catch (error: any) {
      console.error("Trending fetch error:", error);
      const defaultNiches = getDefaultTrendingNiches();
      res.json({ 
        niches: defaultNiches, 
        timestamp: Date.now(),
        cached: false,
        isDefault: true 
      });
    }
  });

  // Force refresh trending niches (clears cache)
  app.post("/api/trending/refresh", async (req, res) => {
    try {
      // Clear the cache to force fresh fetch
      clearTrendingCache();
      console.log("Cleared trending cache, fetching fresh data");
      
      // Fetch fresh data
      const niches = await fetchTrendingNiches();
      setCachedTrendingNiches(niches);
      
      res.json({ 
        niches, 
        timestamp: Date.now(),
        cached: false,
        refreshed: true 
      });
    } catch (error: any) {
      console.error("Trending refresh error:", error);
      // Return default niches on error but indicate it failed
      const defaultNiches = getDefaultTrendingNiches();
      res.status(500).json({ 
        niches: defaultNiches, 
        timestamp: Date.now(),
        cached: false,
        isDefault: true,
        error: "Failed to fetch fresh trending data" 
      });
    }
  });

  app.post("/api/validate", authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const { idea } = req.body;
      const userId = req.userId!;

      if (!idea || typeof idea !== "string") {
        return res.status(400).json({ error: "Book idea is required" });
      }

      // Step 0: Extract niche from user input (converts full titles to searchable market phrases)
      // This ensures "The Little Cloud Who Lost His Rain" becomes "children's book about emotions"
      const { niche: searchTerm, isExtracted } = await extractNicheFromIdea(idea);
      console.log(`Niche extraction result: input="${idea}" → searchTerm="${searchTerm}" (extracted=${isExtracted})`);

      // Step 1: Detect Genre (use original idea for better genre detection context)
      const genre = detectGenre(idea);

      // Step 2: Fetch Amazon Data using the extracted niche phrase
      const { books, isDemo } = await fetchAmazonBooks(searchTerm);

      // Step 3: Compute Market Stats
      const analysis = computeMarketSnapshot(books, genre);

      // Step 4: Generate AI Suggestions
      const suggestions = await generateSuggestions(idea, genre, analysis, analysis.verdict);

      // Step 5: Generate Deep Analysis (comprehensive niche insights)
      // This calls the OpenAI API with market data to produce structured insights
      // including niche opportunities, ideal reader profile, keywords, book blueprint, and title ideas
      const deepAnalysis = await generateDeepAnalysis(idea, genre, analysis, analysis.verdict, books);

      // Build the response object
      const demandLevel = analysis.bsrBuckets.veryStrong + analysis.bsrBuckets.strong > 5 ? "High" : "Medium";
      const competitionLevel = analysis.strongCompetitors > 5 ? "High" : analysis.strongCompetitors > 2 ? "Medium" : "Low";
      
      const responseData = {
        verdict: analysis.verdict,
        verdictReason: analysis.verdictReason,
        genre,
        isDemo,
        searchTerm: isExtracted ? searchTerm : null,
        stats: {
          avgPrice: (analysis.priceMin && analysis.priceMax) 
            ? (analysis.priceMin + analysis.priceMax) / 2 
            : 0,
          avgRating: analysis.avgRating,
          competitionLevel,
          demandLevel,
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
        books: books.slice(0, 15).map((b: NormalizedBook) => ({
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
        // Deep Analysis block - comprehensive niche insights from AI
        // This is the new structured analysis that extends the basic suggestions
        deepAnalysis: {
          nicheOpportunities: deepAnalysis.nicheOpportunities,
          formatGaps: deepAnalysis.formatGaps,
          idealReader: deepAnalysis.idealReader,
          positioningStatement: deepAnalysis.positioningStatement,
          differentiationAngles: deepAnalysis.differentiationAngles,
          coreKeywords: deepAnalysis.coreKeywords,
          whiteSpaceKeywords: deepAnalysis.whiteSpaceKeywords,
          suggestedCategories: deepAnalysis.suggestedCategories,
          bookBlueprint: deepAnalysis.bookBlueprint,
          titleIdeas: deepAnalysis.titleIdeas,
        },
      };

      // Save to database
      try {
        await storage.saveResult({
          userId,
          niche: idea,
          verdict: analysis.verdict,
          demandScore: demandLevel,
          competitionScore: competitionLevel,
          keyInsights: suggestions.slice(0, 2).join(" | "),
          fullReportJson: responseData,
        });
      } catch (saveError) {
        console.error("Failed to save result to database:", saveError);
      }

      // Return Full Analysis
      res.json(responseData);
    } catch (error: any) {
      console.error("Validation error:", error);
      
      // Check for API quota exceeded (402 Payment Required)
      if (error.response?.status === 402 || error.message?.includes("402")) {
        return res.status(503).json({ 
          error: "API quota exceeded", 
          details: "The Amazon data service has reached its usage limit. Please try again later or contact support to add more API credits."
        });
      }
      
      res.status(500).json({ 
        error: "Failed to validate book idea", 
        details: error.message 
      });
    }
  });

  // Get all saved results for the authenticated user
  app.get("/api/saved-results", authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const results = await storage.getAllResultsByUser(userId);
      res.json(results);
    } catch (error: any) {
      console.error("Error fetching saved results:", error);
      res.status(500).json({ error: "Failed to fetch saved results" });
    }
  });

  // Get a single saved result by ID for the authenticated user
  app.get("/api/saved-results/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId!;
      const result = await storage.getResultById(id, userId);
      if (!result) {
        return res.status(404).json({ error: "Result not found" });
      }
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching saved result:", error);
      res.status(500).json({ error: "Failed to fetch saved result" });
    }
  });

  // Delete a saved result by ID for the authenticated user
  app.delete("/api/saved-results/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.userId!;
      const deleted = await storage.deleteResult(id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Result not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting saved result:", error);
      res.status(500).json({ error: "Failed to delete saved result" });
    }
  });

  // Export saved results as CSV for the authenticated user
  app.get("/api/saved-results/export/csv", authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.userId!;
      const results = await storage.getAllResultsByUser(userId);
      
      const sanitizeForCSV = (value: string): string => {
        let sanitized = value.replace(/"/g, '""');
        sanitized = sanitized.replace(/[\r\n]+/g, ' ');
        if (/^[=+\-@\t\r]/.test(sanitized)) {
          sanitized = "'" + sanitized;
        }
        return sanitized;
      };
      
      const csvHeader = "id,niche,verdict,demandScore,competitionScore,createdAt\n";
      const csvRows = results.map((r: { id: string; niche: string; verdict: string; demandScore: string; competitionScore: string; createdAt: Date }) => 
        `"${sanitizeForCSV(r.id)}","${sanitizeForCSV(r.niche)}","${sanitizeForCSV(r.verdict)}","${sanitizeForCSV(r.demandScore)}","${sanitizeForCSV(r.competitionScore)}","${r.createdAt.toISOString()}"`
      ).join("\n");
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=book-validation-results.csv");
      res.send(csvHeader + csvRows);
    } catch (error: any) {
      console.error("Error exporting CSV:", error);
      res.status(500).json({ error: "Failed to export CSV" });
    }
  });

  return httpServer;
}
