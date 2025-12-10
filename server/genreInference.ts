// server/genreInference.ts
// Functions to infer genre from Amazon category data

import { NormalizedBook, InferredGenre, CanonicalNiche } from "./types";
import { findGenreMapping } from "./genreMap";

interface CategoryClusterResult {
  pathScores: Record<string, number>;
  sortedPaths: string[];
}

// =============================================================================
// GENRE FAMILY SYSTEM
// =============================================================================
// Genre families group related genres into primary classification buckets.
// This allows us to recognize that "Contemporary Romance" and paths containing
// "Romance" belong to the same family, and should not be overridden by
// generic "Literature & Fiction > Contemporary Fiction" labels.

export type GenreFamily = 
  | "Romance"
  | "MysteryThriller"
  | "SciFiFantasy"
  | "Horror"
  | "LiteraryFiction"
  | "YoungAdult"
  | "ChildrenMiddleGrade"
  | "Nonfiction";

// Mapping from canonical genre strings to genre families
const CANONICAL_TO_FAMILY: Record<string, GenreFamily> = {
  // Romance family
  "romance": "Romance",
  "contemporary romance": "Romance",
  "historical romance": "Romance",
  "romantic comedy": "Romance",
  "paranormal romance": "Romance",
  "small town romance": "Romance",
  "small town contemporary romance": "Romance",
  "sweet romance": "Romance",
  "clean romance": "Romance",
  "rom-com": "Romance",
  "romantic suspense": "Romance",
  "regency romance": "Romance",
  "billionaire romance": "Romance",
  "western romance": "Romance",
  "holiday romance": "Romance",
  "second chance romance": "Romance",
  "enemies to lovers": "Romance",
  "friends to lovers": "Romance",
  "love story": "Romance",
  
  // Mystery/Thriller family
  "mystery": "MysteryThriller",
  "thriller": "MysteryThriller",
  "suspense": "MysteryThriller",
  "cozy mystery": "MysteryThriller",
  "detective fiction": "MysteryThriller",
  "crime fiction": "MysteryThriller",
  "psychological thriller": "MysteryThriller",
  "legal thriller": "MysteryThriller",
  "police procedural": "MysteryThriller",
  "noir": "MysteryThriller",
  "whodunit": "MysteryThriller",
  "murder mystery": "MysteryThriller",
  
  // SciFi/Fantasy family
  "science fiction": "SciFiFantasy",
  "sci-fi": "SciFiFantasy",
  "fantasy": "SciFiFantasy",
  "epic fantasy": "SciFiFantasy",
  "urban fantasy": "SciFiFantasy",
  "space opera": "SciFiFantasy",
  "dystopian": "SciFiFantasy",
  "post-apocalyptic": "SciFiFantasy",
  "cyberpunk": "SciFiFantasy",
  "steampunk": "SciFiFantasy",
  "paranormal": "SciFiFantasy",
  "supernatural": "SciFiFantasy",
  "litrpg": "SciFiFantasy",
  "gamelit": "SciFiFantasy",
  
  // Horror family
  "horror": "Horror",
  "dark fiction": "Horror",
  "psychological horror": "Horror",
  "supernatural horror": "Horror",
  "gothic": "Horror",
  
  // Young Adult family
  "young adult": "YoungAdult",
  "ya": "YoungAdult",
  "teen fiction": "YoungAdult",
  "new adult": "YoungAdult",
  
  // Children's/Middle Grade family
  "children's": "ChildrenMiddleGrade",
  "middle grade": "ChildrenMiddleGrade",
  "picture book": "ChildrenMiddleGrade",
  "kids": "ChildrenMiddleGrade",
  
  // Literary Fiction (catch-all for general fiction)
  "literary fiction": "LiteraryFiction",
  "contemporary fiction": "LiteraryFiction",
  "general fiction": "LiteraryFiction",
  "women's fiction": "LiteraryFiction",
  "historical fiction": "LiteraryFiction",
  "book club fiction": "LiteraryFiction",
};

