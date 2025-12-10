import { CanonicalNiche, SearchTermCandidate, NicheProfile, AudienceProfile } from "./types";

const GENRE_KEYWORDS: Record<string, { 
  keywords: string[]; 
  category: "fiction" | "nonfiction";
  validCategories: string[];
  invalidCategories: string[];
}> = {
  "Self-Help": {
    keywords: ["self-help", "self help", "personal development", "personal growth", "self improvement", "motivation", "mindset", "life change", "transformation", "habits", "goals", "purpose", "meaning", "fulfillment"],
    category: "nonfiction",
    validCategories: ["Self-Help", "Personal Transformation", "Motivation", "Success", "Happiness", "Personal Growth"],
    invalidCategories: ["New Age", "Divination", "Occult", "Fiction", "Romance", "Mystery"]
  },
  "Business": {
    keywords: ["business", "entrepreneur", "startup", "marketing", "leadership", "management", "sales", "finance", "investing", "money", "wealth", "career", "productivity", "side hustle"],
    category: "nonfiction",
    validCategories: ["Business", "Entrepreneurship", "Marketing", "Leadership", "Management", "Money", "Investing", "Career"],
    invalidCategories: ["Fiction", "Romance", "New Age"]
  },
  "Health & Wellness": {
    keywords: ["health", "wellness", "fitness", "diet", "nutrition", "weight loss", "exercise", "mental health", "anxiety", "depression", "healing", "recovery", "medical"],
    category: "nonfiction",
    validCategories: ["Health", "Fitness", "Diets", "Mental Health", "Wellness", "Nutrition"],
    invalidCategories: ["Fiction", "Romance"]
  },
  "Parenting & Family": {
    keywords: ["parenting", "parent", "child", "children", "family", "mom", "dad", "mother", "father", "baby", "toddler", "teen", "raising"],
    category: "nonfiction",
    validCategories: ["Parenting", "Family", "Motherhood", "Fatherhood", "Child Development"],
    invalidCategories: ["Fiction", "Romance"]
  },
  "Relationships": {
    keywords: ["relationship advice", "marriage advice", "dating advice", "couples therapy", "communication skills", "intimacy guide", "divorce recovery", "breakup recovery", "relationship help"],
    category: "nonfiction",
    validCategories: ["Relationships", "Marriage", "Dating", "Love", "Communication"],
    invalidCategories: ["Romance Fiction", "Erotica"]
  },
  "Spirituality": {
    keywords: ["spiritual", "spirituality", "soul", "meditation", "mindfulness", "consciousness", "awakening", "enlightenment"],
    category: "nonfiction",
    validCategories: ["Spirituality", "Meditation", "Mindfulness", "Personal Transformation"],
    invalidCategories: ["Fiction", "Romance"]
  },
  "Religion": {
    keywords: ["christian", "faith", "god", "jesus", "bible", "church", "prayer", "devotional", "biblical", "religious"],
    category: "nonfiction",
    validCategories: ["Religion", "Christian", "Faith", "Devotional", "Bible Study", "Spirituality"],
    invalidCategories: ["Fiction", "Romance", "New Age", "Occult"]
  },
  "Cookbook": {
    keywords: ["cookbook", "recipes", "cooking", "baking", "kitchen", "meal", "food"],
    category: "nonfiction",
    validCategories: ["Cookbooks", "Food", "Cooking", "Baking"],
    invalidCategories: ["Fiction", "Romance"]
  },
  "Romance": {
    keywords: ["romance", "love story", "romantic", "love interest", "happily ever after", "hea"],
    category: "fiction",
    validCategories: ["Romance", "Contemporary Romance", "Historical Romance", "Romantic Comedy"],
    invalidCategories: ["Self-Help", "Business", "Nonfiction"]
  },
  "Mystery": {
    keywords: ["mystery", "detective", "crime", "whodunit", "sleuth", "investigation", "murder"],
    category: "fiction",
    validCategories: ["Mystery", "Detective", "Crime Fiction", "Cozy Mystery", "Thriller"],
    invalidCategories: ["Romance", "Self-Help", "Nonfiction"]
  },
  "Thriller": {
    keywords: ["thriller", "suspense", "psychological thriller", "action", "espionage", "spy"],
    category: "fiction",
    validCategories: ["Thriller", "Suspense", "Psychological Thriller", "Action", "Espionage"],
    invalidCategories: ["Romance", "Self-Help", "Nonfiction"]
  },
  "Fantasy": {
    keywords: ["fantasy", "magic", "wizard", "dragon", "epic fantasy", "urban fantasy", "supernatural"],
    category: "fiction",
    validCategories: ["Fantasy", "Epic Fantasy", "Urban Fantasy", "Paranormal", "Supernatural"],
    invalidCategories: ["Self-Help", "Business", "Nonfiction"]
  },
  "Science Fiction": {
    keywords: ["sci-fi", "science fiction", "space", "alien", "future", "dystopia", "cyberpunk"],
    category: "fiction",
    validCategories: ["Science Fiction", "Space Opera", "Dystopian", "Cyberpunk", "Futuristic"],
    invalidCategories: ["Self-Help", "Business", "Nonfiction"]
  },
  "Children's": {
    keywords: ["children", "kids", "picture book", "bedtime", "ages 3", "ages 4", "ages 5", "preschool", "kindergarten"],
    category: "fiction",
    validCategories: ["Children's Books", "Picture Books", "Early Readers", "Kids"],
    invalidCategories: ["Adult", "Romance", "Thriller", "Horror"]
  },
  "Memoir": {
    keywords: ["memoir", "autobiography", "my story", "my life", "personal story", "life story"],
    category: "nonfiction",
    validCategories: ["Memoir", "Autobiography", "Biography", "Personal Narratives"],
    invalidCategories: ["Fiction", "Romance"]
  }
};

