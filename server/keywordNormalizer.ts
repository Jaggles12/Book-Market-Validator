// server/keywordNormalizer.ts
// Normalizes user book ideas into canonical search terms

import OpenAI from "openai";

export interface NormalizedSearchTerms {
  canonicalGenre: string;      // e.g., "Domestic Thriller"
  primarySearch: string;       // e.g., "domestic thriller suburban"
  fallbackSearches: string[];  // e.g., ["domestic thriller", "psychological domestic thriller"]
  keywordTokens: string[];     // Core keywords for boosting: ["domestic", "thriller", "suburban", "psychological"]
}

/**
 * Uses OpenAI to normalize a user's book idea into canonical search terms
 * This helps with relevance scoring by providing consistent keywords to match against
 */
export async function normalizeSearchTerms(
  openai: OpenAI,
  userIdea: string,
  category: "fiction" | "nonfiction"
): Promise<NormalizedSearchTerms> {
  const prompt = `
You are a book market research assistant. Given a user's book idea, extract canonical search terms for Amazon book search.

User's book idea: "${userIdea}"
Category: ${category}

Return a JSON object with:
1. "canonicalGenre": The standard Amazon genre/subgenre label (e.g., "Domestic Thriller", "Personal Finance", "Cozy Mystery")
2. "primarySearch": The best Amazon search query (2-4 words, genre-focused)
3. "fallbackSearches": Array of 2-3 alternative search queries if the primary yields poor results
4. "keywordTokens": Array of 4-8 core keywords that books in this niche should contain in their titles/categories

Return ONLY valid JSON, no prose or code fences.
Example:
{"canonicalGenre":"Domestic Thriller","primarySearch":"domestic thriller suburban","fallbackSearches":["domestic thriller","psychological domestic thriller","suburban suspense"],"keywordTokens":["domestic","thriller","suburban","psychological","suspense","marriage","secrets"]}
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You are a precise book categorization engine. Return ONLY valid JSON."
        },
        { role: "user", content: prompt }
      ],
    });

    const raw = completion.choices[0].message.content?.trim() ?? "{}";
    
    // Clean markdown fences if present
    const cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    return {
      canonicalGenre: parsed.canonicalGenre || userIdea,
      primarySearch: parsed.primarySearch || userIdea,
      fallbackSearches: Array.isArray(parsed.fallbackSearches) ? parsed.fallbackSearches : [],
      keywordTokens: Array.isArray(parsed.keywordTokens) ? parsed.keywordTokens.map((t: string) => t.toLowerCase()) : [],
    };
  } catch (error) {
    console.error("Error normalizing search terms:", error);
    // Fallback to basic extraction
    const tokens = userIdea.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    return {
      canonicalGenre: userIdea,
      primarySearch: userIdea,
      fallbackSearches: [],
      keywordTokens: tokens,
    };
  }
}