// Path patterns that indicate genre family membership
// These are checked against Amazon category paths to detect family signals
const FAMILY_PATH_PATTERNS: Record<GenreFamily, string[]> = {
  "Romance": [
    "romance",
    "romantic",
    "love story",
    "love & romance",
    "romantic comedy",
    "contemporary romance",
    "historical romance",
  ],
  "MysteryThriller": [
    "mystery",
    "thriller",
    "suspense",
    "detective",
    "crime",
    "whodunit",
    "noir",
    "police procedural",
  ],
  "SciFiFantasy": [
    "science fiction",
    "sci-fi",
    "fantasy",
    "space opera",
    "dystopian",
    "supernatural",
    "paranormal",
    "magic",
    "dragons",
  ],
  "Horror": [
    "horror",
    "dark fiction",
    "occult",
    "supernatural horror",
  ],
  "YoungAdult": [
    "teen & young adult",
    "young adult",
    "ya fiction",
    "teen fiction",
  ],
  "ChildrenMiddleGrade": [
    "children's books",
    "children's ebooks",
    "kids' books",
    "picture books",
    "middle grade",
  ],
  "LiteraryFiction": [
    "literary fiction",
    "contemporary fiction",
    "general literature",
    "literature & fiction",
  ],
  "Nonfiction": [
    "self-help",
    "business",
    "health",
    "cooking",
    "history",
    "biography",
    "science",
    "reference",
    "education",
    "religion",
    "spirituality",
    "parenting",
    "relationships",
  ],
};

// Shelf labels for each genre family
const FAMILY_SHELF_LABELS: Record<GenreFamily, string> = {
  "Romance": "Romance",
  "MysteryThriller": "Mystery & Thriller",
  "SciFiFantasy": "Science Fiction & Fantasy",
  "Horror": "Horror",
  "LiteraryFiction": "Literary Fiction",
  "YoungAdult": "Young Adult",
  "ChildrenMiddleGrade": "Children's",
  "Nonfiction": "Nonfiction",
};

/**
 * Map a canonical genre string to a genre family
 */
export function mapCanonicalToFamily(canonicalGenre: string | undefined): GenreFamily | null {
  if (!canonicalGenre) return null;
  
  const lower = canonicalGenre.toLowerCase().trim();
  
  // Direct match
  if (CANONICAL_TO_FAMILY[lower]) {
    return CANONICAL_TO_FAMILY[lower];
  }
  
  // Partial match - check if any key is contained in the canonical genre
  for (const [key, family] of Object.entries(CANONICAL_TO_FAMILY)) {
    if (lower.includes(key) || key.includes(lower)) {
      return family;
    }
  }
  
  return null;
}

/**
 * Score an Amazon category path against genre families
 * Returns a map of family -> score (higher = more signals for that family)
 */
export function scorePathByFamilies(path: string): Record<GenreFamily, number> {
  const lower = path.toLowerCase();
  const scores: Record<GenreFamily, number> = {
    "Romance": 0,
    "MysteryThriller": 0,
    "SciFiFantasy": 0,
    "Horror": 0,
    "LiteraryFiction": 0,
    "YoungAdult": 0,
    "ChildrenMiddleGrade": 0,
    "Nonfiction": 0,
  };
  
  for (const [family, patterns] of Object.entries(FAMILY_PATH_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern.toLowerCase())) {
        // Give higher weight to more specific patterns
        const weight = pattern.length > 10 ? 2 : 1;
        scores[family as GenreFamily] += weight;
      }
    }
  }
  
  return scores;
}

/**
 * Find the best genre family match from a list of Amazon paths
 * Returns the family with the highest aggregate score
 */
export function findDominantFamilyFromPaths(paths: string[]): { family: GenreFamily | null; score: number; scores: Record<GenreFamily, number> } {
  const aggregateScores: Record<GenreFamily, number> = {
    "Romance": 0,
    "MysteryThriller": 0,
    "SciFiFantasy": 0,
    "Horror": 0,
    "LiteraryFiction": 0,
    "YoungAdult": 0,
    "ChildrenMiddleGrade": 0,
    "Nonfiction": 0,
  };
  
  for (const path of paths) {
    const pathScores = scorePathByFamilies(path);
    for (const [family, score] of Object.entries(pathScores)) {
      aggregateScores[family as GenreFamily] += score;
    }
  }
  
  // Find the highest-scoring family (excluding LiteraryFiction as a tie-breaker since it's generic)
  let bestFamily: GenreFamily | null = null;
  let bestScore = 0;
  
  for (const [family, score] of Object.entries(aggregateScores)) {
    // Prefer specific families over LiteraryFiction
    if (score > bestScore || (score === bestScore && family !== "LiteraryFiction" && bestFamily === "LiteraryFiction")) {
      bestFamily = family as GenreFamily;
      bestScore = score;
    }
  }
  
  return { family: bestFamily, score: bestScore, scores: aggregateScores };
}

