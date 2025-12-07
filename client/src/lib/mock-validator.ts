// Mock Logic for Book Validator
// Ported and adapted for Client-Side Simulation

export type Book = {
  title: string;
  author: string;
  price: number;
  rating: number;
  reviews: number;
  rank: number;
  image?: string | null;
  coverColor: string;
  publicationYear: number;
};

export type TitleIdea = {
  title: string;
  subtitle: string;
  hook?: string;
};

export type BlueprintChapter = {
  title: string;
  purpose: string;
  notes: string;
};

export type BlueprintSection = {
  title: string;
  description: string;
  chapters: BlueprintChapter[];
};

export type BlueprintConstraints = {
  word_count_target: number;
  reading_level: string;
  timeframe: string;
};

export type BlueprintStructure = {
  overview: string;
  sections: BlueprintSection[];
};

export type BookBlueprint = {
  working_title: string;
  subtitle: string;
  core_promise: string;
  ideal_reader: string;
  differentiation: string;
  format: string;
  constraints: BlueprintConstraints;
  structure: BlueprintStructure;
  voice_and_style: string;
  comparable_titles: string;
  positioning_notes: string;
  primary_keywords: string[];
  whitespace_keywords: string[];
};

export type NicheOpportunities = {
  intro: string;
  items: string[];
};

export type DeepAnalysis = {
  nicheOpportunities?: NicheOpportunities;
  formatGaps?: string[];
  idealReader?: {
    demographics?: string;
    psychographics?: string;
    painPoints?: string[];
    desiredOutcome?: string;
  } | string;
  positioningStatement?: string;
  differentiationAngles?: string[];
  coreKeywords?: string[];
  whiteSpaceKeywords?: string[];
  suggestedCategories?: string[];
  bookBlueprint?: BookBlueprint;
  titleIdeas?: TitleIdea[];
  nextSteps?: string[];
};

export type MarketAnalysis = {
  verdict: "GREEN" | "YELLOW" | "RED";
  verdictReason: string;
  genre: { category: string; subtype: string };
  friendlyGenreLabel?: string;
  isDemo?: boolean;
  searchTerm?: string | null;
  stats: {
    avgPrice: number;
    avgRating: number;
    competitionLevel: "Low" | "Medium" | "High";
    demandLevel: "Low" | "Medium" | "High";
  };
  detailedStats: {
    totalBooks: number;
    avgReviews: number;
    priceMin: number;
    priceMax: number;
    priceMedian: number;
    strongCompetitors: number; // Reviews > 1000
    midCompetitors: number;    // Reviews 100-1000
    lowReviewBooks: number;    // Reviews < 50
    bsrBuckets: {
      veryStrong: number; // < 10k
      strong: number;     // 10k - 100k
      moderate: number;   // 100k - 300k
      weak: number;       // > 300k
    };
    dominantAuthors: { name: string; count: number }[];
    evergreenSignal: boolean;
    cheapBookShare: number;
    premiumBookShare: number;
  };
  books: Book[];
  suggestions: string[];
  deepAnalysis?: DeepAnalysis;
};

// 1. Genre Detection (Copied from source)
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

// 2. Generate Mock Books based on Genre
function generateMockBooks(genre: { category: string; subtype: string }, count: number = 20): Book[] {
  const titles = {
    fantasy: ["The Crystal Crown", "Dragon's Oath", "Shadows of Eldoria", "Mage's Lament", "The Void Walker", "Elven Legacy", "Dark Tower", "Mystic River", "Storm Caller", "Kingslayer"],
    romance: ["Love in Paris", "The Billionaire's Secret", "Heartstrings", "Summer Love", "Forever Yours", "Secret Crush", "Wedding Bells", "Italian Summer", "Midnight Kiss", "Second Chance"],
    business: ["Startup 101", "The CEO Mindset", "Growth Hacking", "Scale Up", "Profit First", "Market Leader", "Sales Mastery", "Team Building", "Deep Work Guide", "Zero to One Redux"],
    devotional: ["Morning Grace", "Daily Walk", "30 Days of Peace", "Faith & Fire", "Quiet Waters", "Spirit Lead", "Prayers for Today", "Walking in Light", "Grace Abounds", "Sunday Morning"],
    general: ["The Guide to Life", "Understanding Everything", "The Big Book", "Secrets Revealed", "Path to Wisdom", "Modern Life", "Future Trends", "History of Now", "Why We Sleep", "Habit Forming"],
  };

  const baseTitles = titles[genre.subtype as keyof typeof titles] || titles.general;
  const currentYear = new Date().getFullYear();
  
  return Array.from({ length: count }).map((_, i) => {
    const baseTitle = baseTitles[i % baseTitles.length];
    // Simulate author dominance: Author A gets ~20% of books, Author B gets ~10%
    let authorName;
    if (i < 5) authorName = "J.K. Rowlling-esque"; // 5 books (Dominant)
    else if (i < 8) authorName = "James Patterson-ish"; // 3 books (Dominant)
    else authorName = `Author ${String.fromCharCode(65 + Math.floor(i / 2))}`;

    return {
      title: `${baseTitle} ${i > 9 ? "Vol. " + (i-8) : ""}`,
      author: authorName,
      price: Math.floor(Math.random() * 20) + 2.99,
      rating: 3.0 + Math.random() * 2.0, // 3.0 to 5.0
      reviews: Math.floor(Math.pow(Math.random(), 3) * 5000) + 5, // Skew towards lower reviews with some huge hits
      rank: Math.floor(Math.pow(Math.random(), 2) * 500000) + 500, // Skew towards lower ranks (better sales)
      coverColor: `hsl(${Math.random() * 360}, 70%, 80%)`,
      publicationYear: currentYear - Math.floor(Math.random() * 5),
    };
  });
}