const WORLDVIEW_INDICATORS = {
  secular: ["science-based", "evidence-based", "research", "practical", "proven", "data"],
  spiritual: ["spiritual", "soul", "universe", "energy", "consciousness", "meditation", "mindfulness"],
  religious: ["christian", "faith", "god", "jesus", "bible", "prayer", "church", "biblical", "devotional"],
  mixed: []
};

const DOMAIN_EXTRACTORS: Record<string, string[]> = {
  "personal transformation": ["transformation", "change", "growth", "evolve", "become", "journey"],
  "motivation": ["motivation", "inspire", "driven", "ambitious", "goal"],
  "purpose": ["purpose", "meaning", "calling", "destiny", "mission"],
  "productivity": ["productivity", "efficiency", "time management", "habits", "routine"],
  "mindset": ["mindset", "thinking", "beliefs", "attitude", "mental"],
  "success": ["success", "achieve", "accomplish", "winning", "results"],
  "happiness": ["happiness", "joy", "fulfillment", "satisfaction", "contentment"],
  "leadership": ["leadership", "leader", "team", "influence", "authority"],
  "entrepreneurship": ["entrepreneur", "startup", "business owner", "founder", "venture"],
  "marketing": ["marketing", "brand", "audience", "customers", "sales"],
  "finance": ["money", "wealth", "investing", "financial", "income"],
  "health": ["health", "wellness", "fitness", "body", "physical"],
  "mental health": ["anxiety", "depression", "stress", "mental health", "emotional"],
  "relationships": ["relationship", "marriage", "dating", "partner", "love"],
  "parenting": ["parenting", "children", "kids", "family", "raising"],
  "creativity": ["creative", "creativity", "art", "writing", "innovation"]
};

