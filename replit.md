# BookMarket Validator

## Overview

BookMarket Validator is a web application that helps authors validate their book ideas by analyzing market data from Amazon and providing AI-powered insights. Users can submit a book concept or niche, and the application fetches real Amazon book data via the Rainforest API, processes it, and presents comprehensive market analysis including competition levels, pricing strategies, demand indicators, and actionable recommendations powered by OpenAI.

The application provides a mobile-first, iOS-inspired user interface that presents market data in an intuitive, visually appealing format with detailed statistics about competing books, market saturation, pricing trends, and genre-specific insights.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Technology Stack:**
- React 18 with TypeScript for type-safe component development
- Vite as the build tool and development server
- Wouter for lightweight client-side routing
- TanStack Query (React Query) for server state management and caching
- Tailwind CSS v4 with custom theming for styling
- Shadcn/ui component library for pre-built, accessible UI components
- Framer Motion for animations and transitions
- Radix UI primitives for accessible, unstyled component foundations

**Design Philosophy:**
The frontend adopts a mobile-first approach with an iOS-inspired design system. The application is wrapped in a `MobileLayout` component that simulates a mobile device interface with status bar, rounded corners, and home indicator on desktop while remaining fully responsive on actual mobile devices.

**Component Organization:**
- `/client/src/pages` - Route components (home, results, not-found)
- `/client/src/components` - Reusable components including MobileLayout wrapper
- `/client/src/components/ui` - Shadcn/ui component library
- `/client/src/lib` - Utility functions and API client logic
- `/client/src/hooks` - Custom React hooks

**State Management:**
Uses TanStack Query for server state with disabled refetching by default (staleTime: Infinity). The query client is configured to throw errors on 401 responses rather than returning null, centralizing authentication error handling.

**Routing Strategy:**
Wouter provides a minimal routing solution with two primary routes:
- `/` - Home page with search input
- `/validate?q={idea}` - Results page showing market analysis
- Fallback 404 page for unmatched routes

### Backend Architecture

**Technology Stack:**
- Node.js with Express.js for the HTTP server
- TypeScript for type safety across the codebase
- Drizzle ORM for database interactions (PostgreSQL dialect)
- ESBuild for production bundling with selective dependency bundling

**Server Structure:**
- `/server/index.ts` - Express server setup, middleware configuration, logging
- `/server/routes.ts` - API route definitions and business logic
- `/server/validatorService.ts` - Core validation pipeline (~2000 lines)
- `/server/storage.ts` - Data access layer with in-memory storage implementation
- `/server/static.ts` - Static file serving for production builds
- `/server/vite.ts` - Vite development server integration for HMR
- `/server/types.ts` - Shared type definitions (NormalizedBook, InferredGenre, etc.)
- `/server/relevance.ts` - 3-tier book relevance scoring (Core/Adjacent/Out-of-niche)
- `/server/genreMap.ts` - Genre mapping configuration for Amazon category paths
- `/server/genreInference.ts` - Genre inference engine using category clustering and genre family system
- `/server/canonicalNiche.ts` - Canonical niche detection to prevent genre drift

**Amazon Provider Layer:**
- `/server/amazon/index.ts` - Provider-agnostic Amazon data layer (single import point)
- `/server/amazonClient.ts` - Rainforest API implementation (active provider)
- `/server/amazon/easyParserClient.ts` - EasyParser API implementation (inactive, ready for switching)

The provider layer uses `AMAZON_PROVIDER` env var to switch between implementations. Currently defaults to "rainforest".

**API Design:**
RESTful API with a single primary endpoint:
- `POST /api/validate` - Accepts book idea, fetches Amazon data, performs AI analysis, returns market insights

**Request Processing Flow:**
1. User submits book idea via POST request
2. Backend detects genre/category from idea text
3. Constructs Amazon search query based on genre
4. Fetches top competing books via Rainforest API
5. Normalizes and analyzes book data (pricing, reviews, rankings)
6. Scores books for relevance using 3-tier system (Core ≥0.70, Adjacent 0.50-0.69, Out-of-niche <0.50)
7. Infers shelf/subgenre/microgenre from Amazon category paths
8. Generates AI-powered verdict and suggestions via OpenAI
9. Returns comprehensive market analysis to frontend

