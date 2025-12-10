// server/amazonClient.ts
// Amazon/Rainforest API client - extracted from routes.ts

import axios from "axios";
import { NormalizedBook, ProductEnrichmentResult } from "./types";

// -----------------------------
// Demo mode & related state
// -----------------------------

export let demoMode = false;

export function setDemoMode(value: boolean): void {
  demoMode = value;
}

// -----------------------------
// Domain types
// -----------------------------

export interface RainforestRankEntry {
  category?: string;
  rank?: number;
}

export interface RainforestBook {
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

export interface ProductEnrichmentData {
  rank: number | null;
  author: string | null;
  publicationDate: string | null;
  publicationYear: number | null;
}

// -----------------------------
// Demo books
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
      rankSource: "bestseller" as const,
      rank: effectiveRank,
      isRelevant: true,
      coverColor: null,
    };
  });
}

// -----------------------------
// Rank utilities
// -----------------------------

/**
 * Compute a single source-of-truth rank for a book.
 *
 * - Prefer rawRank (real BSR from Amazon) if present.
 * - Fall back to any existing rank field if needed.
 * - Treat junk / placeholder ranks (<= 0 or >= 900,000) as "unranked" (null).
 */
export function computeEffectiveRank(b: NormalizedBook): number | null {
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

// Extract a clean, readable subcategory label from a full Amazon category path
// e.g., "Books > Mystery, Thriller & Suspense > Mystery > Cozy > Animals" → "Cozy > Animals"
// e.g., "Books > Literature & Fiction > Genre Fiction > Mystery & Suspense" → "Mystery & Suspense"
export function extractSubcategoryLabel(fullPath: string): string {
  if (!fullPath || fullPath.trim().length === 0) return "Books";
  
  const parts = fullPath.split(">").map((p) => p.trim());
  
  // Remove "Books" prefix if present
  if (parts[0]?.toLowerCase() === "books") {
    parts.shift();
  }
  
  // Remove "Kindle Store" or "Kindle eBooks" prefixes
  while (
    parts.length > 0 &&
    (parts[0]?.toLowerCase().includes("kindle") ||
     parts[0]?.toLowerCase() === "ebooks")
  ) {
    parts.shift();
  }
  
  // If we have 2 or fewer parts left, show all
  if (parts.length <= 2) {
    return parts.join(" > ") || "Books";
  }
  
  // For longer paths, show the last 2 segments for specificity
  // e.g., "Mystery, Thriller & Suspense > Mystery > Cozy > Animals" → "Cozy > Animals"
  return parts.slice(-2).join(" > ");
}

// Prefer a meaningful rank from Rainforest's bestsellers_rank array
// Returns both the rank and the category it came from
export function chooseBestRankFromBestsellers(entries: any[]): { rank: number; category: string } | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  // 1) Prefer the overall Books store rank if present
  const booksEntry = entries.find(
    (e: any) =>
      typeof e.category === "string" && e.category.trim() === "Books"
  );
  if (booksEntry && typeof booksEntry.rank === "number" && booksEntry.rank > 0) {
    return { rank: booksEntry.rank, category: "Books" };
  }

  // 2) Otherwise, pick the entry with the smallest numeric rank (strongest performance)
  const validEntries = entries.filter(
    (e: any) => typeof e.rank === "number" && e.rank > 0
  );
  
  if (validEntries.length === 0) return null;
  
  // Sort by rank ascending and pick the best
  validEntries.sort((a: any, b: any) => a.rank - b.rank);
  const best = validEntries[0];
  
  const categoryPath = typeof best.category === "string" ? best.category : "Books";
  
  return { 
    rank: best.rank, 
    category: extractSubcategoryLabel(categoryPath)
  };
}

// -----------------------------
// Helpers: filter to "real" books only
// -----------------------------

