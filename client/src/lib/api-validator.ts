import type { MarketAnalysis } from "./mock-validator";

export async function validateBookIdea(idea: string): Promise<MarketAnalysis> {
  const response = await fetch("/api/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ idea }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || "Failed to validate book idea");
  }

  return response.json();
}