export function deriveCanonicalNiche(
  rawIdea: string,
  nicheProfile?: NicheProfile,
  audienceProfile?: AudienceProfile,
  lockedCategory?: "fiction" | "nonfiction"
): CanonicalNiche {
  const lower = rawIdea.toLowerCase();
  
  // Determine the category constraint from lockedCategory or nicheProfile
  const categoryHint = lockedCategory || nicheProfile?.category;
  
  let expectedGenre = categoryHint === "fiction" ? "General Fiction" : "General Nonfiction";
  let category: "fiction" | "nonfiction" = categoryHint || "nonfiction";
  let validAmazonCategories: string[] = [];
  let invalidCategories: string[] = [];
  
  // Two-pass matching: first pass prioritizes genres matching the locked category
  // This prevents nonfiction genres (like "Relationships") from hijacking fiction prompts
  type GenreMatch = { genre: string; config: typeof GENRE_KEYWORDS[string]; matchCount: number };
  const allMatches: GenreMatch[] = [];
  
  for (const [genre, config] of Object.entries(GENRE_KEYWORDS)) {
    const matchCount = config.keywords.filter(kw => lower.includes(kw)).length;
    if (matchCount > 0) {
      allMatches.push({ genre, config, matchCount });
    }
  }
  
  // Sort: prefer matches that align with the locked category, then by match count
  if (categoryHint) {
    allMatches.sort((a, b) => {
      const aMatchesCategory = a.config.category === categoryHint ? 1 : 0;
      const bMatchesCategory = b.config.category === categoryHint ? 1 : 0;
      // First priority: matches locked category
      if (aMatchesCategory !== bMatchesCategory) {
        return bMatchesCategory - aMatchesCategory;
      }
      // Second priority: more keyword matches
      return b.matchCount - a.matchCount;
    });
  }
  
  // Use the best match (category-aligned, highest match count)
  if (allMatches.length > 0) {
    const best = allMatches[0];
    expectedGenre = best.genre;
    category = best.config.category;
    validAmazonCategories = best.config.validCategories;
    invalidCategories = best.config.invalidCategories;
    
    // Log when we prioritize a category-aligned match over a higher-count match
    if (allMatches.length > 1 && categoryHint) {
      const alternates = allMatches.slice(1).filter(m => m.matchCount >= best.matchCount);
      if (alternates.length > 0) {
        console.log(`[CanonicalNiche] Prioritized "${best.genre}" (${best.config.category}) over ${alternates.map(a => `"${a.genre}"`).join(", ")} due to category lock "${categoryHint}"`);
      }
    }
  }
  
  // If nicheProfile provides a category and it differs from the matched genre's category,
  // this indicates a potential mismatch. The locked category should take precedence.
  if (nicheProfile && nicheProfile.category !== category && categoryHint) {
    category = categoryHint;
  }
  
  let worldview: "secular" | "spiritual" | "religious" | "mixed" = "secular";
  if (WORLDVIEW_INDICATORS.religious.some(kw => lower.includes(kw))) {
    worldview = "religious";
  } else if (WORLDVIEW_INDICATORS.spiritual.some(kw => lower.includes(kw))) {
    worldview = "spiritual";
  } else if (WORLDVIEW_INDICATORS.secular.some(kw => lower.includes(kw))) {
    worldview = "secular";
  } else {
    worldview = "mixed";
  }
  
  const expectedDomains: string[] = [];
  for (const [domain, keywords] of Object.entries(DOMAIN_EXTRACTORS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      expectedDomains.push(domain);
    }
  }
  
  if (expectedDomains.length === 0) {
    if (nicheProfile?.subtype) {
      expectedDomains.push(nicheProfile.subtype);
    }
    if (nicheProfile?.topic) {
      expectedDomains.push(nicheProfile.topic);
    }
  }
  
  const ageGroup = audienceProfile?.ageGroup || "adult";
  let audienceFocus: string | undefined;
  
  if (lower.includes("women") || lower.includes("moms") || lower.includes("mothers")) {
    audienceFocus = "women";
  } else if (lower.includes("men") || lower.includes("dads") || lower.includes("fathers")) {
    audienceFocus = "men";
  } else if (lower.includes("entrepreneur")) {
    audienceFocus = "entrepreneurs";
  } else if (lower.includes("professional")) {
    audienceFocus = "professionals";
  }
  
  return {
    expectedGenre,
    expectedDomains,
    worldview,
    audience: {
      ageGroup,
      focus: audienceFocus
    },
    category,
    validAmazonCategories,
    invalidCategories
  };
}

