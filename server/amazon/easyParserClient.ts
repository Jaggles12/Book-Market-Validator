// server/amazon/easyParserClient.ts
// EasyParser-based Amazon client - mirrors the Rainforest client interface

import axios from "axios";
import { NormalizedBook, ProductEnrichmentResult } from "../types";

// -----------------------------
// EasyParser API Configuration
// -----------------------------

const EASYPARSER_BASE_URL = "https://realtime.easyparser.com/v1/request";

// -----------------------------
// Demo mode & related state
// -----------------------------

let demoMode = false;

export function setDemoMode(value: boolean): void {
  demoMode = value;
}

// -----------------------------
// Domain types (for EasyParser responses)
// -----------------------------

interface EasyParserRankEntry {
  category?: string;
  rank?: number;
}

interface EasyParserProduct {
  asin?: string;
  title?: string;
  link?: string;
  image?: string;
  images?: { main?: string; thumbnails?: string[] };
  
  brand?: string;
  authors?: string[] | { name?: string }[];
  by?: string;
  
  price?: number | { current?: number; value?: number; currency?: string };
  currency?: string;
  
  rating?: number;
  reviews_count?: number;
  ratings_total?: number;
  
  bsr?: EasyParserRankEntry[];
  bestsellers_rank?: EasyParserRankEntry | EasyParserRankEntry[];
  sales_rank?: number;
  
  categories?: { name?: string; id?: string }[];
  categories_path?: string;
  
  publication_date?: string;
  
  availability?: string;
  stock_status?: string;
}

interface EasyParserSearchResult {
  results?: EasyParserProduct[];
  search_results?: EasyParserProduct[];
  products?: EasyParserProduct[];
}

interface EasyParserDetailResult {
  data?: EasyParserProduct;
  product?: EasyParserProduct;
}

// Re-export types for compatibility
export interface RainforestRankEntry {
  category?: string;
  rank?: number;
}

export interface RainforestBook {
  title?: string;
  asin?: string;
  link?: string;
  image?: string;
  author?: string;
  authors?: { name?: string }[];
  byline?: string;
  rating?: number;
  ratings_total?: number;
  reviews_total?: number;
  price?: { value?: number } | null;
  bestsellers_rank?: RainforestRankEntry | RainforestRankEntry[];
  sales_rank?: RainforestRankEntry | RainforestRankEntry[] | number;
  rank?: number;
  publication_date?: string;
  categories?: { name?: string }[];
}

export interface ProductEnrichmentData {
  rank: number | null;
  author: string | null;
  publicationDate: string | null;
  publicationYear: number | null;
}

// -----------------------------
// Demo books (same as Rainforest client)
// -----------------------------

export function generateDemoBooks(searchTerm: string): NormalizedBook[] {
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
      rating: 4.3,
      rawRank: 15_200,
      price: 11.99,
    },
    {
      titlePrefix: "Advanced",
      reviews: 234,
      rating: 4.2,
      rawRank: 45_000,
      price: 19.99,
    },
    {
      titlePrefix: "The Beginner's",
      reviews: 1876,
      rating: 4.5,
      rawRank: 2_100,
      price: 13.99,
    },
    {
      titlePrefix: "Professional",
      reviews: 567,
      rating: 4.4,
      rawRank: 12_300,
      price: 24.99,
    },
  ];

  return baseBooks.map((b, index) => ({
    title: `${b.titlePrefix} ${searchTerm}`,
    asin: `DEMO${String(index + 1).padStart(7, "0")}`,
    link: null,
    image: null,
    authors: ["Demo Author"],
    rating: b.rating,
    reviews: b.reviews,
    price: b.price,
    publicationDate: null,
    publicationYear: 2023,
    rawRank: b.rawRank,
    effectiveRank: b.rawRank,
    rankSource: "heuristic" as const,
    isRelevant: true,
  }));
}

// -----------------------------
// Utility functions
// -----------------------------

