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

export type MarketAnalysis = {
  verdict: "GREEN" | "YELLOW" | "RED";
  verdictReason: string;
  genre: { category: string; subtype: string };
  isDemo?: boolean;
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
        "Focus on a specific sub-niche to reduce competition.",
        "Ensure your cover design is professional and stands out.",
        "Consider bundling a workbook or journal."
      ];

      if (idea.toLowerCase().includes("unicorn") || idea.toLowerCase().includes("billionaire")) {
        verdict = "GREEN";
        verdictReason = "High demand detected! This niche is currently trending with strong sales velocity across multiple authors.";
        suggestions = ["Launch quickly to capture the trend.", "Focus on Amazon Ads.", "Write a series."];
      } else if (idea.toLowerCase().includes("poetry") || idea.toLowerCase().includes("memoir")) {
        verdict = "RED";
        verdictReason = "This is a very saturated market with low organic discoverability and high author dominance.";
        suggestions = ["Build an audience on social media first.", "Focus on direct sales.", "Consider a unique angle or hybrid genre."];
      }

      resolve({
        verdict,
        verdictReason,
        genre,
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
        books: books.sort((a, b) => a.rank - b.rank), // Return sorted by rank
        suggestions,
      });
    }, 2500); // 2.5s simulated delay
  });
}