export function generateSearchTermsFromNiche(
  niche: CanonicalNiche,
  nicheProfile?: NicheProfile
): SearchTermCandidate[] {
  const candidates: SearchTermCandidate[] = [];
  
  const genreTerms: Record<string, string[]> = {
    "Self-Help": ["self help books", "personal development books", "self improvement"],
    "Business": ["business books", "entrepreneur books", "business strategy"],
    "Health & Wellness": ["health books", "wellness books", "fitness books"],
    "Parenting & Family": ["parenting books", "family books", "raising children books"],
    "Relationships": ["relationship books", "marriage books", "dating advice books"],
    "Spirituality": ["spirituality books", "meditation books", "mindfulness books"],
    "Religion": ["christian books", "faith books", "devotional books"],
    "Cookbook": ["cookbook", "recipe book", "cooking book"],
    "Romance": ["romance novels", "contemporary romance", "love story"],
    "Mystery": ["mystery novels", "detective fiction", "crime novels"],
    "Thriller": ["thriller novels", "suspense books", "psychological thriller"],
    "Fantasy": ["fantasy novels", "epic fantasy books", "fantasy fiction"],
    "Science Fiction": ["science fiction books", "sci-fi novels", "space opera"],
    "Children's": ["children's books", "picture books", "kids books"],
    "Memoir": ["memoir books", "autobiography", "personal story"]
  };
  
  const genreSpecificTerms = genreTerms[niche.expectedGenre] || [];
  genreSpecificTerms.forEach((term, idx) => {
    candidates.push({
      term,
      source: "niche",
      priority: idx + 1
    });
  });
  
  niche.expectedDomains.slice(0, 3).forEach((domain, idx) => {
    const term = `${domain} books`;
    candidates.push({
      term,
      source: "domain",
      priority: genreSpecificTerms.length + idx + 1
    });
    
    if (niche.expectedGenre !== "General Nonfiction") {
      const combinedTerm = `${domain} ${niche.expectedGenre.toLowerCase()}`;
      candidates.push({
        term: combinedTerm,
        source: "domain",
        priority: genreSpecificTerms.length + idx + 2
      });
    }
  });
  
  if (nicheProfile?.topic && nicheProfile.topic.length > 0) {
    candidates.push({
      term: `${nicheProfile.topic} books`,
      source: "topic",
      priority: candidates.length + 1
    });
  }
  
  if (candidates.length === 0) {
    candidates.push({
      term: niche.category === "fiction" ? "fiction books" : "nonfiction books",
      source: "niche",
      priority: 1
    });
  }
  
  const seen = new Set<string>();
  return candidates
    .filter(c => {
      const normalized = c.term.toLowerCase().trim();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 5);
}

export function scoreCategoryAlignment(
  categoryPath: string,
  niche: CanonicalNiche
): { score: number; isDrift: boolean; reason?: string } {
  const lowerPath = categoryPath.toLowerCase();
  
  for (const invalid of niche.invalidCategories) {
    if (lowerPath.includes(invalid.toLowerCase())) {
      return {
        score: 0,
        isDrift: true,
        reason: `Category "${categoryPath}" contains "${invalid}" which is invalid for ${niche.expectedGenre}`
      };
    }
  }
  
  for (const valid of niche.validAmazonCategories) {
    if (lowerPath.includes(valid.toLowerCase())) {
      return {
        score: 1.0,
        isDrift: false
      };
    }
  }
  
  if (niche.category === "fiction" && lowerPath.includes("fiction")) {
    return { score: 0.7, isDrift: false };
  }
  if (niche.category === "nonfiction" && !lowerPath.includes("fiction")) {
    return { score: 0.5, isDrift: false };
  }
  
  return { score: 0.3, isDrift: false };
}

export function computeSearchResultPurity(
  books: { amazonCategoryPaths?: string[]; semanticScore?: number; relevanceBucket?: string }[],
  niche: CanonicalNiche
): { categoryPurity: number; domainAlignment: number; coreCount: number; driftBooks: number } {
  if (books.length === 0) {
    return { categoryPurity: 0, domainAlignment: 0, coreCount: 0, driftBooks: 0 };
  }
  
  let totalCategoryScore = 0;
  let booksWithCategories = 0;
  let driftBooks = 0;
  
  for (const book of books) {
    if (book.amazonCategoryPaths && book.amazonCategoryPaths.length > 0) {
      let bestScore = 0;
      let hasDrift = false;
      
      for (const path of book.amazonCategoryPaths) {
        const result = scoreCategoryAlignment(path, niche);
        if (result.score > bestScore) {
          bestScore = result.score;
        }
        if (result.isDrift) {
          hasDrift = true;
        }
      }
      
      totalCategoryScore += bestScore;
      booksWithCategories++;
      
      if (hasDrift && bestScore < 0.5) {
        driftBooks++;
      }
    }
  }
  
  const categoryPurity = booksWithCategories > 0 
    ? totalCategoryScore / booksWithCategories 
    : 0;
  
  const coreBooks = books.filter(b => b.relevanceBucket === "core");
  const coreCount = coreBooks.length;
  
  const avgSemanticScore = books.reduce((sum, b) => sum + (b.semanticScore || 0), 0) / books.length;
  
  return {
    categoryPurity,
    domainAlignment: avgSemanticScore,
    coreCount,
    driftBooks
  };
}
