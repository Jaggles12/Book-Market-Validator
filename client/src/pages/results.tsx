import { useLocation } from "wouter";
import { MobileLayout } from "@/components/MobileLayout";
import { useEffect, useState } from "react";
import { validateBookIdea, fetchBlueprint, generateBlueprint, saveBlueprint, type BookBlueprint } from "@/lib/api-validator";
import type { ValidateResponse } from "@/lib/api-validator";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, CheckCircle2, AlertTriangle, XCircle, 
  BarChart3, Users, DollarSign, Book, TrendingUp, 
  Activity, Award, AlertCircle, Layers, FlaskConical,
  Lightbulb, Target, Tag, FileText, Sparkles, ChevronDown, X,
  ArrowRightCircle, FileEdit, Loader2, Save
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";

function generateVerdictExplanation(data: ValidateResponse): string[] {
  const bullets: string[] = [];
  const { stats, detailedStats } = data;
  
  if (stats?.demandLevel) {
    const veryStrongCount = detailedStats?.bsrBuckets?.veryStrong ?? 0;
    const strongCount = detailedStats?.bsrBuckets?.strong ?? 0;
    const totalStrong = veryStrongCount + strongCount;
    bullets.push(`Demand: ${stats.demandLevel} (${totalStrong} strong-selling book${totalStrong !== 1 ? 's' : ''} in this niche)`);
  }
  
  if (stats?.competitionLevel) {
    const giants = detailedStats?.strongCompetitors ?? 0;
    bullets.push(`Competition: ${stats.competitionLevel} (${giants} giant${giants !== 1 ? 's' : ''} with 1,000+ reviews)`);
  }
  
  if (Array.isArray(detailedStats?.dominantAuthors)) {
    if (detailedStats.dominantAuthors.length === 0) {
      bullets.push("Author diversity: Healthy (no single author dominates top positions)");
    } else {
      const topAuthor = detailedStats.dominantAuthors[0];
      bullets.push(`Author dominance: ${topAuthor.name} has ${topAuthor.count} books in top results`);
    }
  }
  
  const lowReviewBooks = detailedStats?.lowReviewBooks ?? 0;
  const totalBooks = detailedStats?.totalBooks ?? 0;
  if (totalBooks > 0) {
    const lowReviewPct = Math.round((lowReviewBooks / totalBooks) * 100);
    if (lowReviewPct >= 20) {
      bullets.push(`New entrant opportunity: ${lowReviewPct}% of books have under 50 reviews`);
    }
  }
  
  if (detailedStats?.evergreenSignal === true) {
    bullets.push("Evergreen niche: Both new and older books are selling well");
  }
  
  return bullets;
}