export function filterToBooksOnly(books: NormalizedBook[]): NormalizedBook[] {
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

// Force Amazon search into the Books index via URL
export function buildBooksSearchUrl(searchTerm: string): string {
  const encoded = encodeURIComponent(searchTerm.trim());
  // i=stripbooks => Books only
  return `https://www.amazon.com/s?k=${encoded}&i=stripbooks`;
}

// Filter Rainforest search results down to "likely books only"
export function filterBooksOnly(results: RainforestBook[]): RainforestBook[] {
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

/**
 * Build an Amazon Books search URL for the given term.
 * Name is unique to avoid clashes with any older helpers.
 */
export function buildAmazonBooksSearchUrl(searchTerm: string): string {
  const encoded = encodeURIComponent(searchTerm.trim());
  // Hint Amazon toward the Books category
  return `https://www.amazon.com/s?k=${encoded}&i=stripbooks`;
}

// -----------------------------
// Rainforest helpers
// -----------------------------

export async function fetchProductBSR(asin: string): Promise<ProductEnrichmentData> {
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
    let rankCategory: string | null = null;

    // 1) Try bestsellers_rank array/object
    if (Array.isArray(product.bestsellers_rank)) {
      const result = chooseBestRankFromBestsellers(product.bestsellers_rank);
      if (result) {
        primaryRank = result.rank;
        rankCategory = result.category;
      }
    } else if (
      product.bestsellers_rank &&
      typeof product.bestsellers_rank.rank === "number"
    ) {
      primaryRank = product.bestsellers_rank.rank;
      if (typeof product.bestsellers_rank.category === "string") {
        rankCategory = extractSubcategoryLabel(product.bestsellers_rank.category);
      }
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

/**
 * Comprehensive product enrichment - fetches full category hierarchy, ratings, reviews, and BSR
 * This is the new two-step acquisition: after search, we do targeted product lookups
 */
export async function enrichBookWithProductDetails(asin: string): Promise<ProductEnrichmentResult> {
  const RAINFOREST_API_KEY = process.env.RAINFOREST_API_KEY;
  
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

  if (!RAINFOREST_API_KEY) return emptyResult;

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

    // === EXTRACT CATEGORIES (the key new data) ===
    const categoryIds: string[] = [];
    const categories: { name: string; categoryId: string }[] = [];
    let categoriesFlat: string | null = null;

    // categories array: [{ name: "Books", category_id: "123" }, ...]
    if (Array.isArray(product.categories)) {
      for (const cat of product.categories) {
        if (cat.category_id) {
          categoryIds.push(String(cat.category_id));
        }
        if (cat.name && cat.category_id) {
          categories.push({ name: cat.name, categoryId: String(cat.category_id) });
        }
      }
    }

    // categories_flat: "Books > Parenting > Family Activities"
    if (typeof product.categories_flat === "string" && product.categories_flat.trim()) {
      categoriesFlat = product.categories_flat.trim();
    }

    // === EXTRACT RATING AND REVIEWS ===
    let rating: number | null = null;
    let reviews: number | null = null;

    if (typeof product.rating === "number" && product.rating > 0) {
      rating = product.rating;
    }
    if (typeof product.ratings_total === "number" && product.ratings_total >= 0) {
      reviews = product.ratings_total;
    }

    // === EXTRACT RANK (existing logic) ===
    let primaryRank: number | null = null;
    let rankCategory: string | null = null;

    if (Array.isArray(product.bestsellers_rank)) {
      const result = chooseBestRankFromBestsellers(product.bestsellers_rank);
      if (result) {
        primaryRank = result.rank;
        rankCategory = result.category;
      }
    } else if (product.bestsellers_rank && typeof product.bestsellers_rank.rank === "number") {
      primaryRank = product.bestsellers_rank.rank;
      if (typeof product.bestsellers_rank.category === "string") {
        rankCategory = extractSubcategoryLabel(product.bestsellers_rank.category);
      }
    }

    if (primaryRank == null && Array.isArray(product.sales_rank) && product.sales_rank.length > 0) {
      const firstSales = product.sales_rank[0];
      if (firstSales && typeof firstSales.rank === "number") {
        primaryRank = firstSales.rank;
      }
    } else if (primaryRank == null && typeof product.sales_rank === "number") {
      primaryRank = product.sales_rank;
    }

    if (primaryRank == null && typeof product.rank === "number") {
      primaryRank = product.rank;
    }

    const rank = typeof primaryRank === "number" && primaryRank > 0 ? primaryRank : null;

    // === EXTRACT AUTHOR ===
    let author: string | null = null;
    if (Array.isArray(product.authors) && product.authors.length > 0) {
      const firstAuthor = product.authors[0];
      if (typeof firstAuthor === "string" && firstAuthor.trim().length > 0) {
        author = firstAuthor.trim();
      } else if (firstAuthor && typeof firstAuthor.name === "string") {
        author = firstAuthor.name.trim();
      }
    }

    // === EXTRACT PUBLICATION DATE ===
    let publicationDate: string | null = null;
    let publicationYear: number | null = null;

    if (typeof product.publication_date === "string" && product.publication_date.trim()) {
      publicationDate = product.publication_date.trim();
    } else if (product.product_details) {
      const details = product.product_details;
      if (typeof details.publication_date === "string") {
        publicationDate = details.publication_date;
      } else if (typeof details["Publication date"] === "string") {
        publicationDate = details["Publication date"];
      }
    }

    if (publicationDate) {
      const yearMatch = publicationDate.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        const year = parseInt(yearMatch[0], 10);
        if (year >= 1900 && year <= 2100) {
          publicationYear = year;
        }
      }
    }

    console.log("=== ENRICHED PRODUCT DATA ===", {
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
      author,
    };
  } catch (err: any) {
    console.error("Error enriching product for ASIN", asin, err?.message || err);
    return emptyResult;
  }
}

/**
 * Batch enrich multiple books in parallel
 * Limit to top N to control API costs
 */
export async function batchEnrichBooks(
  books: NormalizedBook[],
  limit: number = 8
): Promise<Map<string, ProductEnrichmentResult>> {
  const toEnrich = books.filter((b) => b.asin).slice(0, limit);
  const results = new Map<string, ProductEnrichmentResult>();

  if (toEnrich.length === 0) return results;

  console.log(`Enriching ${toEnrich.length} books with product details...`);

  // Parallel fetch with Promise.allSettled
  const promises = toEnrich.map((b) => enrichBookWithProductDetails(b.asin!));
  const settled = await Promise.allSettled(promises);

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const asin = toEnrich[i].asin!;
    if (result.status === "fulfilled") {
      results.set(asin, result.value);
    }
  }

  console.log(`Enrichment complete: ${results.size}/${toEnrich.length} successful`);
  return results;
}

/**
 * Apply enrichment data to NormalizedBook array
 */
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
      // Apply enriched category data
      categoryIds: enrichment.categoryIds,
      categoriesFlat: enrichment.categoriesFlat ?? undefined,
      enrichedCategories: enrichment.categories,
      // Apply enriched rating/reviews (prefer enriched over search data)
      enrichedRating: enrichment.rating,
      enrichedReviews: enrichment.reviews,
      rating: enrichment.rating ?? book.rating,
      reviews: enrichment.reviews ?? book.reviews,
      // Apply enriched rank if better
      effectiveRank: enrichment.rank ?? book.effectiveRank,
      rankSource: enrichment.rank ? "product_lookup" : book.rankSource,
      // Update amazon paths from enriched data
      amazonCategoryPaths: enrichment.categoriesFlat
        ? [enrichment.categoriesFlat, ...(book.amazonCategoryPaths || [])]
        : book.amazonCategoryPaths,
      primaryAmazonPath: enrichment.categoriesFlat ?? book.primaryAmazonPath,
      isEnriched: true,
    };
  });
}

// -----------------------------
// Fetch Amazon Data via Rainforest API (with demo mode fallback)
// -----------------------------

export async function fetchAmazonBooks(
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
        let rankCategory: string | null = null;

        // Try to extract rank and category from search result
        if (Array.isArray(r.bestsellers_rank) && r.bestsellers_rank.length > 0) {
          const result = chooseBestRankFromBestsellers(r.bestsellers_rank);
          if (result) {
            rawRank = result.rank;
            rankCategory = result.category;
          }
        } else if (
          r.bestsellers_rank &&
          typeof (r.bestsellers_rank as RainforestRankEntry).rank === "number"
        ) {
          rawRank = (r.bestsellers_rank as RainforestRankEntry).rank!;
          if (typeof (r.bestsellers_rank as RainforestRankEntry).category === "string") {
            rankCategory = extractSubcategoryLabel((r.bestsellers_rank as RainforestRankEntry).category!);
          }
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
          rankCategory = null;
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
          rankCategory,
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
// Rainforest client bundle
// -----------------------------
// This object bundles all Amazon/Rainforest functionality into a single export
// for use by the provider-agnostic layer in server/amazon/index.ts

export const rainforestClient = {
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