export function computeEffectiveRank(b: NormalizedBook): number | null {
  if (typeof b.rawRank === "number" && b.rawRank > 0) {
    return b.rawRank;
  }
  if (typeof b.effectiveRank === "number" && b.effectiveRank > 0) {
    return b.effectiveRank;
  }
  return null;
}

export function extractSubcategoryLabel(fullPath: string): string {
  if (!fullPath || typeof fullPath !== "string") return "";
  const segments = fullPath.split(">");
  if (segments.length === 0) return "";
  return segments[segments.length - 1].trim();
}

export function chooseBestRankFromBestsellers(
  entries: EasyParserRankEntry[]
): { rank: number; category: string } | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const validEntries = entries.filter(
    (e) => typeof e.rank === "number" && e.rank > 0
  );

  if (validEntries.length === 0) return null;

  // Prefer the smallest rank (best seller position)
  validEntries.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const best = validEntries[0];

  return {
    rank: best.rank!,
    category: extractSubcategoryLabel(best.category || ""),
  };
}

export function filterToBooksOnly(books: NormalizedBook[]): NormalizedBook[] {
  return books.filter((b) => {
    if (!b.title) return false;

    const title = b.title.toLowerCase();

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
      "calendar",
      "planner",
      "journal",
      "notebook",
      "coloring book",
      "activity book",
    ];

    if (junkPhrases.some((phrase) => title.includes(phrase))) {
      return false;
    }

    return true;
  });
}