/**
 * Extract the most relevant subgenre from a path for a given family
 * Example: For Romance family and path "Literature & Fiction > Contemporary Fiction > Romance"
 * Returns "Contemporary Romance" instead of "Contemporary Fiction"
 */
function extractSubgenreForFamily(path: string, family: GenreFamily, canonicalGenre?: string): string {
  const lower = path.toLowerCase();
  const segments = path.split(/\s*>\s*/).map(s => s.trim()).filter(Boolean);
  
  // If we have a canonical genre, prefer it as the subgenre label
  if (canonicalGenre) {
    return canonicalGenre;
  }
  
  // Look for family-specific segments in reverse order (most specific first)
  const patterns = FAMILY_PATH_PATTERNS[family] || [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const segmentLower = segments[i].toLowerCase();
    for (const pattern of patterns) {
      if (segmentLower.includes(pattern.toLowerCase())) {
        return segments[i]; // Return the actual segment text (properly cased)
      }
    }
  }
  
  // Fallback: return the last segment
  return segments[segments.length - 1] || FAMILY_SHELF_LABELS[family];
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
 * 
 * NEW GENRE FAMILY APPROACH:
 * 1. canonicalGenre from niche detection is the PRIMARY signal for genre family
 * 2. Amazon category paths SUPPORT or refine that family, but don't override it
 * 3. When a path contains both generic labels ("Literature & Fiction") AND a specific
 *    family signal ("Romance"), the specific family wins
 * 4. Shelf is set to the family's standard label, NOT extracted from the path
 * 
 * @param books - Normalized books with category data
 * @param userCategory - User's selected category (never overridden)
 * @param canonicalNiche - Optional canonical niche anchor to prevent drift
 * @param canonicalGenre - Optional canonical genre from LLM normalization (e.g., "Contemporary Romance")
 */
export function inferGenreFromBooks(
  books: NormalizedBook[],
  userCategory: "fiction" | "nonfiction",
  canonicalNiche?: CanonicalNiche,
  canonicalGenre?: string
): InferredGenre {
  // Cluster and rank category paths
  const { sortedPaths } = inferAmazonCategoryCluster(books);
  
  // Filter paths to remove blocked subcategories (race/ethnicity, Children's for nonfiction, etc.)
  const validPaths = filterValidPrimaryPaths(sortedPaths, userCategory, canonicalNiche);
  
  console.log(`=== GENRE FAMILY INFERENCE ===`);
  console.log(`Total paths: ${sortedPaths.length}`);
  console.log(`Valid primary paths: ${validPaths.length}`);
  if (validPaths.length < sortedPaths.length) {
    console.log(`Blocked paths: ${sortedPaths.length - validPaths.length}`);
  }
  
  // Step 1: Determine canonical family from canonicalGenre or canonicalNiche.expectedGenre
  const canonicalLabel = canonicalGenre || canonicalNiche?.expectedGenre;
  const canonicalFamily = mapCanonicalToFamily(canonicalLabel);
  
  console.log(`Canonical genre: "${canonicalLabel}" → Family: ${canonicalFamily || "none"}`);
  
  // Step 2: Score Amazon paths by genre family
  const pathFamilyResult = findDominantFamilyFromPaths(validPaths);
  
  console.log(`Amazon path family scores:`, pathFamilyResult.scores);
  console.log(`Dominant path family: ${pathFamilyResult.family} (score: ${pathFamilyResult.score})`);
  
  // Step 3: Determine final family - canonical takes precedence if supported by paths
  let finalFamily: GenreFamily;
  let familyConfidence: "high" | "medium" | "low" = "low";
  
  if (canonicalFamily) {
    // Canonical family exists - check if Amazon paths support it
    const canonicalFamilyScore = pathFamilyResult.scores[canonicalFamily];
    const pathDominantScore = pathFamilyResult.score;
    
    if (canonicalFamilyScore > 0) {
      // Amazon paths support the canonical family - use it with high confidence
      finalFamily = canonicalFamily;
      familyConfidence = canonicalFamilyScore >= pathDominantScore ? "high" : "medium";
      console.log(`✅ Using canonical family "${canonicalFamily}" (supported by paths, score: ${canonicalFamilyScore})`);
    } else if (pathFamilyResult.family && pathFamilyResult.family !== "LiteraryFiction" && pathFamilyResult.score > canonicalFamilyScore) {
      // Amazon paths strongly suggest a different family - this might indicate drift
      // Only override canonical if the alternative is a specific family (not LiteraryFiction)
      // AND has significant support
      if (pathFamilyResult.score >= 3) {
        finalFamily = pathFamilyResult.family;
        familyConfidence = "medium";
        console.log(`⚠️ Path family "${pathFamilyResult.family}" overrides canonical "${canonicalFamily}" (strong path signal: ${pathFamilyResult.score})`);
      } else {
        // Weak path signal - stick with canonical
        finalFamily = canonicalFamily;
        familyConfidence = "low";
        console.log(`⚠️ Using canonical family "${canonicalFamily}" despite weak path support (canonical is stronger signal)`);
      }
    } else {
      // No strong path signal - use canonical
      finalFamily = canonicalFamily;
      familyConfidence = "medium";
      console.log(`✅ Using canonical family "${canonicalFamily}" (no conflicting path signal)`);
    }
  } else if (pathFamilyResult.family) {
    // No canonical family - use path-derived family
    finalFamily = pathFamilyResult.family;
    familyConfidence = pathFamilyResult.score >= 3 ? "medium" : "low";
    console.log(`📚 Using path-derived family "${finalFamily}" (no canonical genre)`);
  } else {
    // No signals at all - default based on userCategory
    finalFamily = userCategory === "fiction" ? "LiteraryFiction" : "Nonfiction";
    familyConfidence = "low";
    console.log(`⚠️ Defaulting to "${finalFamily}" (no genre signals)`);
  }
  
  // Step 4: Set shelf based on final family (NOT from path parsing)
  const shelf = FAMILY_SHELF_LABELS[finalFamily];
  
  // Step 5: Set subgenre - prefer canonicalGenre, then extract from paths
  let subgenre: string;
  if (canonicalLabel && mapCanonicalToFamily(canonicalLabel) === finalFamily) {
    // Use canonical genre as subgenre if it matches the family
    subgenre = canonicalLabel;
  } else {
    // Extract subgenre from the best path for this family
    const primaryPath = validPaths.length > 0 ? validPaths[0] : null;
    subgenre = primaryPath 
      ? extractSubgenreForFamily(primaryPath, finalFamily, canonicalLabel)
      : shelf;
  }
  
  // Step 6: Try to extract microgenre from paths
  let microgenre: string | null = null;
  const primaryPath = validPaths.length > 0 ? validPaths[0] : null;
  if (primaryPath) {
    const mapping = findGenreMapping(primaryPath, userCategory);
    if (mapping?.microgenre) {
      microgenre = mapping.microgenre;
    }
  }
  
  // Step 7: Select best primary path for the family
  // Prefer paths that contain family-specific signals
  let amazonPrimaryPath: string | null = null;
  const familyPatterns = FAMILY_PATH_PATTERNS[finalFamily] || [];
  
  for (const path of validPaths) {
    const lower = path.toLowerCase();
    const hasFamilySignal = familyPatterns.some(p => lower.includes(p.toLowerCase()));
    if (hasFamilySignal) {
      amazonPrimaryPath = path;
      break;
    }
  }
  
  // Fallback to first valid path if no family-specific path found
  if (!amazonPrimaryPath && validPaths.length > 0) {
    amazonPrimaryPath = validPaths[0];
  }
  
  const amazonAlternatePaths = validPaths.slice(1, 4);
  
  console.log(`Final genre: family=${finalFamily}, shelf="${shelf}", subgenre="${subgenre}"`);
  
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
