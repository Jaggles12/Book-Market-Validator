// server/amazon/index.ts
// Provider-agnostic Amazon data layer
// This file is the ONLY import point for Amazon data in the entire server.

import { rainforestClient } from "../amazonClient";

// Read the provider from environment variable (default: rainforest)
const provider = process.env.AMAZON_PROVIDER || "rainforest";

// Select the provider implementation based on env var
let amazonClient: typeof rainforestClient;

switch (provider) {
  case "rainforest":
  default:
    amazonClient = rainforestClient;
    break;
}

// Re-export the selected provider as the unified amazonClient
export { amazonClient };

// Re-export types that consumers may need
export type { RainforestBook, RainforestRankEntry, ProductEnrichmentData } from "../amazonClient";