// 3. Main Validation Function (Async Simulation)
export async function validateBookIdea(idea: string): Promise<MarketAnalysis> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const genre = detectGenre(idea);
      const books = generateMockBooks(genre, 25);
      
      // Calculate Detailed Stats
      const prices = books.map(b => b.price).sort((a, b) => a - b);
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const avgRating = books.reduce((a, b) => a + b.rating, 0) / books.length;
      const avgReviews = books.reduce((a, b) => a + b.reviews, 0) / books.length;

      const strongCompetitors = books.filter(b => b.reviews >= 1000).length;
      const midCompetitors = books.filter(b => b.reviews >= 100 && b.reviews < 1000).length;
      const lowReviewBooks = books.filter(b => b.reviews < 50).length;

      const bsrBuckets = {
        veryStrong: books.filter(b => b.rank <= 10000).length,
        strong: books.filter(b => b.rank > 10000 && b.rank <= 100000).length,
        moderate: books.filter(b => b.rank > 100000 && b.rank <= 300000).length,
        weak: books.filter(b => b.rank > 300000).length,
      };

      // Author Dominance
      const authorCounts: Record<string, number> = {};
      books.forEach(b => { authorCounts[b.author] = (authorCounts[b.author] || 0) + 1; });
      const dominantAuthors = Object.entries(authorCounts)
        .filter(([_, count]) => count >= 3)
        .map(([name, count]) => ({ name, count }));

      const cheapBookShare = books.filter(b => b.price <= 2.99).length / books.length;
      const premiumBookShare = books.filter(b => b.price >= 15).length / books.length;

      const currentYear = new Date().getFullYear();
      const recentBooks = books.filter(b => b.publicationYear >= currentYear - 1).length;
      const oldBooks = books.filter(b => b.publicationYear <= currentYear - 5).length;
      const evergreenSignal = recentBooks > 0 && oldBooks > 0;

      // Simple Deterministic Logic for Demo
      let verdict: "GREEN" | "YELLOW" | "RED" = "YELLOW";
      let verdictReason = "Mixed signals. Some demand and some competition — success depends on a clear angle.";
      let suggestions = [
        "Decide whether your central conflict is primarily internal (emotional/psychological), external (an antagonist or system), or relational (between key characters).",
        "Choose the protagonist archetype that best fits your niche—consider what type of character will resonate most with your target readers.",
        "Determine your book's core transformation: what specific change will readers experience from the opening to the final chapter?"
      ];

      if (idea.toLowerCase().includes("unicorn") || idea.toLowerCase().includes("billionaire")) {
        verdict = "GREEN";
        verdictReason = "High demand detected! This niche is currently trending with strong sales velocity across multiple authors.";
        suggestions = [
          "Decide on your protagonist's fatal flaw or secret vulnerability that creates tension beneath their glamorous exterior.",
          "Choose the power dynamic that drives your romance—will it be an enemies-to-lovers arc, a forbidden attraction, or a slow-burn revelation?",
          "Determine the emotional stakes beyond the relationship: what does your protagonist stand to lose if they choose love?"
        ];
      } else if (idea.toLowerCase().includes("poetry") || idea.toLowerCase().includes("memoir")) {
        verdict = "RED";
        verdictReason = "This is a very saturated market with low organic discoverability and high author dominance.";
        suggestions = [
          "Decide on your unifying theme or through-line—the single emotional or thematic thread that ties your pieces together.",
          "Choose your structural approach: chronological journey, thematic sections, or an unconventional organizing principle.",
          "Define your unique lens or perspective—what life experience or worldview makes your voice distinct from other voices in this space?"
        ];
      }

      const deepAnalysis: DeepAnalysis = {
        nicheOpportunities: {
          intro: `This ${genre.subtype} niche has several underexplored angles that could help a new book stand out from competitors.`,
          items: [
            `Stories centering ${genre.subtype} protagonists who face unconventional challenges or come from underrepresented backgrounds.`,
            `Settings that blend ${genre.category} tropes with fresh, contemporary environments readers haven't seen before.`,
            `Hybrid-genre approaches combining ${genre.subtype} with adjacent genres for crossover appeal and broader reach.`,
            `Specific audience segments (busy professionals, new parents, career changers) hungry for ${genre.subtype} content tailored to their situation.`,
            `Emotional territories—vulnerability, ambition, belonging—that competitors have only touched on superficially.`
          ]
        },
        formatGaps: [
          "30-day structured programs are underrepresented",
          "Interactive workbook companions are lacking",
          "Audio-first content with journal supplements",
          "Visual learner editions with infographics",
        ],
        idealReader: {
          demographics: "Adults 25-55, primarily women, college-educated, middle income",
          psychographics: "Values personal growth, seeks practical solutions, time-conscious",
          painPoints: [
            "Overwhelmed by information overload",
            "Struggling to implement advice from other books",
            "Wants structured, step-by-step guidance",
            "Needs accountability and measurable progress",
          ],
          desiredOutcome: "Clear transformation with tangible daily habits and visible progress markers",
        },
        positioningStatement: `The only ${genre.subtype} book that combines practical daily exercises with proven frameworks for lasting change.`,
        differentiationAngles: [
          "Include weekly progress checkpoints unlike competitors",
          "Add QR codes linking to bonus video content",
          "Feature real reader success stories and testimonials",
          "Provide a companion mobile app or PDF tracker",
          "Offer a money-back guarantee mentioned on cover",
          "Partner with influencers for endorsement quotes",
        ],
        coreKeywords: [
          genre.subtype,
          `${genre.subtype} book`,
          `${genre.category} guide`,
          "self improvement",
          "personal development",
          "daily habits",
          "30 day challenge",
          "workbook",
          "journal",
          "transformation",
        ],
        whiteSpaceKeywords: [
          `${genre.subtype} for beginners`,
          `simple ${genre.subtype}`,
          `${genre.subtype} workbook`,
          `${genre.subtype} journal`,
          `quick ${genre.subtype}`,
          `modern ${genre.subtype}`,
        ],
        suggestedCategories: [
          `Books > ${genre.category === 'fiction' ? 'Literature & Fiction' : 'Self-Help'}`,
          `Books > ${genre.category === 'fiction' ? 'Genre Fiction' : 'Personal Transformation'}`,
          `Kindle eBooks > ${genre.category === 'fiction' ? 'Fiction' : 'Health, Fitness & Dieting'}`,
          `Books > Reference > Journals & Workbooks`,
        ],
        bookBlueprint: {
          working_title: `The 30-Day ${genre.subtype.charAt(0).toUpperCase() + genre.subtype.slice(1)} Blueprint`,
          subtitle: `A Practical Guide for ${genre.subtype.charAt(0).toUpperCase() + genre.subtype.slice(1)} Success`,
          core_promise: `This book helps readers who struggle with ${genre.subtype} transform their approach through practical, actionable guidance over a structured 30-day program.`,
          ideal_reader: `Adults 25-55 seeking personal growth in ${genre.subtype}. Self-motivated learners who value practical solutions over theory. They feel overwhelmed by information and need clear, step-by-step direction.`,
          differentiation: `Unlike other ${genre.subtype} books, this guide combines theory with hands-on exercises, real-world case studies, and a structured daily format that ensures consistent progress.`,
          format: "30-day structured guide with daily lessons, practical exercises, and reflection prompts",
          constraints: {
            word_count_target: 25000,
            reading_level: "Adult popular nonfiction",
            timeframe: "30 days"
          },
          structure: {
            overview: "The book is organized into four progressive sections that build upon each other, taking the reader from foundational concepts through mastery.",
            sections: [
              {
                title: "Foundation Week",
                description: "Building core understanding and mindset shifts",
                chapters: [
                  { title: "Understanding the Basics", purpose: "Introduce key concepts", notes: "Core definitions, success stories" },
                  { title: "Preparing for Change", purpose: "Help reader assess and set goals", notes: "Self-assessment, goal-setting" }
                ]
              },
              {
                title: "Implementation Phase",
                description: "Daily practice and habit formation",
                chapters: [
                  { title: "Core Techniques", purpose: "Teach fundamental methods", notes: "Step-by-step instructions" },
                  { title: "Building Momentum", purpose: "Develop consistent practice", notes: "Daily routines, progress tracking" }
                ]
              },
              {
                title: "Integration Week",
                description: "Long-term sustainability strategies",
                chapters: [
                  { title: "Advanced Strategies", purpose: "Take skills to next level", notes: "Expert techniques" },
                  { title: "Sustaining Success", purpose: "Create lasting habits", notes: "Habit formation, review schedules" }
                ]
              }
            ]
          },
          voice_and_style: "Warm, encouraging, and practical. Uses conversational language with clear explanations.",
          comparable_titles: `Similar to popular ${genre.category} guides but with more structured daily format and hands-on exercises.`,
          positioning_notes: `Positioned as a practical, accessible entry point for readers new to ${genre.subtype}.`,
          primary_keywords: [genre.subtype, `${genre.subtype} book`, `${genre.category} guide`],
          whitespace_keywords: [`${genre.subtype} for beginners`, `${genre.subtype} workbook`]
        },
        titleIdeas: [
          {
            title: `The 30-Day ${genre.subtype.charAt(0).toUpperCase() + genre.subtype.slice(1)} Challenge`,
            subtitle: "A Daily Guide to Lasting Transformation",
            hook: "Transform your life in just 30 days with this proven system",
          },
          {
            title: `${genre.subtype.charAt(0).toUpperCase() + genre.subtype.slice(1)} Made Simple`,
            subtitle: "The Busy Person's Guide to Real Results",
            hook: "Finally, a practical approach that fits your schedule",
          },
          {
            title: `Unlock Your ${genre.subtype.charAt(0).toUpperCase() + genre.subtype.slice(1)} Potential`,
            subtitle: "Daily Exercises for Breakthrough Growth",
            hook: "Small daily actions that create massive results",
          },
          {
            title: `The ${genre.subtype.charAt(0).toUpperCase() + genre.subtype.slice(1)} Workbook`,
            subtitle: "Interactive Exercises for Personal Mastery",
            hook: "Write your way to transformation",
          },
          {
            title: `Rise & ${genre.subtype.charAt(0).toUpperCase() + genre.subtype.slice(1)}`,
            subtitle: "Morning Rituals for Daily Success",
            hook: "Start each day with purpose and clarity",
          },
        ],
      };

      const mockSearchTerm = idea.length > 30 || idea.includes(":") 
        ? `${genre.subtype} books` 
        : null;

      // Generate friendly genre label for mock data
      const subtypeLabels: Record<string, string> = {
        fantasy: "Fantasy Fiction",
        romance: "Romance Fiction",
        mystery: "Mystery & Suspense",
        business: "Business & Finance",
        devotional: "Daily Devotional",
        parenting: "Parenting & Family",
        mental_health: "Mental Health & Wellness",
        journal: "Journal & Workbook",
        workbook: "Interactive Workbook",
        general: "General Nonfiction",
      };
      const friendlyGenreLabel = mockSearchTerm 
        ? mockSearchTerm.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : (subtypeLabels[genre.subtype] || genre.subtype.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));

      resolve({
        verdict,
        verdictReason,
        genre,
        friendlyGenreLabel,
        searchTerm: mockSearchTerm,
        stats: {
          avgPrice,
          avgRating,
          competitionLevel: strongCompetitors > 5 ? "High" : strongCompetitors > 2 ? "Medium" : "Low",
          demandLevel: bsrBuckets.veryStrong + bsrBuckets.strong > 5 ? "High" : "Medium",
        },
        detailedStats: {
          totalBooks: books.length,
          avgReviews,
          priceMin: prices[0],
          priceMax: prices[prices.length - 1],
          priceMedian: prices[Math.floor(prices.length / 2)],
          strongCompetitors,
          midCompetitors,
          lowReviewBooks,
          bsrBuckets,
          dominantAuthors,
          evergreenSignal,
          cheapBookShare,
          premiumBookShare,
        },
        books: books.sort((a, b) => a.rank - b.rank),
        suggestions,
        deepAnalysis,
      });
    }, 2500);
  });
}