export function filterBooksOnly(results: RainforestBook[]): RainforestBook[] {
  return results.filter((r) => {
    if (!r || !r.asin || !r.title) return false;

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
}

export function buildBooksSearchUrl(searchTerm: string): string {
  const encoded = encodeURIComponent(searchTerm.trim());
  return `https://www.amazon.com/s?k=${encoded}&i=stripbooks`;
}

export function buildAmazonBooksSearchUrl(searchTerm: string): string {
  const encoded = encodeURIComponent(searchTerm.trim());
  return `https://www.amazon.com/s?k=${encoded}&i=stripbooks`;
}

// -----------------------------
// EasyParser API helpers
// -----------------------------

function extractAuthorsFromEasyParser(product: EasyParserProduct): string[] {
  const authors: string[] = [];

  if (Array.isArray(product.authors)) {
    for (const author of product.authors) {
      if (typeof author === "string" && author.trim()) {
        authors.push(author.trim());
      } else if (author && typeof (author as any).name === "string") {
        authors.push((author as any).name.trim());
      }
    }
  }

  if (authors.length === 0 && product.by) {
    let byline = product.by.trim();
    if (byline.toLowerCase().startsWith("by ")) {
      byline = byline.substring(3).trim();
    }
    if (byline) authors.push(byline);
  }

  return authors;
}

function extractPriceFromEasyParser(product: EasyParserProduct): number | null {
  if (typeof product.price === "number" && product.price > 0) {
    return product.price;
  }
  if (product.price && typeof product.price === "object") {
    if (typeof product.price.current === "number" && product.price.current > 0) {
      return product.price.current;
    }
    if (typeof product.price.value === "number" && product.price.value > 0) {
      return product.price.value;
    }
  }
  return null;
}

function extractImageFromEasyParser(product: EasyParserProduct): string | null {
  if (product.image && typeof product.image === "string") {
    return product.image;
  }
  if (product.images?.main) {
    return product.images.main;
  }
  return null;
}

function extractRankFromEasyParser(product: EasyParserProduct): { rank: number | null; category: string | null } {
  let primaryRank: number | null = null;
  let rankCategory: string | null = null;

  // Try bsr array first
  if (Array.isArray(product.bsr) && product.bsr.length > 0) {
    const result = chooseBestRankFromBestsellers(product.bsr);
    if (result) {
      primaryRank = result.rank;
      rankCategory = result.category;
    }
  }

  // Try bestsellers_rank
  if (primaryRank === null) {
    if (Array.isArray(product.bestsellers_rank)) {
      const result = chooseBestRankFromBestsellers(product.bestsellers_rank);
      if (result) {
        primaryRank = result.rank;
        rankCategory = result.category;
      }
    } else if (product.bestsellers_rank && typeof (product.bestsellers_rank as any).rank === "number") {
      primaryRank = (product.bestsellers_rank as any).rank;
      rankCategory = (product.bestsellers_rank as any).category || null;
    }
  }

  // Fallback to sales_rank
  if (primaryRank === null && typeof product.sales_rank === "number" && product.sales_rank > 0) {
    primaryRank = product.sales_rank;
  }

  return { rank: primaryRank, category: rankCategory };
}

function extractCategoriesFromEasyParser(product: EasyParserProduct): {
  categoriesFlat: string | null;
  categoryIds: string[];
  categories: { name: string; categoryId: string }[];
} {
  const categoryIds: string[] = [];
  const categories: { name: string; categoryId: string }[] = [];
  let categoriesFlat: string | null = null;

  if (product.categories_path && typeof product.categories_path === "string") {
    categoriesFlat = product.categories_path.trim();
  }

  if (Array.isArray(product.categories)) {
    for (const cat of product.categories) {
      if (cat.id) {
        categoryIds.push(String(cat.id));
      }
      if (cat.name && cat.id) {
        categories.push({ name: cat.name, categoryId: String(cat.id) });
      }
    }

    // Build categories_flat from categories if not provided
    if (!categoriesFlat && categories.length > 0) {
      categoriesFlat = categories.map(c => c.name).join(" > ");
    }
  }

  return { categoriesFlat, categoryIds, categories };
}

function extractPublicationDate(product: EasyParserProduct): { date: string | null; year: number | null } {
  let publicationDate: string | null = null;
  let publicationYear: number | null = null;

  if (product.publication_date && typeof product.publication_date === "string") {
    publicationDate = product.publication_date.trim();

    // Try to extract year
    const yearMatch = publicationDate.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[0], 10);
      if (year >= 1900 && year <= 2100) {
        publicationYear = year;
      }
    }

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

  return { date: publicationDate, year: publicationYear };
}

// -----------------------------
// Core API Functions
// -----------------------------

export async function fetchProductBSR(asin: string): Promise<ProductEnrichmentData> {
  const EASYPARSER_API_KEY = process.env.EASYPARSER_API_KEY;
  
  if (!EASYPARSER_API_KEY) {
    return { rank: null, author: null, publicationDate: null, publicationYear: null };
  }

  try {
    const payload = {
      api_key: EASYPARSER_API_KEY,
      platform: "AMZ",
      domain: ".com",
      operation: "DETAIL",
      asin,
    };

    const resp = await axios.post<EasyParserDetailResult>(EASYPARSER_BASE_URL, payload, {
      timeout: 15000,
    });

    const product = resp.data?.data || resp.data?.product || {};

    const { rank } = extractRankFromEasyParser(product);
    const authors = extractAuthorsFromEasyParser(product);
    const { date: publicationDate, year: publicationYear } = extractPublicationDate(product);

    console.log("EasyParser product enrichment:", { 
      asin, 
      rank, 
      author: authors[0] || null, 
      publicationDate, 
      publicationYear 
    });

    return {
      rank,
      author: authors[0] || null,
      publicationDate,
      publicationYear,
    };
  } catch (err: any) {
    console.error("Error fetching product data from EasyParser for ASIN", asin, err?.message || err);
    return { rank: null, author: null, publicationDate: null, publicationYear: null };
  }
}

export async function enrichBookWithProductDetails(asin: string): Promise<ProductEnrichmentResult> {
  const EASYPARSER_API_KEY = process.env.EASYPARSER_API_KEY;

  const emptyResult: ProductEnrichmentResult = {
    asin,
    rank: null,
    rating: null,
    reviews: null,
    categoryIds: [],
    categoriesFlat: null,
    categories: [],
    publicationDate: null,
    publicationYear: null,
    author: null,
  };

  if (!EASYPARSER_API_KEY) return emptyResult;

  try {
    const payload = {
      api_key: EASYPARSER_API_KEY,
      platform: "AMZ",
      domain: ".com",
      operation: "DETAIL",
      asin,
    };

    const resp = await axios.post<EasyParserDetailResult>(EASYPARSER_BASE_URL, payload, {
      timeout: 15000,
    });

    const product = resp.data?.data || resp.data?.product || {};

    const { rank } = extractRankFromEasyParser(product);
    const authors = extractAuthorsFromEasyParser(product);
    const { date: publicationDate, year: publicationYear } = extractPublicationDate(product);
    const { categoriesFlat, categoryIds, categories } = extractCategoriesFromEasyParser(product);

    let rating: number | null = null;
    let reviews: number | null = null;

    if (typeof product.rating === "number" && product.rating > 0) {
      rating = product.rating;
    }
    if (typeof product.reviews_count === "number" && product.reviews_count >= 0) {
      reviews = product.reviews_count;
    } else if (typeof product.ratings_total === "number" && product.ratings_total >= 0) {
      reviews = product.ratings_total;
    }

    console.log("EasyParser product enrichment detail:", {
      asin,
      categoriesFlat,
      categoryIds: categoryIds.slice(0, 3),
      rating,
      reviews,
      rank,
    });

    return {
      asin,
      rank,
      rating,
      reviews,
      categoryIds,
      categoriesFlat,
      categories,
      publicationDate,
      publicationYear,
      author: authors[0] || null,
    };
  } catch (err: any) {
    console.error("Error enriching product from EasyParser for ASIN", asin, err?.message || err);
    return emptyResult;
  }
}

export async function batchEnrichBooks(
  books: NormalizedBook[],
  limit: number = 8
): Promise<Map<string, ProductEnrichmentResult>> {
  const toEnrich = books.filter((b) => b.asin).slice(0, limit);
  const results = new Map<string, ProductEnrichmentResult>();

  if (toEnrich.length === 0) return results;

  console.log(`EasyParser: Enriching ${toEnrich.length} books with product details...`);

  const promises = toEnrich.map((b) => enrichBookWithProductDetails(b.asin!));
  const settled = await Promise.allSettled(promises);

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const asin = toEnrich[i].asin!;
    if (result.status === "fulfilled") {
      results.set(asin, result.value);
    }
  }

  console.log(`EasyParser: Enrichment complete: ${results.size}/${toEnrich.length} successful`);
  return results;
}

