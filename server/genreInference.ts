// server/genreInference.ts
// Functions to infer genre from Amazon category data

import { NormalizedBook, InferredGenre } from "./types";
import { findGenreMapping } from "./genreMap";

interface CategoryClusterResult {
  pathScores: Record<string, number>;
  sortedPaths: string[];
}

/**
 * Cluster and score Amazon category paths across all books
 * Higher scores for: more frequent paths, paths from high-ranking books, paths from relevant books
 */
export function inferAmazonCategoryCluster(
  books: NormalizedBook[]
): CategoryClusterResult {
  const pathScores: Record<string, number> = {};

  for (const book of books) {
    // Collect all category paths - prefer enriched categoriesFlat, then amazonCategoryPaths
    const paths: string[] = [];
    
    // Primary source: enriched categoriesFlat from product endpoint
    if (book.categoriesFlat && book.categoriesFlat.trim().length > 0) {
      paths.push(book.categoriesFlat);
    }
    
    // Fallback: amazonCategoryPaths from search/BSR data
    if (book.amazonCategoryPaths) {
      paths.push(...book.amazonCategoryPaths);
    }
    
    for (const path of paths) {
      if (!path || path.trim().length === 0) continue;
      
      // Base weight - boost enriched data
      let weight = book.isEnriched ? 2.0 : 1.0;
      
      // Boost for semantic relevance
      if (typeof book.semanticScore === "number" && book.semanticScore > 0) {
        weight *= (0.5 + book.semanticScore); // 0.5 to 1.5 multiplier
      }
      
      // Boost for better BSR (lower rank = better)
      const rank = book.rank ?? book.effectiveRank ?? book.rawRank;
      if (typeof rank === "number" && rank > 0) {
        if (rank < 10_000) {
          weight *= 2.0; // Top 10k gets 2x
        } else if (rank < 50_000) {
          weight *= 1.5; // Top 50k gets 1.5x
        } else if (rank < 100_000) {
          weight *= 1.2; // Top 100k gets 1.2x
        }
      }
      
      // Count all paths that look like book categories
      const normalizedPath = path.trim();
      // Accept paths starting with "Books" or containing book-related category structure
      if (normalizedPath.startsWith("Books >") || normalizedPath.startsWith("Books>") || normalizedPath.includes(" > ")) {
        pathScores[normalizedPath] = (pathScores[normalizedPath] ?? 0) + weight;
      }
    }
  }

  // Sort paths by score (highest first)
  const sortedPaths = Object.keys(pathScores).sort(
    (a, b) => pathScores[b] - pathScores[a]
  );

  return { pathScores, sortedPaths };
}

/**
 * Parse an Amazon category path to extract shelf and subgenre
 * Example: "Books > Self-Help > Post-Traumatic Stress Disorder"
 * Returns: { shelf: "Self-Help", subgenre: "Post-Traumatic Stress Disorder" }
 */
function parsePathToGenre(path: string): { shelf: string; subgenre: string } {
  // Remove "Books > " prefix if present
  let cleaned = path.replace(/^Books\s*>\s*/i, "").trim();
  
  // Split by " > " to get path segments
  const segments = cleaned.split(/\s*>\s*/).filter(Boolean);
  
  if (segments.length === 0) {
    return { shelf: "General", subgenre: "General" };
  }
  
  if (segments.length === 1) {
    return { shelf: segments[0], subgenre: segments[0] };
  }
  
  // First segment is the shelf, last meaningful segment is subgenre
  const shelf = segments[0];
  const subgenre = segments[segments.length - 1];
  
  return { shelf, subgenre };
}

/**
 * Infer genre from a collection of books using Amazon category data
 * The userCategory (fiction/nonfiction) is always respected and never overridden
 */
export function inferGenreFromBooks(
  books: NormalizedBook[],
  userCategory: "fiction" | "nonfiction"
): InferredGenre {
  // Cluster and rank category paths
  const { sortedPaths } = inferAmazonCategoryCluster(books);
  
  // Find primary path (first "Books" path)
  const amazonPrimaryPath = sortedPaths.length > 0 ? sortedPaths[0] : null;
  
  // Get alternate paths (next 2-3 after primary)
  const amazonAlternatePaths = sortedPaths.slice(1, 4);
  
  // Default fallback
  let shelf = userCategory === "fiction" ? "General Fiction" : "General Nonfiction";
  let subgenre = userCategory === "fiction" ? "General Fiction" : "General Nonfiction";
  let microgenre: string | null = null;
  
  // Try to find a mapping for the primary path
  if (amazonPrimaryPath) {
    const mapping = findGenreMapping(amazonPrimaryPath, userCategory);
    
    if (mapping) {
      shelf = mapping.shelf;
      subgenre = mapping.subgenre;
      microgenre = mapping.microgenre;
    } else {
      // Fallback: parse the path directly
      const parsed = parsePathToGenre(amazonPrimaryPath);
      shelf = parsed.shelf;
      subgenre = parsed.subgenre;
    }
  }
  
  // If primary path didn't yield a good mapping, try alternate paths
  if (shelf.includes("General") && amazonAlternatePaths.length > 0) {
    for (const altPath of amazonAlternatePaths) {
      const mapping = findGenreMapping(altPath, userCategory);
      if (mapping && !mapping.shelf.includes("General")) {
        shelf = mapping.shelf;
        subgenre = mapping.subgenre;
        microgenre = mapping.microgenre;
        break;
      }
    }
  }
  
  return {
    category: userCategory,
    shelf,
    subgenre,
    microgenre,
    amazonPrimaryPath,
    amazonAlternatePaths,
  };
}

/**
 * Generate a friendly genre label from InferredGenre
 * Example: "Self-Help – Trauma Recovery – PTSD Recovery"
 */
export function generateFriendlyGenreLabelFromInferred(genre: InferredGenre): string {
  const parts = [genre.shelf, genre.subgenre, genre.microgenre].filter(Boolean);
  
  // Deduplicate if shelf and subgenre are the same
  const uniqueParts = [...new Set(parts)];
  
  return uniqueParts.join(" – ");
}
