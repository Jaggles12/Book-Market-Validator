// server/genreInference.ts
// Functions to infer genre from Amazon category data

import { NormalizedBook, InferredGenre, CanonicalNiche } from "./types";
import { findGenreMapping } from "./genreMap";

interface CategoryClusterResult {
  pathScores: Record<string, number>;
  sortedPaths: string[];
}

// Categories that should NEVER become primary genre unless user explicitly requested them
// ONLY exact segment matches are blocked - "Black & African American" blocks that exact segment,
// but NOT "Multicultural Families" or other legitimate compound categories
const BLOCKED_PRIMARY_SUBCATEGORIES = [
  // Specific race/ethnicity subcategories that shouldn't be inferred as PRIMARY genre
  // These are the actual Amazon segment names that appear in category paths
  "black & african american",
  "african american", 
  "latino & hispanic",
  "asian american",
  "native american",
  // Note: "multicultural" alone is NOT blocked - "multicultural families" is a valid parenting subcategory
  // Only the specific cultural identity segments are blocked
  
  // Hyper-specific lifestyle categories that drift from core topic
  "lgbtq+",
  "gay & lesbian",
  "gender studies"
];

// Note: Children's paths are handled separately by isChildrensPath()

// Path prefixes that indicate Children's/Kindle content (not primary for nonfiction)
const CHILDRENS_PATH_PREFIXES = [
  "kindle store > kindle ebooks > children's",
  "kindle ebooks > children's",
  "children's ebooks"
];

/**
 * Check if a category path contains a blocked subcategory
 * Uses segment-based matching to avoid false positives
 * e.g., "Multicultural" in blocked list should NOT block "Multicultural Families"
 */
function containsBlockedSubcategory(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split(/\s*>\s*/).map(s => s.trim());
  
  return BLOCKED_PRIMARY_SUBCATEGORIES.some(blocked => {
    const blockedLower = blocked.toLowerCase();
    // Check for exact segment match only
    return segments.some(segment => segment === blockedLower);
  });
}

/**
 * Check if path is a Children's/Kindle path that shouldn't be primary for nonfiction
 */
function isChildrensPath(path: string): boolean {
  const lower = path.toLowerCase();
  return CHILDRENS_PATH_PREFIXES.some(prefix => lower.startsWith(prefix) || lower.includes(prefix));
}

/**
 * Filter paths to find valid candidates for primary genre
 * Removes paths with blocked subcategories and Children's paths for nonfiction
 */
function filterValidPrimaryPaths(
  sortedPaths: string[], 
  userCategory: "fiction" | "nonfiction",
  canonicalNiche?: CanonicalNiche
): string[] {
  return sortedPaths.filter(path => {
    // Always block race/ethnicity subcategories as primary (unless we add explicit user consent)
    if (containsBlockedSubcategory(path)) {
      console.log(`🚫 Blocking path as primary (contains blocked subcategory): ${path.substring(0, 60)}...`);
      return false;
    }
    
    // For nonfiction, block Children's eBook paths as primary
    if (userCategory === "nonfiction" && isChildrensPath(path)) {
      console.log(`🚫 Blocking path as primary (Children's path for nonfiction): ${path.substring(0, 60)}...`);
      return false;
    }
    
    // If canonical niche has invalid categories, check against them
    // Use EXACT segment matching only to avoid "Fiction" matching "Nonfiction" or "Multicultural" matching "Multicultural Families"
    if (canonicalNiche?.invalidCategories && canonicalNiche.invalidCategories.length > 0) {
      const lower = path.toLowerCase();
      // Split path into segments for accurate matching
      const segments = lower.split(/\s*>\s*/).map(s => s.trim());
      
      for (const invalid of canonicalNiche.invalidCategories) {
        const invalidLower = invalid.toLowerCase();
        
        // Check for EXACT segment match only - no partial matching
        // "Fiction" blocks "Fiction" but NOT "Nonfiction", "Science Fiction", etc.
        // "Multicultural" blocks "Multicultural" but NOT "Multicultural Families"
        if (segments.some(segment => segment === invalidLower)) {
          console.log(`🚫 Blocking path as primary (exact match for invalid category ${invalid}): ${path.substring(0, 60)}...`);
          return false;
        }
      }
    }
    
    return true;
  });
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
 * 
 * @param books - Normalized books with category data
 * @param userCategory - User's selected category (never overridden)
 * @param canonicalNiche - Optional canonical niche anchor to prevent drift
 */
export function inferGenreFromBooks(
  books: NormalizedBook[],
  userCategory: "fiction" | "nonfiction",
  canonicalNiche?: CanonicalNiche
): InferredGenre {
  // Cluster and rank category paths
  const { sortedPaths } = inferAmazonCategoryCluster(books);
  
  // Filter paths to remove blocked subcategories (race/ethnicity, Children's for nonfiction, etc.)
  const validPaths = filterValidPrimaryPaths(sortedPaths, userCategory, canonicalNiche);
  
  console.log(`=== GENRE PATH FILTERING ===`);
  console.log(`Total paths: ${sortedPaths.length}`);
  console.log(`Valid primary paths: ${validPaths.length}`);
  if (validPaths.length < sortedPaths.length) {
    console.log(`Blocked paths: ${sortedPaths.length - validPaths.length}`);
  }
  
  // Find primary path from filtered valid paths
  const amazonPrimaryPath = validPaths.length > 0 ? validPaths[0] : null;
  
  // Get alternate paths - include both valid and original for reference
  const amazonAlternatePaths = validPaths.slice(1, 4);
  
  // Default fallback - use canonical niche anchor if available
  let shelf = canonicalNiche?.expectedGenre || (userCategory === "fiction" ? "General Fiction" : "General Nonfiction");
  let subgenre = shelf;
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
  } else if (canonicalNiche) {
    // No valid Amazon paths - fall back to canonical niche anchor
    console.log(`⚠️ No valid Amazon paths found - using canonical niche anchor: ${canonicalNiche.expectedGenre}`);
    shelf = canonicalNiche.expectedGenre;
    subgenre = canonicalNiche.expectedDomains[0] || canonicalNiche.expectedGenre;
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
  
  // Final fallback: if still generic and we have a canonical niche, use it
  if (shelf.includes("General") && canonicalNiche?.expectedGenre) {
    console.log(`⚠️ Using canonical niche as fallback: ${canonicalNiche.expectedGenre}`);
    shelf = canonicalNiche.expectedGenre;
    if (canonicalNiche.expectedDomains.length > 0) {
      subgenre = canonicalNiche.expectedDomains[0];
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
