// Mock Logic for Book Validator
// Ported and adapted for Client-Side Simulation

export type Book = {
  title: string;
  author: string;
  price: number;
  rating: number;
  reviews: number;
  rank: number;
  coverColor: string;
};

export type MarketAnalysis = {
  verdict: "GREEN" | "YELLOW" | "RED";
  verdictReason: string;
  genre: { category: string; subtype: string };
  stats: {
    avgPrice: number;
    avgRating: number;
    competitionLevel: "Low" | "Medium" | "High";
    demandLevel: "Low" | "Medium" | "High";
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
function generateMockBooks(genre: { category: string; subtype: string }, count: number = 10): Book[] {
  const titles = {
    fantasy: ["The Crystal Crown", "Dragon's Oath", "Shadows of Eldoria", "Mage's Lament", "The Void Walker"],
    romance: ["Love in Paris", "The Billionaire's Secret", "Heartstrings", "Summer Love", "Forever Yours"],
    business: ["Startup 101", "The CEO Mindset", "Growth Hacking", "Scale Up", "Profit First"],
    devotional: ["Morning Grace", "Daily Walk", "30 Days of Peace", "Faith & Fire", "Quiet Waters"],
    general: ["The Guide to Life", "Understanding Everything", "The Big Book", "Secrets Revealed", "Path to Wisdom"],
  };

  const baseTitles = titles[genre.subtype as keyof typeof titles] || titles.general;
  
  return Array.from({ length: count }).map((_, i) => {
    const baseTitle = baseTitles[i % baseTitles.length];
    return {
      title: `${baseTitle} ${i > 4 ? "Vol. " + (i-3) : ""}`,
      author: `Author ${String.fromCharCode(65 + i)}`,
      price: Math.floor(Math.random() * 20) + 9.99,
      rating: 3.5 + Math.random() * 1.5, // 3.5 to 5.0
      reviews: Math.floor(Math.random() * 500) + 10,
      rank: Math.floor(Math.random() * 100000) + 500,
      coverColor: `hsl(${Math.random() * 360}, 70%, 80%)`,
    };
  });
}

// 3. Main Validation Function (Async Simulation)
export async function validateBookIdea(idea: string): Promise<MarketAnalysis> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const genre = detectGenre(idea);
      const books = generateMockBooks(genre);
      
      // Simple Deterministic Logic for Demo
      let verdict: "GREEN" | "YELLOW" | "RED" = "YELLOW";
      let verdictReason = "Market data shows mixed signals. There is demand, but competition is present.";
      let suggestions = [
        "Focus on a specific sub-niche to reduce competition.",
        "Ensure your cover design is professional and stands out.",
        "Consider bundling a workbook or journal."
      ];

      // Fun logic based on keywords
      if (idea.toLowerCase().includes("unicorn") || idea.toLowerCase().includes("billionaire")) {
        verdict = "GREEN";
        verdictReason = "High demand detected! This niche is currently trending with low competition quality.";
        suggestions = ["Launch quickly to capture the trend.", "Focus on Amazon Ads.", "Write a series."];
      } else if (idea.toLowerCase().includes("poetry") || idea.toLowerCase().includes("memoir")) {
        verdict = "RED";
        verdictReason = "This is a very saturated market with low organic discoverability.";
        suggestions = ["Build an audience on social media first.", "Focus on direct sales.", "Consider a unique angle or hybrid genre."];
      }

      const avgPrice = books.reduce((acc, b) => acc + b.price, 0) / books.length;
      const avgRating = books.reduce((acc, b) => acc + b.rating, 0) / books.length;

      resolve({
        verdict,
        verdictReason,
        genre,
        stats: {
          avgPrice,
          avgRating,
          competitionLevel: verdict === "RED" ? "High" : verdict === "GREEN" ? "Low" : "Medium",
          demandLevel: verdict === "RED" ? "Low" : verdict === "GREEN" ? "High" : "Medium",
        },
        books,
        suggestions,
      });
    }, 2500); // 2.5s simulated delay
  });
}