**Genre Inference System:**
The application uses a data-driven genre inference system that analyzes Amazon category paths from the bestsellers_rank field:

1. **Category Path Extraction**: During book normalization, Amazon category paths (e.g., "Books > Business & Money > Personal Finance") are extracted from bestsellers_rank entries and stored in `amazonCategoryPaths` and `primaryAmazonPath` fields.

2. **Frequency Clustering**: The `inferAmazonCategoryCluster` function ranks category paths by weighted frequency across all books, giving higher weight to books with more reviews (indicating market significance).

3. **Genre Mapping**: The dominant category path is matched against patterns in `genreMap.ts` to determine shelf (Fiction/Nonfiction), subgenre, and microgenre.

4. **Fallback Logic**: When no patterns match, the system falls back to the user's original fiction/nonfiction selection while extracting any available subgenre from the category path.

Design principle: The user's fiction/nonfiction selection is never overridden—it serves as a "hard lock". Amazon data only informs shelf/subgenre details.

**Development vs Production:**
- Development: Vite dev server integrated via middleware for HMR
- Production: Static files served from `/dist/public`, server bundled to single CommonJS file
- Build script selectively bundles high-syscall dependencies to improve cold start times

### Database Schema

**ORM Configuration:**
Drizzle ORM is configured for PostgreSQL with schema defined in `/shared/schema.ts`. The application currently uses an in-memory storage implementation (`MemStorage` class) as the primary data layer, suggesting the database integration is prepared but not yet fully utilized in the current implementation.

**Current Schema:**
- `users` table with id, username, and password fields
- Schema uses Drizzle-Zod for runtime validation

**Storage Pattern:**
The codebase implements a storage interface (`IStorage`) allowing for easy migration from in-memory storage to database-backed storage without changing business logic. This abstraction supports CRUD operations for users.

### External Dependencies

**Third-Party APIs:**

1. **Rainforest API** (Primary Amazon Data Source - Active)
   - Purpose: Fetches real-time Amazon product data including books, ratings, reviews, prices, and bestseller rankings
   - Authentication: API key via environment variable `RAINFOREST_API_KEY`
   - Integration: Direct HTTP requests via Axios
   - Data Points: Title, ASIN, ratings, reviews, price, bestseller rank, publication date, authors

2. **EasyParser API** (Alternative Amazon Data Source - Inactive)
   - Purpose: Alternative provider for Amazon product data with same capabilities as Rainforest
   - Authentication: API key via environment variable `EASYPARSER_API_KEY`
   - Integration: POST requests to https://realtime.easyparser.com/v1/request
   - Operations: SEARCH (keyword queries), DETAIL (ASIN lookups)
   - Status: Implemented but not wired; set `AMAZON_PROVIDER=easyparser` to enable

3. **OpenAI API** (AI Analysis Engine)
   - Purpose: Generates market verdict, insights, and actionable suggestions based on analyzed book data
   - Authentication: API key via environment variable `OPENAI_API_KEY`
   - Integration: Official OpenAI SDK
   - Use Case: Processes normalized book data to provide strategic recommendations

**Required Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string (for future database integration)
- `RAINFOREST_API_KEY` - Authentication for Rainforest Amazon API
- `OPENAI_API_KEY` - Authentication for OpenAI GPT models
- `REPL_ID` - Replit-specific identifier for development plugins

**Development Tooling:**
- Replit-specific Vite plugins for cartographer, dev banner, and runtime error overlay (development only)
- Custom meta images plugin for dynamic OpenGraph image URL generation based on deployment domain

**Build and Deployment:**
- ESBuild for server bundling with selective dependency inclusion
- Vite for client bundling with optimized production builds
- Static asset handling with fallback to index.html for SPA routing