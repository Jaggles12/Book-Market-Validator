// server/genreMap.ts
// Data-driven mapping from Amazon category paths to our internal genre labels

export interface GenreMapping {
  matchContains: string;
  fiction?: {
    shelf: string;
    subgenre: string;
    microgenre: string | null;
  };
  nonfiction?: {
    shelf: string;
    subgenre: string;
    microgenre: string | null;
  };
}

export const GENRE_MAP: GenreMapping[] = [
  // ========== NONFICTION ==========
  
  // Self-Help & Personal Development
  {
    matchContains: "Self-Help > Post-Traumatic Stress Disorder",
    nonfiction: { shelf: "Self-Help", subgenre: "Trauma Recovery", microgenre: "PTSD Recovery" },
  },
  {
    matchContains: "Self-Help > Abuse",
    nonfiction: { shelf: "Self-Help", subgenre: "Trauma Recovery", microgenre: "Abuse Recovery" },
  },
  {
    matchContains: "Self-Help > Anxieties & Phobias",
    nonfiction: { shelf: "Self-Help", subgenre: "Anxiety & Stress", microgenre: null },
  },
  {
    matchContains: "Self-Help > Anger Management",
    nonfiction: { shelf: "Self-Help", subgenre: "Emotional Health", microgenre: "Anger Management" },
  },
  {
    matchContains: "Self-Help > Self-Esteem",
    nonfiction: { shelf: "Self-Help", subgenre: "Self-Esteem", microgenre: null },
  },
  {
    matchContains: "Self-Help > Happiness",
    nonfiction: { shelf: "Self-Help", subgenre: "Happiness & Wellbeing", microgenre: null },
  },
  {
    matchContains: "Self-Help > Motivational",
    nonfiction: { shelf: "Self-Help", subgenre: "Motivation", microgenre: null },
  },
  {
    matchContains: "Self-Help > Personal Transformation",
    nonfiction: { shelf: "Self-Help", subgenre: "Personal Growth", microgenre: null },
  },
  {
    matchContains: "Self-Help > Relationships",
    nonfiction: { shelf: "Self-Help", subgenre: "Relationships", microgenre: null },
  },
  {
    matchContains: "Self-Help > Codependency",
    nonfiction: { shelf: "Self-Help", subgenre: "Relationships", microgenre: "Codependency" },
  },
  {
    matchContains: "Self-Help > Communication Skills",
    nonfiction: { shelf: "Self-Help", subgenre: "Communication", microgenre: null },
  },
  {
    matchContains: "Self-Help > Stress Management",
    nonfiction: { shelf: "Self-Help", subgenre: "Anxiety & Stress", microgenre: "Stress Management" },
  },
  {
    matchContains: "Self-Help > Death & Grief",
    nonfiction: { shelf: "Self-Help", subgenre: "Grief & Loss", microgenre: null },
  },
  {
    matchContains: "Self-Help > Eating Disorders",
    nonfiction: { shelf: "Self-Help", subgenre: "Mental Health", microgenre: "Eating Disorders" },
  },

  // Health & Wellness
  {
    matchContains: "Health, Fitness & Dieting > Mental Health",
    nonfiction: { shelf: "Health & Wellness", subgenre: "Mental Health", microgenre: null },
  },
  {
    matchContains: "Health, Fitness & Dieting > Psychology & Counseling",
    nonfiction: { shelf: "Health & Wellness", subgenre: "Psychology", microgenre: null },
  },
  {
    matchContains: "Health, Fitness & Dieting > Diets & Weight Loss",
    nonfiction: { shelf: "Health & Wellness", subgenre: "Diet & Nutrition", microgenre: null },
  },
  {
    matchContains: "Health, Fitness & Dieting > Exercise & Fitness",
    nonfiction: { shelf: "Health & Wellness", subgenre: "Fitness", microgenre: null },
  },
  {
    matchContains: "Health, Fitness & Dieting > Alternative Medicine",
    nonfiction: { shelf: "Health & Wellness", subgenre: "Alternative Health", microgenre: null },
  },
  {
    matchContains: "Health, Fitness & Dieting > Women's Health",
    nonfiction: { shelf: "Health & Wellness", subgenre: "Women's Health", microgenre: null },
  },
  {
    matchContains: "Health, Fitness & Dieting > Aging",
    nonfiction: { shelf: "Health & Wellness", subgenre: "Healthy Aging", microgenre: null },
  },

  // Business & Money
  {
    matchContains: "Business & Money > Investing > Options",
    nonfiction: { shelf: "Business & Money", subgenre: "Investing", microgenre: "Options Trading" },
  },
  {
    matchContains: "Business & Money > Investing > Stocks",
    nonfiction: { shelf: "Business & Money", subgenre: "Investing", microgenre: "Stock Trading" },
  },
  {
    matchContains: "Business & Money > Investing > Day Trading",
    nonfiction: { shelf: "Business & Money", subgenre: "Investing", microgenre: "Day Trading" },
  },
  {
    matchContains: "Business & Money > Investing > Real Estate",
    nonfiction: { shelf: "Business & Money", subgenre: "Investing", microgenre: "Real Estate Investing" },
  },
  {
    matchContains: "Business & Money > Personal Finance",
    nonfiction: { shelf: "Business & Money", subgenre: "Personal Finance", microgenre: null },
  },
  {
    matchContains: "Business & Money > Small Business & Entrepreneurship",
    nonfiction: { shelf: "Business & Money", subgenre: "Entrepreneurship", microgenre: null },
  },
  {
    matchContains: "Business & Money > Management & Leadership",
    nonfiction: { shelf: "Business & Money", subgenre: "Leadership", microgenre: null },
  },
  {
    matchContains: "Business & Money > Marketing & Sales",
    nonfiction: { shelf: "Business & Money", subgenre: "Marketing", microgenre: null },
  },
  {
    matchContains: "Business & Money > Women & Business",
    nonfiction: { shelf: "Business & Money", subgenre: "Women in Business", microgenre: null },
  },

  // Parenting & Family
  {
    matchContains: "Parenting & Relationships > Parenting",
    nonfiction: { shelf: "Parenting & Family", subgenre: "Parenting", microgenre: null },
  },
  {
    matchContains: "Parenting & Relationships > Family Relationships",
    nonfiction: { shelf: "Parenting & Family", subgenre: "Family", microgenre: null },
  },
  {
    matchContains: "Parenting & Relationships > Parenting > Teenagers",
    nonfiction: { shelf: "Parenting & Family", subgenre: "Parenting", microgenre: "Parenting Teens" },
  },
  {
    matchContains: "Parenting & Relationships > Parenting > Special Needs",
    nonfiction: { shelf: "Parenting & Family", subgenre: "Parenting", microgenre: "Special Needs Parenting" },
  },

  // Cooking & Food
  {
    matchContains: "Cookbooks, Food & Wine",
    nonfiction: { shelf: "Cookbooks", subgenre: "Cooking", microgenre: null },
  },
  {
    matchContains: "Cookbooks, Food & Wine > Baking",
    nonfiction: { shelf: "Cookbooks", subgenre: "Baking", microgenre: null },
  },
  {
    matchContains: "Cookbooks, Food & Wine > Quick & Easy",
    nonfiction: { shelf: "Cookbooks", subgenre: "Quick & Easy Cooking", microgenre: null },
  },
  {
    matchContains: "Cookbooks, Food & Wine > Special Diet",
    nonfiction: { shelf: "Cookbooks", subgenre: "Special Diet", microgenre: null },
  },

  // Religion & Spirituality
  {
    matchContains: "Religion & Spirituality > Christianity",
    nonfiction: { shelf: "Religion & Spirituality", subgenre: "Christianity", microgenre: null },
  },
  {
    matchContains: "Religion & Spirituality > New Age & Spirituality",
    nonfiction: { shelf: "Religion & Spirituality", subgenre: "Spirituality", microgenre: null },
  },
  {
    matchContains: "Religion & Spirituality > Occult & Paranormal",
    nonfiction: { shelf: "Religion & Spirituality", subgenre: "Occult & Paranormal", microgenre: null },
  },

  // Biography & Memoir
  {
    matchContains: "Biographies & Memoirs",
    nonfiction: { shelf: "Biography & Memoir", subgenre: "Memoir", microgenre: null },
  },

  // History
  {
    matchContains: "History > United States",
    nonfiction: { shelf: "History", subgenre: "American History", microgenre: null },
  },
  {
    matchContains: "History > World",
    nonfiction: { shelf: "History", subgenre: "World History", microgenre: null },
  },
  {
    matchContains: "History > Military",
    nonfiction: { shelf: "History", subgenre: "Military History", microgenre: null },
  },

  // Education & Teaching
  {
    matchContains: "Education & Teaching",
    nonfiction: { shelf: "Education", subgenre: "Teaching", microgenre: null },
  },

  // Science
  {
    matchContains: "Science > Psychology",
    nonfiction: { shelf: "Science", subgenre: "Psychology", microgenre: null },
  },

  // ========== FICTION ==========

  // Thriller & Suspense
  {
    matchContains: "Mystery, Thriller & Suspense > Thrillers > Psychological",
    fiction: { shelf: "Thriller", subgenre: "Psychological Thriller", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Thrillers > Suspense",
    fiction: { shelf: "Thriller", subgenre: "Suspense", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Thrillers > Crime",
    fiction: { shelf: "Thriller", subgenre: "Crime Thriller", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Thrillers > Legal",
    fiction: { shelf: "Thriller", subgenre: "Legal Thriller", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Thrillers > Medical",
    fiction: { shelf: "Thriller", subgenre: "Medical Thriller", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Thrillers > Military",
    fiction: { shelf: "Thriller", subgenre: "Military Thriller", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Thrillers > Spy Stories",
    fiction: { shelf: "Thriller", subgenre: "Spy Thriller", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Thrillers > Technothrillers",
    fiction: { shelf: "Thriller", subgenre: "Technothriller", microgenre: null },
  },

  // Mystery
  {
    matchContains: "Mystery, Thriller & Suspense > Mystery > Cozy",
    fiction: { shelf: "Mystery", subgenre: "Cozy Mystery", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Mystery > Hard-Boiled",
    fiction: { shelf: "Mystery", subgenre: "Hard-Boiled Mystery", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Mystery > Police Procedurals",
    fiction: { shelf: "Mystery", subgenre: "Police Procedural", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Mystery > Private Investigators",
    fiction: { shelf: "Mystery", subgenre: "Private Investigator", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Mystery > Women Sleuths",
    fiction: { shelf: "Mystery", subgenre: "Women Sleuths", microgenre: null },
  },
  {
    matchContains: "Mystery, Thriller & Suspense > Mystery > Historical",
    fiction: { shelf: "Mystery", subgenre: "Historical Mystery", microgenre: null },
  },

  // Romance
  {
    matchContains: "Romance > Contemporary",
    fiction: { shelf: "Romance", subgenre: "Contemporary Romance", microgenre: null },
  },
  {
    matchContains: "Romance > Historical",
    fiction: { shelf: "Romance", subgenre: "Historical Romance", microgenre: null },
  },
  {
    matchContains: "Romance > Romantic Suspense",
    fiction: { shelf: "Romance", subgenre: "Romantic Suspense", microgenre: null },
  },
  {
    matchContains: "Romance > Paranormal",
    fiction: { shelf: "Romance", subgenre: "Paranormal Romance", microgenre: null },
  },
  {
    matchContains: "Romance > Fantasy",
    fiction: { shelf: "Romance", subgenre: "Fantasy Romance", microgenre: null },
  },
  {
    matchContains: "Romance > Clean & Wholesome",
    fiction: { shelf: "Romance", subgenre: "Clean Romance", microgenre: null },
  },
  {
    matchContains: "Romance > New Adult & College",
    fiction: { shelf: "Romance", subgenre: "New Adult Romance", microgenre: null },
  },
  {
    matchContains: "Romance > Sports",
    fiction: { shelf: "Romance", subgenre: "Sports Romance", microgenre: null },
  },
  {
    matchContains: "Romance > Billionaires",
    fiction: { shelf: "Romance", subgenre: "Billionaire Romance", microgenre: null },
  },
  {
    matchContains: "Romance > Military",
    fiction: { shelf: "Romance", subgenre: "Military Romance", microgenre: null },
  },
  {
    matchContains: "Romance > LGBTQ+",
    fiction: { shelf: "Romance", subgenre: "LGBTQ+ Romance", microgenre: null },
  },

  // Science Fiction
  {
    matchContains: "Science Fiction & Fantasy > Science Fiction > Space Opera",
    fiction: { shelf: "Science Fiction", subgenre: "Space Opera", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Science Fiction > Dystopian",
    fiction: { shelf: "Science Fiction", subgenre: "Dystopian", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Science Fiction > Post-Apocalyptic",
    fiction: { shelf: "Science Fiction", subgenre: "Post-Apocalyptic", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Science Fiction > Time Travel",
    fiction: { shelf: "Science Fiction", subgenre: "Time Travel", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Science Fiction > Cyberpunk",
    fiction: { shelf: "Science Fiction", subgenre: "Cyberpunk", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Science Fiction > Military",
    fiction: { shelf: "Science Fiction", subgenre: "Military Sci-Fi", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Science Fiction > Hard Science Fiction",
    fiction: { shelf: "Science Fiction", subgenre: "Hard Science Fiction", microgenre: null },
  },

  // Fantasy
  {
    matchContains: "Science Fiction & Fantasy > Fantasy > Epic",
    fiction: { shelf: "Fantasy", subgenre: "Epic Fantasy", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Fantasy > Urban",
    fiction: { shelf: "Fantasy", subgenre: "Urban Fantasy", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Fantasy > Paranormal & Urban",
    fiction: { shelf: "Fantasy", subgenre: "Urban Fantasy", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Fantasy > Dark Fantasy",
    fiction: { shelf: "Fantasy", subgenre: "Dark Fantasy", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Fantasy > Sword & Sorcery",
    fiction: { shelf: "Fantasy", subgenre: "Sword & Sorcery", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Fantasy > Historical",
    fiction: { shelf: "Fantasy", subgenre: "Historical Fantasy", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Fantasy > Fairy Tales",
    fiction: { shelf: "Fantasy", subgenre: "Fairy Tale Retelling", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy > Fantasy > Coming of Age",
    fiction: { shelf: "Fantasy", subgenre: "Coming of Age Fantasy", microgenre: null },
  },

  // Horror
  {
    matchContains: "Literature & Fiction > Horror",
    fiction: { shelf: "Horror", subgenre: "Horror", microgenre: null },
  },
  {
    matchContains: "Literature & Fiction > Horror > Supernatural",
    fiction: { shelf: "Horror", subgenre: "Supernatural Horror", microgenre: null },
  },
  {
    matchContains: "Literature & Fiction > Horror > Occult",
    fiction: { shelf: "Horror", subgenre: "Occult Horror", microgenre: null },
  },

  // Literary Fiction
  {
    matchContains: "Literature & Fiction > Literary Fiction",
    fiction: { shelf: "Literary Fiction", subgenre: "Literary Fiction", microgenre: null },
  },
  {
    matchContains: "Literature & Fiction > Contemporary Fiction",
    fiction: { shelf: "Literary Fiction", subgenre: "Contemporary Fiction", microgenre: null },
  },
  {
    matchContains: "Literature & Fiction > Women's Fiction",
    fiction: { shelf: "Women's Fiction", subgenre: "Women's Fiction", microgenre: null },
  },

  // Historical Fiction
  {
    matchContains: "Literature & Fiction > Historical Fiction",
    fiction: { shelf: "Historical Fiction", subgenre: "Historical Fiction", microgenre: null },
  },

  // Teen & Young Adult
  {
    matchContains: "Teen & Young Adult > Romance",
    fiction: { shelf: "Young Adult", subgenre: "YA Romance", microgenre: null },
  },
  {
    matchContains: "Teen & Young Adult > Science Fiction & Fantasy",
    fiction: { shelf: "Young Adult", subgenre: "YA Fantasy", microgenre: null },
  },
  {
    matchContains: "Teen & Young Adult > Mysteries & Thrillers",
    fiction: { shelf: "Young Adult", subgenre: "YA Mystery", microgenre: null },
  },

  // Action & Adventure
  {
    matchContains: "Literature & Fiction > Action & Adventure",
    fiction: { shelf: "Action & Adventure", subgenre: "Action & Adventure", microgenre: null },
  },

  // General catch-all for Self-Help (less specific)
  {
    matchContains: "Self-Help",
    nonfiction: { shelf: "Self-Help", subgenre: "Personal Development", microgenre: null },
  },

  // General catch-all for fiction genres
  {
    matchContains: "Mystery, Thriller & Suspense",
    fiction: { shelf: "Thriller", subgenre: "Thriller & Suspense", microgenre: null },
  },
  {
    matchContains: "Romance",
    fiction: { shelf: "Romance", subgenre: "Romance", microgenre: null },
  },
  {
    matchContains: "Science Fiction & Fantasy",
    fiction: { shelf: "Science Fiction & Fantasy", subgenre: "Sci-Fi & Fantasy", microgenre: null },
  },
];

/**
 * Find matching genre mapping for a given Amazon category path
 * Returns the most specific match (longest matchContains string)
 */
export function findGenreMapping(
  amazonPath: string,
  userCategory: "fiction" | "nonfiction"
): GenreMapping["fiction"] | GenreMapping["nonfiction"] | null {
  if (!amazonPath) return null;

  const pathLower = amazonPath.toLowerCase();
  
  // Find all matching entries
  const matches = GENRE_MAP.filter((entry) => {
    const matchLower = entry.matchContains.toLowerCase();
    return pathLower.includes(matchLower);
  });

  if (matches.length === 0) return null;

  // Sort by specificity (longest match first)
  matches.sort((a, b) => b.matchContains.length - a.matchContains.length);

  // Return the mapping for the user's category if it exists
  for (const match of matches) {
    if (userCategory === "fiction" && match.fiction) {
      return match.fiction;
    }
    if (userCategory === "nonfiction" && match.nonfiction) {
      return match.nonfiction;
    }
  }

  return null;
}