export default function Validate() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ValidateResponse | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);

  const query = new URLSearchParams(window.location.search).get("q") || "";
  const bookTypeParam = new URLSearchParams(window.location.search).get("type");
  const bookType =
    bookTypeParam === "fiction" || bookTypeParam === "nonfiction"
      ? bookTypeParam
      : null;

  // ---- Data confidence derived values (safe when data is null) ----
  const salesLeaders = data?.salesLeaders ?? [];
  const anchorCount = salesLeaders.length;
  const anchorRanks = salesLeaders
    .map((s) => s.rank)
    .filter((r) => typeof r === "number");

  const bestRank =
    anchorRanks.length > 0 ? Math.min(...anchorRanks) : null;

  const worstRank =
    anchorRanks.length > 0 ? Math.max(...anchorRanks) : null;

  useEffect(() => {
    if (!query) {
      setLocation("/");
      return;
    }

    validateBookIdea(query, bookType || undefined).then((result) => {
      setData(result);
      setLoading(false);
    });
  }, [query, bookType, setLocation]);

  const verdictColors = {
    GREEN: "bg-emerald-500 text-white shadow-emerald-500/30",
    YELLOW: "bg-amber-500 text-white shadow-amber-500/30",
    RED: "bg-rose-500 text-white shadow-rose-500/30",
  };
  
  const verdictIcon = {
    GREEN: <CheckCircle2 size={48} className="mb-2" />,
    YELLOW: <AlertTriangle size={48} className="mb-2" />,
    RED: <XCircle size={48} className="mb-2" />,
  };

  if (loading) {
    return (
      <MobileLayout>
        <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-6">
          <div className="relative">
            <div className="h-20 w-20 rounded-full border-4 border-gray-100 animate-[spin_3s_linear_infinite]"></div>
            <div className="h-20 w-20 rounded-full border-t-4 border-primary absolute top-0 left-0 animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center text-2xl">📚</div>
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Analyzing Market...</h2>
            <p className="text-muted-foreground mt-2">Scanning Amazon Bestsellers, analyzing competition, and calculating demand.</p>
          </div>
        </div>
      </MobileLayout>
    );
  }

  if (!data) return null;

  return (
    <MobileLayout>
      <div className="pb-20">
        {/* Nav */}
        <div className="px-6 py-4 flex items-center gap-4 sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/50">
          <button 
            onClick={() => setLocation("/")}
            className="h-10 w-10 bg-white rounded-full flex items-center justify-center shadow-sm border border-border text-foreground/80 hover:bg-gray-50"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-lg truncate">{query}</h1>
            {data.searchTerm && (
              <p className="text-xs text-muted-foreground truncate" data-testid="text-analyzed-as">
                Analyzed as: {data.searchTerm}
              </p>
            )}
          </div>
        </div>

        {data.isDemo && (
          <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3" data-testid="banner-demo-mode">
            <FlaskConical className="text-amber-600 shrink-0" size={20} />
            <div>
              <p className="text-sm font-medium text-amber-800">Demo Mode</p>
              <p className="text-xs text-amber-600">Using sample data. Real market data requires API credits.</p>
            </div>
          </div>
        )}

        <div className="p-6 space-y-6">
          
          {/* Verdict Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-[2rem] p-8 flex flex-col items-center text-center shadow-xl ${verdictColors[data.verdict]}`}
          >
            {verdictIcon[data.verdict]}
            <h2 className="text-3xl font-bold mb-2">{data.verdict} LIGHT</h2>
            <p className="text-white/90 font-medium leading-snug">{data.verdictReason}</p>
          </motion.div>

          {/* Why This Rating Toggle */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <button
              onClick={() => setShowExplanation(!showExplanation)}
              className="w-full flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-why-rating"
            >
              <span>Why {data.verdict.charAt(0) + data.verdict.slice(1).toLowerCase()}?</span>
              <ChevronDown 
                size={16} 
                className={`transition-transform duration-200 ${showExplanation ? 'rotate-180' : ''}`}
              />
            </button>
            
            <AnimatePresence>
              {showExplanation && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-white rounded-2xl border border-border/50 shadow-sm p-4 mt-2 overflow-hidden"
                  data-testid="panel-why-rating"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-sm text-foreground">Rating Breakdown</h4>
                    <button
                      onClick={() => setShowExplanation(false)}
                      className="h-6 w-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-muted-foreground"
                      data-testid="button-close-why-rating"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {(() => {
                    const bullets = generateVerdictExplanation(data);
                    if (bullets.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground italic">
                          Detailed breakdown not available for this analysis.
                        </p>
                      );
                    }
                    return (
                      <ul className="space-y-2">
                        {bullets.map((bullet, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                            <span className="text-primary mt-0.5">•</span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Quick Stats */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-2 gap-4"
          >
            <div className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs font-bold uppercase tracking-wide">
                <Users size={14} /> Competition
              </div>
              <div className="text-2xl font-bold text-foreground">{data.stats.competitionLevel}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs font-bold uppercase tracking-wide">
                <BarChart3 size={14} /> Demand
              </div>
              <div className="text-2xl font-bold text-foreground">{data.stats.demandLevel}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs font-bold uppercase tracking-wide">
                <DollarSign size={14} /> Avg Price
              </div>
              <div className="text-2xl font-bold text-foreground">
                {data.stats.avgPrice != null ? `$${data.stats.avgPrice.toFixed(2)}` : "N/A"}
              </div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs font-bold uppercase tracking-wide">
                <Book size={14} /> Niche
              </div>
              <div className="text-sm font-bold text-foreground leading-tight mt-1" data-testid="text-friendly-genre">
                {data.friendlyGenreLabel || data.genre.subtype.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              </div>
            </div>
          </motion.div>
          
          {/* Bestsellers */}
          {data.salesLeaders && data.salesLeaders.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="bg-white p-5 rounded-2xl border border-border/50 shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-semibold">Bestsellers</h3>
                <span className="text-[10px] text-muted-foreground">
                  Based on ranked titles Amazon shows for this niche.
                </span>
              </div>
              <ul className="mt-2 space-y-2 text-sm">
                {data.salesLeaders.map((book, idx) => (
                  <li
                    key={book.title + book.rank}
                    className="border-t pt-2 first:border-t-0 first:pt-0"
                  >
                    <div className="font-medium">
                      {idx + 1}. {book.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {/* BSR */}
                      {book.rank != null ? (
                        <>BSR #{book.rank.toLocaleString()} ·{" "}</>
                      ) : (
                        <>BSR N/A ·{" "}</>
                      )}

                      {/* Rating */}
                      Rating {book.rating != null ? book.rating.toFixed(1) : "—"} ·{" "}

                      {/* Reviews */}
                      {book.reviews != null
                        ? `${book.reviews.toLocaleString()} reviews`
                        : "No reviews yet"}{" "}
                      ·{" "}

                      {/* Price */}
                      {book.price != null ? `$${book.price.toFixed(2)}` : "Price N/A"}
                    </div>
                    </li>
                    ))}
                    </ul>
                    </motion.div>
                    )}

          {/* Adjacent Sales Leaders - shown when no core sales leaders but adjacents exist */}
          {(!data.salesLeaders || data.salesLeaders.length === 0) && data.adjacentSalesLeaders && data.adjacentSalesLeaders.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="bg-amber-50 p-5 rounded-2xl border border-amber-200 shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-semibold text-amber-900">Closest Sales Leaders (Adjacent Niche)</h3>
                <span className="text-[10px] text-amber-700">
                  No direct competitors found. Showing top performers from related categories.
                </span>
              </div>
              <ul className="mt-2 space-y-2 text-sm">
                {data.adjacentSalesLeaders.map((book, idx) => (
                  <li
                    key={book.title + book.rank}
                    className="border-t border-amber-200 pt-2 first:border-t-0 first:pt-0"
                  >
                    <div className="font-medium text-amber-900">
                      {idx + 1}. {book.title}
                    </div>
                    <div className="text-xs text-amber-700">
                      {book.rank != null ? (
                        <>BSR #{book.rank.toLocaleString()} · </>
                      ) : (
                        <>BSR N/A · </>
                      )}
                      Rating {book.rating != null ? book.rating.toFixed(1) : "—"} · 
                      {book.reviews != null
                        ? ` ${book.reviews.toLocaleString()} reviews`
                        : " No reviews yet"}{" "}
                      · {book.price != null ? `$${book.price.toFixed(2)}` : "Price N/A"}
                    </div>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}

          {/* Detailed Metrics Accordion */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <h3 className="text-lg font-bold mb-3 px-1 flex items-center gap-2">
              <Activity size={18} className="text-primary"/> Deep Dive Analysis
            </h3>
            <Accordion type="single" collapsible className="bg-white rounded-2xl border border-border/50 shadow-sm overflow-hidden">
              
              {/* Demand Analysis */}
              <AccordionItem
                value="demand"
                className="border-b border-border/50"
              >
                <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-gray-50">
                  <div className="flex items-center gap-3 text-left">
                    <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                      <TrendingUp size={16} />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">
                        Sales Demand
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {data.stats.demandLevel} demand ·{" "}
                        {data.stats.competitionLevel} competition ·{" "}
                        {data.detailedStats.totalBooks} comparable titles
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="px-5 pb-5 pt-1 space-y-4">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-medium">
                        <span>Very Strong (Rank &lt; 10k)</span>
                        <span>
                          {data.detailedStats.bsrBuckets.veryStrong} books
                        </span>
                      </div>
                      <Progress
                        value={
                          (data.detailedStats.bsrBuckets.veryStrong /
                            data.detailedStats.totalBooks) *
                          100
                        }
                        className="h-2"
                        indicatorClassName="bg-emerald-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-medium">
                        <span>Strong (Rank 10k–100k)</span>
                        <span>
                          {data.detailedStats.bsrBuckets.strong} books
                        </span>
                      </div>
                      <Progress
                        value={
                          (data.detailedStats.bsrBuckets.strong /
                            data.detailedStats.totalBooks) *
                          100
                        }
                        className="h-2"
                        indicatorClassName="bg-blue-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-medium">
                        <span>Weak (Rank &gt; 300k)</span>
                        <span>
                          {data.detailedStats.bsrBuckets.weak} books
                        </span>
                      </div>
                      <Progress
                        value={
                          (data.detailedStats.bsrBuckets.weak /
                            data.detailedStats.totalBooks) *
                          100
                        }
                        className="h-2"
                        indicatorClassName="bg-gray-300"
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-xl text-xs text-muted-foreground">
                    {data.detailedStats.evergreenSignal
                      ? "🌱 Evergreen Signal: Both new and old books are selling well."
                      : "⚠️ Trend Alert: Most sales are coming from very recent books."}
                  </div>

                  {/* Market Signal & Data Confidence */}
                  <div className="mt-4 rounded-lg border border-border/50 bg-muted/40 p-3 text-xs text-muted-foreground">
                    <div className="font-semibold text-foreground text-sm mb-2">
                      Market Signal
                    </div>

                    {/* Core vs Adjacent breakdown */}
                    {data.marketSignal && (
                      <div className="space-y-2 mb-3">
                        <div className="flex gap-4">
                          <div className="flex-1 p-2 bg-emerald-50 rounded-lg text-center">
                            <div className="text-lg font-bold text-emerald-700">
                              {data.marketSignal.coreBookCount}
                            </div>
                            <div className="text-[10px] text-emerald-600">Direct Competitors</div>
                          </div>
                          <div className="flex-1 p-2 bg-blue-50 rounded-lg text-center">
                            <div className="text-lg font-bold text-blue-700">
                              {data.marketSignal.adjacentBookCount}
                            </div>
                            <div className="text-[10px] text-blue-600">Adjacent Titles</div>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground bg-white/50 p-2 rounded">
                          {data.marketSignal.explanation}
                        </div>
                      </div>
                    )}

                    <div className="text-[11px] space-y-1 pt-2 border-t border-border/30">
                      <div>
                        <span className="font-medium">{anchorCount}</span>{" "}
                        anchor titles with confirmed Amazon Best Sellers Rank.
                      </div>

                      {bestRank != null && worstRank != null && (
                        <div>
                          Anchor ranks range from{" "}
                          <span className="font-medium">
                            #{bestRank.toLocaleString()}
                          </span>{" "}
                          to{" "}
                          <span className="font-medium">
                            #{worstRank.toLocaleString()}
                          </span>{" "}
                          in {data.detailedStats.topRankCategories && data.detailedStats.topRankCategories.length > 0 
                            ? data.detailedStats.topRankCategories.join(", ") 
                            : "Amazon subcategories"}.
                          <span className="block text-muted-foreground mt-1">
                            (These are category ranks, not overall store rankings)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

                    {/* Competition Analysis */}
                    <AccordionItem
                      value="competition"
                      className="border-b border-border/50"
                    >
                      <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-gray-50">
                        <div className="flex items-center gap-3 text-left">
                          <div className="h-8 w-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
                            <Award size={16} />
                          </div>
                          <div>
                            <div className="font-semibold text-foreground">
                              Competition
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Review Counts &amp; Dominance
                            </div>
                          </div>
                        </div>
                      </AccordionTrigger>

                      <AccordionContent className="px-5 pb-5 pt-1 space-y-4">
                        {/* Review tiers */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="p-2 bg-red-50 rounded-lg">
                            <div className="text-lg font-bold text-red-600">
                              {data.detailedStats.strongCompetitors}
                            </div>
                            <div className="text-[10px] text-muted-foreground leading-tight">
                              Giants
                              <br />
                              (1000+ revs)
                            </div>
                          </div>

                          <div className="p-2 bg-orange-50 rounded-lg">
                            <div className="text-lg font-bold text-orange-600">
                              {data.detailedStats.midCompetitors}
                            </div>
                            <div className="text-[10px] text-muted-foreground leading-tight">
                              Mid-Tier
                              <br />
                              (100–1k revs)
                            </div>
                          </div>

                          <div className="p-2 bg-green-50 rounded-lg">
                            <div className="text-lg font-bold text-green-600">
                              {data.detailedStats.lowReviewBooks}
                            </div>
                            <div className="text-[10px] text-muted-foreground leading-tight">
                              New
                              <br />
                              (&lt;50 revs)
                            </div>
                          </div>
                        </div>

                        {/* Author dominance */}
                        <div className="space-y-2 pt-2 border-t border-border/50 mt-2">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                              Author Dominance
                            </div>

                            {data.detailedStats.dominantAuthors.length === 0 && (
                              <div className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                                <CheckCircle2 size={10} /> Healthy (Diverse)
                              </div>
                            )}

                            {data.detailedStats.dominantAuthors.length > 0 && (
                              <div className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                                <AlertTriangle size={10} /> Warning
                              </div>
                            )}
                          </div>

                          {data.detailedStats.dominantAuthors.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {data.detailedStats.dominantAuthors.map((author, i) => (
                                <div
                                  key={i}
                                  className="text-xs bg-amber-50 text-amber-900 px-2 py-1 rounded-md font-medium border border-amber-100 flex items-center gap-1"
                                >
                                  <Users size={10} className="opacity-50" />
                                  {author.name} ({author.count} books)
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">
                              No single author controls more than 3 spots in the top
                              results. This is good for new entrants.
                            </p>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>


              {/* Pricing Analysis */}
              <AccordionItem value="pricing" className="border-none">
                <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-gray-50">
                  <div className="flex items-center gap-3 text-left">
                    <div className="h-8 w-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                      <DollarSign size={16} />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">Pricing Strategy</div>
                      <div className="text-xs text-muted-foreground">Market Price Spread</div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-5 pb-5 pt-1 space-y-4">
                  {data.detailedStats.priceMin !== null && data.detailedStats.priceMax !== null ? (
                  <div className="flex items-center justify-between px-2">
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground mb-1">Min</div>
                      <div className="font-mono font-medium">${data.detailedStats.priceMin.toFixed(2)}</div>
                    </div>
                    <div className="h-px bg-border flex-1 mx-4 relative">
                      <div className="absolute left-1/2 -translate-x-1/2 -top-3 text-[10px] bg-white px-1 text-muted-foreground">Median</div>
                      <div className="absolute left-1/2 -translate-x-1/2 top-[-2px] h-2 w-2 bg-black rounded-full"></div>
                      <div className="absolute left-1/2 -translate-x-1/2 top-3 font-bold text-sm">${(data.detailedStats.priceMedian ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground mb-1">Max</div>
                      <div className="font-mono font-medium">${data.detailedStats.priceMax.toFixed(2)}</div>
                    </div>
                  </div>
                  ) : (
                  <div className="text-center text-muted-foreground text-sm py-4">
                    No pricing data available for this search.
                  </div>
                  )}
                  
                  <div className="space-y-2 mt-4">
                     {data.detailedStats.cheapBookShare > 0.3 && (
                       <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">
                         <AlertCircle size={14} />
                         High volume of cheap books ({Math.round(data.detailedStats.cheapBookShare * 100)}% &lt; $2.99)
                       </div>
                     )}
                     {data.detailedStats.premiumBookShare > 0.2 && (
                       <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 p-2 rounded-lg">
                         <CheckCircle2 size={14} />
                         Premium pricing detected ({Math.round(data.detailedStats.premiumBookShare * 100)}% &gt; $15)
                       </div>
                     )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </motion.div>

          {/* Suggestions */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h3 className="text-lg font-bold mb-4 px-1">Strategic Advice</h3>
            <div className="space-y-3">
              {data.suggestions.map((suggestion, i) => (
                <div key={i} className="flex gap-4 p-4 bg-white rounded-2xl border border-border/50 shadow-sm">
                  <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">
                    {i + 1}
                  </div>
                  <p className="text-sm font-medium text-foreground/80">{suggestion}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Deep Analysis Sections */}
          {data.deepAnalysis && (
            <>
              {/* Niche Opportunities Card */}
              {((data.deepAnalysis.nicheOpportunities && data.deepAnalysis.nicheOpportunities.items && data.deepAnalysis.nicheOpportunities.items.length > 0) || 
                (data.deepAnalysis.formatGaps && data.deepAnalysis.formatGaps.length > 0)) && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="bg-white rounded-2xl border border-border/50 shadow-sm p-5"
                  data-testid="card-niche-opportunities"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-8 w-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">
                      <Lightbulb size={16} />
                    </div>
                    <h3 className="font-bold text-foreground">Niche Opportunities</h3>
                  </div>
                  
                  {data.deepAnalysis.nicheOpportunities && data.deepAnalysis.nicheOpportunities.items && data.deepAnalysis.nicheOpportunities.items.length > 0 && (
                    <div className="mb-4">
                      {data.deepAnalysis.nicheOpportunities.intro && (
                        <p className="text-sm text-foreground/80 mb-3">{data.deepAnalysis.nicheOpportunities.intro}</p>
                      )}
                      <ul className="space-y-2">
                        {data.deepAnalysis.nicheOpportunities.items.map((opportunity, i) => (
                          <li key={i} className="flex gap-2 text-sm text-foreground/80">
                            <span className="text-purple-500 mt-1">•</span>
                            <span>{opportunity}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {data.deepAnalysis.formatGaps && data.deepAnalysis.formatGaps.length > 0 && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Format Opportunities</p>
                      <ul className="space-y-2">
                        {data.deepAnalysis.formatGaps.map((gap, i) => (
                          <li key={i} className="flex gap-2 text-sm text-foreground/80">
                            <span className="text-purple-500 mt-1">•</span>
                            <span>{gap}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Positioning & Ideal Reader Card */}
              {(data.deepAnalysis.idealReader || data.deepAnalysis.positioningStatement || 
                (data.deepAnalysis.differentiationAngles && data.deepAnalysis.differentiationAngles.length > 0)) && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="bg-white rounded-2xl border border-border/50 shadow-sm p-5"
                  data-testid="card-positioning"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                      <Target size={16} />
                    </div>
                    <h3 className="font-bold text-foreground">Positioning & Ideal Reader</h3>
                  </div>
                  
                  {/* Ideal Reader Snapshot */}
                  {data.deepAnalysis?.idealReader && (
                    <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        Ideal Reader Snapshot
                      </h3>

                      {/* Demographics */}
                      {data.deepAnalysis.idealReader.demographics && (
                        <div className="space-y-1 text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">Age:</span>{" "}
                            {data.deepAnalysis.idealReader.demographics.age}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Gender:</span>{" "}
                            {data.deepAnalysis.idealReader.demographics.gender}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Income:</span>{" "}
                            {data.deepAnalysis.idealReader.demographics.income}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Location:</span>{" "}
                            {data.deepAnalysis.idealReader.demographics.location}
                          </div>
                        </div>
                      )}

                      {/* Psychographics */}
                      {data.deepAnalysis.idealReader.psychographics && (
                        <div className="pt-3 border-t border-border/40 space-y-1 text-xs text-muted-foreground">
                          {Array.isArray(data.deepAnalysis.idealReader.psychographics) ? (
                            // Case 1: Psychographics is an array of strings
                            <div>
                              <span className="font-medium text-foreground">Psychographics:</span>{" "}
                              {data.deepAnalysis.idealReader.psychographics.join(", ")}
                            </div>
                          ) : (
                            // Case 2: Psychographics is an object with values/painPoints/goals
                            <>
                              {data.deepAnalysis.idealReader.psychographics.values && (
                                <div>
                                  <span className="font-medium text-foreground">Values:</span>{" "}
                                  {data.deepAnalysis.idealReader.psychographics.values.join(", ")}
                                </div>
                              )}

                              {data.deepAnalysis.idealReader.psychographics.painPoints && (
                                <div>
                                  <span className="font-medium text-foreground">Pain Points:</span>{" "}
                                  {data.deepAnalysis.idealReader.psychographics.painPoints.join(", ")}
                                </div>
                              )}

                              {data.deepAnalysis.idealReader.psychographics.goals && (
                                <div>
                                  <span className="font-medium text-foreground">Goals:</span>{" "}
                                  {data.deepAnalysis.idealReader.psychographics.goals.join(", ")}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {data.deepAnalysis.positioningStatement && (
                    <div className="mb-4 p-3 bg-blue-50 rounded-xl">
                      <p className="text-xs font-bold uppercase tracking-wide text-blue-700 mb-1">Positioning Statement</p>
                      <p className="text-sm font-medium text-blue-900">{data.deepAnalysis.positioningStatement}</p>
                    </div>
                  )}
                  
                  {data.deepAnalysis.differentiationAngles && data.deepAnalysis.differentiationAngles.length > 0 && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">You Can Stand Out By</p>
                      <ul className="space-y-2">
                        {data.deepAnalysis.differentiationAngles.map((angle, i) => (
                          <li key={i} className="flex gap-2 text-sm text-foreground/80">
                            <span className="text-blue-500 mt-1">•</span>
                            <span>{angle}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Keywords & Categories Card */}
              {((data.deepAnalysis.coreKeywords && data.deepAnalysis.coreKeywords.length > 0) || 
                (data.deepAnalysis.whiteSpaceKeywords && data.deepAnalysis.whiteSpaceKeywords.length > 0) ||
                (data.deepAnalysis.suggestedCategories && data.deepAnalysis.suggestedCategories.length > 0)) && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                  className="bg-white rounded-2xl border border-border/50 shadow-sm p-5"
                  data-testid="card-keywords"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-8 w-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                      <Tag size={16} />
                    </div>
                    <h3 className="font-bold text-foreground">Keywords & Categories</h3>
                  </div>
                  
                  {data.deepAnalysis.coreKeywords && data.deepAnalysis.coreKeywords.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Core Keywords</p>
                      <div className="flex flex-wrap gap-2">
                        {data.deepAnalysis.coreKeywords.map((keyword, i) => (
                          <span key={i} className="px-2.5 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-200">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {data.deepAnalysis.whiteSpaceKeywords && data.deepAnalysis.whiteSpaceKeywords.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">White Space Keywords</p>
                      <p className="text-[10px] text-muted-foreground mb-2 -mt-1">Lower competition opportunities</p>
                      <div className="flex flex-wrap gap-2">
                        {data.deepAnalysis.whiteSpaceKeywords.map((keyword, i) => (
                          <span key={i} className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-full border border-amber-200">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {data.deepAnalysis.suggestedCategories && data.deepAnalysis.suggestedCategories.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Suggested Categories</p>
                      <ul className="space-y-1">
                        {data.deepAnalysis.suggestedCategories.map((category, i) => (
                          <li key={i} className="flex gap-2 text-sm text-foreground/80">
                            <span className="text-green-500">•</span>
                            <span>{category}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {data.deepAnalysis.bestCategoryPath && (
                    <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-100">
                      <p className="text-xs font-bold uppercase tracking-wide text-green-700 mb-1">Best Category Path</p>
                      <p className="text-sm font-medium text-green-900">{data.deepAnalysis.bestCategoryPath}</p>
                    </div>
                  )}
                  
                  {data.deepAnalysis.trendingKeywords && data.deepAnalysis.trendingKeywords.length > 0 && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Trending/Opportunity Keywords</p>
                      <div className="flex flex-wrap gap-2">
                        {data.deepAnalysis.trendingKeywords.map((keyword, i) => (
                          <span key={i} className="px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-medium rounded-full border border-purple-200">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Book Blueprint Card */}
              {data.deepAnalysis.bookBlueprint && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-white rounded-2xl border border-border/50 shadow-sm p-5"
                  data-testid="card-blueprint"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-8 w-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
                      <FileText size={16} />
                    </div>
                    <h3 className="font-bold text-foreground">Book Blueprint</h3>
                  </div>
                  
                  <div className="space-y-4">
                    {data.deepAnalysis.bookBlueprint.working_title && (
                      <div className="p-4 bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl border border-orange-100">
                        <p className="font-bold text-lg text-foreground">{data.deepAnalysis.bookBlueprint.working_title}</p>
                        {data.deepAnalysis.bookBlueprint.subtitle && (
                          <p className="text-sm text-muted-foreground mt-1">{data.deepAnalysis.bookBlueprint.subtitle}</p>
                        )}
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.core_promise && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Core Promise</p>
                        <p className="text-sm text-foreground/90 p-3 bg-green-50 rounded-xl border border-green-100">
                          {data.deepAnalysis.bookBlueprint.core_promise}
                        </p>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.ideal_reader && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Ideal Reader</p>
                        <p className="text-sm text-foreground/80">{data.deepAnalysis.bookBlueprint.ideal_reader}</p>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.differentiation && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Differentiation</p>
                        <p className="text-sm text-foreground/80">{data.deepAnalysis.bookBlueprint.differentiation}</p>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.format && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Format</p>
                        <p className="text-sm text-foreground/80">{data.deepAnalysis.bookBlueprint.format}</p>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.constraints && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Constraints</p>
                        <div className="flex flex-wrap gap-2">
                          {data.deepAnalysis.bookBlueprint.constraints.word_count_target && (
                            <span className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-200">
                              {data.deepAnalysis.bookBlueprint.constraints.word_count_target.toLocaleString()} words
                            </span>
                          )}
                          {data.deepAnalysis.bookBlueprint.constraints.reading_level && (
                            <span className="px-3 py-1.5 bg-purple-50 text-purple-700 text-xs font-medium rounded-full border border-purple-200">
                              {data.deepAnalysis.bookBlueprint.constraints.reading_level}
                            </span>
                          )}
                          {data.deepAnalysis.bookBlueprint.constraints.timeframe && (
                            <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full border border-indigo-200">
                              {data.deepAnalysis.bookBlueprint.constraints.timeframe}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.structure && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Book Structure</p>
                        {data.deepAnalysis.bookBlueprint.structure.overview && (
                          <p className="text-sm text-foreground/80 mb-3">{data.deepAnalysis.bookBlueprint.structure.overview}</p>
                        )}
                        {data.deepAnalysis.bookBlueprint.structure.sections && data.deepAnalysis.bookBlueprint.structure.sections.length > 0 && (
                          <div className="space-y-3">
                            {data.deepAnalysis.bookBlueprint.structure.sections.map((section: any, i: number) => (
                              <div key={i} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <p className="font-semibold text-sm text-foreground">{section.title}</p>
                                {section.description && (
                                  <p className="text-xs text-muted-foreground mt-1">{section.description}</p>
                                )}
                                {section.chapters && section.chapters.length > 0 && (
                                  <ul className="mt-2 space-y-1.5">
                                    {section.chapters.map((chapter: any, j: number) => (
                                      <li key={j} className="flex gap-2 text-xs text-foreground/80">
                                        <span className="text-orange-500 font-bold">•</span>
                                        <div>
                                          <span className="font-medium">{chapter.title}</span>
                                          {chapter.purpose && <span className="text-muted-foreground"> — {chapter.purpose}</span>}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.voice_and_style && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Voice & Style</p>
                        <p className="text-sm text-foreground/80">{data.deepAnalysis.bookBlueprint.voice_and_style}</p>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.comparable_titles && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Comparable Titles</p>
                        <p className="text-sm text-foreground/80 whitespace-pre-line">{data.deepAnalysis.bookBlueprint.comparable_titles}</p>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.positioning_notes && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Positioning</p>
                        <p className="text-sm text-foreground/80">{data.deepAnalysis.bookBlueprint.positioning_notes}</p>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.primary_keywords && data.deepAnalysis.bookBlueprint.primary_keywords.length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Primary Keywords</p>
                        <div className="flex flex-wrap gap-2">
                          {data.deepAnalysis.bookBlueprint.primary_keywords.map((kw: string, i: number) => (
                            <span key={i} className="px-2.5 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-200">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.whitespace_keywords && data.deepAnalysis.bookBlueprint.whitespace_keywords.length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">White Space Keywords</p>
                        <div className="flex flex-wrap gap-2">
                          {data.deepAnalysis.bookBlueprint.whitespace_keywords.map((kw: string, i: number) => (
                            <span key={i} className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-full border border-amber-200">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.logline && (
                      <div className="mt-4 pt-4 border-t border-border/40">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Logline</p>
                        <p className="text-sm text-foreground/90 font-medium italic">{data.deepAnalysis.bookBlueprint.logline}</p>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.fiveBeatStructure && (
                      <div className="mt-4 pt-4 border-t border-border/40">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">5-Beat Structure Summary</p>
                        <div className="space-y-3">
                          {data.deepAnalysis.bookBlueprint.fiveBeatStructure.setup && (
                            <div className="flex gap-3">
                              <div className="flex-shrink-0 h-6 w-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">1</div>
                              <div>
                                <p className="text-xs font-semibold text-purple-700">Setup / Context</p>
                                <p className="text-sm text-foreground/80 mt-0.5">{data.deepAnalysis.bookBlueprint.fiveBeatStructure.setup}</p>
                              </div>
                            </div>
                          )}
                          {data.deepAnalysis.bookBlueprint.fiveBeatStructure.disruption && (
                            <div className="flex gap-3">
                              <div className="flex-shrink-0 h-6 w-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">2</div>
                              <div>
                                <p className="text-xs font-semibold text-purple-700">Disruption / Inciting Event</p>
                                <p className="text-sm text-foreground/80 mt-0.5">{data.deepAnalysis.bookBlueprint.fiveBeatStructure.disruption}</p>
                              </div>
                            </div>
                          )}
                          {data.deepAnalysis.bookBlueprint.fiveBeatStructure.risingComplications && (
                            <div className="flex gap-3">
                              <div className="flex-shrink-0 h-6 w-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">3</div>
                              <div>
                                <p className="text-xs font-semibold text-purple-700">Rising Complications / Development</p>
                                <p className="text-sm text-foreground/80 mt-0.5">{data.deepAnalysis.bookBlueprint.fiveBeatStructure.risingComplications}</p>
                              </div>
                            </div>
                          )}
                          {data.deepAnalysis.bookBlueprint.fiveBeatStructure.climax && (
                            <div className="flex gap-3">
                              <div className="flex-shrink-0 h-6 w-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">4</div>
                              <div>
                                <p className="text-xs font-semibold text-purple-700">Climax / Breakthrough</p>
                                <p className="text-sm text-foreground/80 mt-0.5">{data.deepAnalysis.bookBlueprint.fiveBeatStructure.climax}</p>
                              </div>
                            </div>
                          )}
                          {data.deepAnalysis.bookBlueprint.fiveBeatStructure.resolution && (
                            <div className="flex gap-3">
                              <div className="flex-shrink-0 h-6 w-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">5</div>
                              <div>
                                <p className="text-xs font-semibold text-purple-700">Resolution / Integration</p>
                                <p className="text-sm text-foreground/80 mt-0.5">{data.deepAnalysis.bookBlueprint.fiveBeatStructure.resolution}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {data.deepAnalysis.bookBlueprint.openingCatalystPrompt && (
                      <div className="mt-4 pt-4 border-t border-border/40">
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Opening Catalyst Prompt</p>
                        <div className="p-3 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-100">
                          <p className="text-sm text-foreground/90">{data.deepAnalysis.bookBlueprint.openingCatalystPrompt}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
              
              {/* Title Ideas Card */}
              {data.deepAnalysis.titleIdeas && data.deepAnalysis.titleIdeas.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.42 }}
                  className="bg-white rounded-2xl border border-border/50 shadow-sm p-5"
                  data-testid="card-title-ideas"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-8 w-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                      <Sparkles size={16} />
                    </div>
                    <h3 className="font-bold text-foreground">Alternative Title Ideas</h3>
                  </div>
                  <div className="space-y-3">
                    {data.deepAnalysis.titleIdeas.slice(0, 5).map((idea, i) => (
                      <div key={i} className="p-3 bg-gradient-to-r from-orange-50 to-amber-50 rounded-xl border border-orange-100">
                        <p className="font-bold text-foreground text-sm">{idea.title}</p>
                        {idea.subtitle && (
                          <p className="text-xs text-muted-foreground mt-0.5">{idea.subtitle}</p>
                        )}
                        {idea.hook && (
                          <p className="text-xs text-orange-600 mt-1 italic">"{idea.hook}"</p>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Next Steps Card */}
              {data.deepAnalysis.nextSteps && data.deepAnalysis.nextSteps.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 }}
                  className="bg-white rounded-2xl border border-border/50 shadow-sm p-5"
                  data-testid="card-next-steps"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-8 w-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                      <ArrowRightCircle size={16} />
                    </div>
                    <h3 className="font-bold text-foreground">Next Steps</h3>
                  </div>
                  
                  <ol className="space-y-3">
                    {data.deepAnalysis.nextSteps.map((step, i) => (
                      <li key={i} className="flex gap-3 text-sm text-foreground/80">
                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold">
                          {i + 1}
                        </span>
                        <span className="pt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                </motion.div>
              )}
            </>
          )}

              {/* Competitor Books */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="overflow-hidden"
              >
                <h3 className="text-lg font-bold mb-4 px-1">Top Competitors</h3>

                {Array.isArray(data.books) && data.books.length > 0 ? (
                  <div className="flex gap-4 overflow-x-auto pb-4 px-1 -mx-1 no-scrollbar">
                    {data.books.map((book, i) => (
                      <div key={i} className="shrink-0 w-32">
                        <div
                          className="w-32 h-48 rounded-lg shadow-md mb-3 relative overflow-hidden"
                          style={{
                            backgroundColor: book.image
                              ? undefined
                              : book.coverColor || "#111827",
                          }}
                        >
                          {book.image ? (
                            <img
                              src={book.image}
                              alt={book.title}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                const parent = target.parentElement as HTMLElement | null;

                                // Hide the broken image
                                target.style.display = "none";

                                // Safely set a fallback background color
                                if (parent) {
                                  parent.style.backgroundColor =
                                    book.coverColor || "#111827"; // slate-ish fallback
                                }
                              }}
                            />
                          ) : null}

                          {/* Dark gradient overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />

                          {/* Rank badge – only if rank is a valid number */}
                          {typeof book.rank === "number" &&
                            !isNaN(book.rank) &&
                            book.rank > 0 && (
                              <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded backdrop-blur-sm">
                                #{book.rank.toLocaleString()}
                              </div>
                            )}

                          {/* Fallback title text when no image */}
                          {!book.image && (
                            <div className="absolute bottom-3 left-3 right-3 text-white font-bold text-sm leading-tight drop-shadow-md">
                              {book.title}
                            </div>
                          )}
                        </div>

                        {/* Text details */}
                        <p className="text-xs font-medium truncate text-foreground">
                          {book.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {book.author || "Unknown author"}
                        </p>

                        {/* Stats line: BSR, rating, reviews, price */}
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {typeof book.rank === "number" &&
                          !isNaN(book.rank) &&
                          book.rank > 0
                            ? `BSR #${book.rank.toLocaleString()}`
                            : "BSR —"}
                          {" · "}
                          Rating{" "}
                          {book.rating != null && !isNaN(book.rating)
                            ? book.rating.toFixed(1)
                            : "—"}
                          {" · "}
                          {book.reviews != null && !isNaN(book.reviews)
                            ? `${book.reviews.toLocaleString()} reviews`
                            : "Reviews —"}
                          {" · "}
                          {typeof book.price === "number" && !isNaN(book.price)
                            ? `$${book.price.toFixed(2)}`
                            : "Price —"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground px-1">
                    No comparable books were found for this niche.
                  </p>
                )}
              </motion.div>

        </div>
      </div>
    </MobileLayout>
  );
}