export function applyEnrichmentToBooks(
  books: NormalizedBook[],
  enrichmentMap: Map<string, ProductEnrichmentResult>
): NormalizedBook[] {
  return books.map((book) => {
    if (!book.asin || !enrichmentMap.has(book.asin)) {
      return book;
    }

    const enrichment = enrichmentMap.get(book.asin)!;

    return {
      ...book,
      categoryIds: enrichment.categoryIds,
      categoriesFlat: enrichment.categoriesFlat ?? undefined,
      enrichedCategories: enrichment.categories,
      enrichedRating: enrichment.rating,
      enrichedReviews: enrichment.reviews,
      rating: enrichment.rating ?? book.rating,
      reviews: enrichment.reviews ?? book.reviews,
      effectiveRank: enrichment.rank ?? book.effectiveRank,
      rankSource: enrichment.rank ? "product_lookup" : book.rankSource,
      amazonCategoryPaths: enrichment.categoriesFlat
        ? [enrichment.categoriesFlat, ...(book.amazonCategoryPaths || [])]
        : book.amazonCategoryPaths,
      primaryAmazonPath: enrichment.categoriesFlat ?? book.primaryAmazonPath,
      isEnriched: true,
    };
  });
}

export async function fetchAmazonBooks(
  searchTerm: string
): Promise<{ books: NormalizedBook[]; isDemo: boolean }> {
  const EASYPARSER_API_KEY = process.env.EASYPARSER_API_KEY;

  if (!EASYPARSER_API_KEY || demoMode) {
    console.log("EasyParser: Using demo mode - returning sample book data");
    return { books: generateDemoBooks(searchTerm), isDemo: true };
  }

  try {
    const payload = {
      api_key: EASYPARSER_API_KEY,
      platform: "AMZ",
      domain: ".com",
      operation: "SEARCH",
      payload: {
        keywords: [searchTerm],
      },
    };

    console.log(`EasyParser search: term="${searchTerm}"`);

    const resp = await axios.post<EasyParserSearchResult>(EASYPARSER_BASE_URL, payload, {
      timeout: 30000,
    });

    const allResults: EasyParserProduct[] =
      resp.data?.results || resp.data?.search_results || resp.data?.products || [];

    console.log(`EasyParser search (raw): term="${searchTerm}", results=${allResults.length}`);

    // Filter out non-book products
    const results = allResults.filter((r) => {
      if (!r || !r.asin || !r.title) return false;

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

    console.log(`EasyParser search (filtered): term="${searchTerm}", books=${results.length}`);

    if (results.length > 0) {
      console.log("Sample EasyParser search result:", JSON.stringify(results[0], null, 2));
    }

    // Normalize results to NormalizedBook[]
    const normalizedBooks: NormalizedBook[] = results.map((product) => {
      const authors = extractAuthorsFromEasyParser(product);
      const price = extractPriceFromEasyParser(product);
      const image = extractImageFromEasyParser(product);
      const { rank, category: rankCategory } = extractRankFromEasyParser(product);
      const { categoriesFlat, categoryIds } = extractCategoriesFromEasyParser(product);
      const { date: publicationDate, year: publicationYear } = extractPublicationDate(product);

      let rating: number | null = null;
      if (typeof product.rating === "number" && product.rating > 0) {
        rating = product.rating;
      }

      let reviews: number | null = null;
      if (typeof product.reviews_count === "number" && product.reviews_count >= 0) {
        reviews = product.reviews_count;
      } else if (typeof product.ratings_total === "number" && product.ratings_total >= 0) {
        reviews = product.ratings_total;
      }

      const effectiveRank = rank;
      const rankSource: "bestseller" | "heuristic" | "missing" =
        rank !== null ? "bestseller" : "missing";

      return {
        title: product.title || "",
        asin: product.asin || null,
        link: product.link || null,
        image,
        authors,
        rating,
        reviews,
        price,
        publicationDate,
        publicationYear,
        rawRank: rank,
        effectiveRank,
        rank: effectiveRank,
        rankSource,
        rankCategory,
        amazonCategoryPaths: categoriesFlat ? [categoriesFlat] : [],
        primaryAmazonPath: categoriesFlat,
        categoryIds,
        isRelevant: true,
      };
    });

    console.log(`EasyParser: Normalized ${normalizedBooks.length} books from search`);

    return { books: normalizedBooks, isDemo: false };
  } catch (error: any) {
    console.error("Error fetching Amazon books via EasyParser:", error?.message || error);

    if (error?.response?.status === 402 || error?.response?.status === 401) {
      demoMode = true;
    }

    return { books: generateDemoBooks(searchTerm), isDemo: true };
  }
}

// -----------------------------
// EasyParser client bundle
// -----------------------------
// This object bundles all Amazon/EasyParser functionality into a single export
// matching the interface of rainforestClient in server/amazonClient.ts

export const easyParserClient = {
  // State
  get demoMode() { return demoMode; },
  setDemoMode,
  
  // Core functions
  fetchAmazonBooks,
  fetchProductBSR,
  enrichBookWithProductDetails,
  batchEnrichBooks,
  applyEnrichmentToBooks,
  
  // Utility functions
  generateDemoBooks,
  computeEffectiveRank,
  extractSubcategoryLabel,
  chooseBestRankFromBestsellers,
  filterToBooksOnly,
  filterBooksOnly,
  buildBooksSearchUrl,
  buildAmazonBooksSearchUrl,
};
