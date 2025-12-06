import { useLocation, useParams } from "wouter";
import { MobileLayout } from "@/components/MobileLayout";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { 
  ArrowLeft, CheckCircle2, AlertTriangle, XCircle, 
  BarChart3, Users, DollarSign, Book, TrendingUp, 
  Activity, Award, AlertCircle
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";

interface SavedResult {
  id: string;
  niche: string;
  verdict: string;
  demandScore: string;
  competitionScore: string;
  keyInsights: string | null;
  createdAt: string;
  fullReportJson: any;
}

export default function SavedDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const [result, setResult] = useState<SavedResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchResult() {
      try {
        const response = await fetch(`/api/saved-results/${params.id}`);
        if (response.ok) {
          const data = await response.json();
          setResult(data);
        }
      } catch (error) {
        console.error("Failed to fetch result:", error);
      } finally {
        setLoading(false);
      }
    }
    if (params.id) {
      fetchResult();
    }
  }, [params.id]);

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
            <h2 className="text-xl font-bold text-foreground">Loading Report...</h2>
          </div>
        </div>
      </MobileLayout>
    );
  }

  if (!result) {
    return (
      <MobileLayout>
        <div className="h-full flex flex-col items-center justify-center p-8 text-center">
          <h2 className="text-xl font-bold text-foreground mb-4">Report Not Found</h2>
          <button
            onClick={() => setLocation("/saved")}
            className="px-6 py-3 bg-black text-white rounded-full font-medium"
            data-testid="button-back-to-saved"
          >
            Back to Saved Results
          </button>
        </div>
      </MobileLayout>
    );
  }

  const data = result.fullReportJson;
  const verdict = result.verdict as "GREEN" | "YELLOW" | "RED";

  return (
    <MobileLayout>
      <div className="pb-20">
        {/* Nav */}
        <div className="px-6 py-4 flex items-center gap-4 sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/50">
          <button 
            onClick={() => setLocation("/saved")}
            className="h-10 w-10 bg-white rounded-full flex items-center justify-center shadow-sm border border-border text-foreground/80 hover:bg-gray-50"
            data-testid="button-back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-semibold text-lg truncate flex-1">{result.niche}</h1>
        </div>

        <div className="p-6 space-y-6">
          
          {/* Verdict Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-[2rem] p-8 flex flex-col items-center text-center shadow-xl ${verdictColors[verdict]}`}
          >
            {verdictIcon[verdict]}
            <h2 className="text-3xl font-bold mb-2">{verdict} LIGHT</h2>
            <p className="text-white/90 font-medium leading-snug">{data.verdictReason}</p>
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
              <div className="text-2xl font-bold text-foreground">{data.stats?.competitionLevel || result.competitionScore}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs font-bold uppercase tracking-wide">
                <BarChart3 size={14} /> Demand
              </div>
              <div className="text-2xl font-bold text-foreground">{data.stats?.demandLevel || result.demandScore}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs font-bold uppercase tracking-wide">
                <DollarSign size={14} /> Avg Price
              </div>
              <div className="text-2xl font-bold text-foreground">${(data.stats?.avgPrice || 0).toFixed(2)}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs font-bold uppercase tracking-wide">
                <Book size={14} /> Genre
              </div>
              <div className="text-lg font-bold text-foreground capitalize leading-none mt-1">{data.genre?.subtype || "general"}</div>
            </div>
          </motion.div>

          {/* Detailed Metrics Accordion */}
          {data.detailedStats && (
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
                <AccordionItem value="demand" className="border-b border-border/50">
                  <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-gray-50">
                    <div className="flex items-center gap-3 text-left">
                      <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                        <TrendingUp size={16} />
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">Sales Demand</div>
                        <div className="text-xs text-muted-foreground">BSR & Rank Analysis</div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-5 pb-5 pt-1 space-y-4">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-medium">
                          <span>Very Strong (Rank &lt; 10k)</span>
                          <span>{data.detailedStats.bsrBuckets?.veryStrong || 0} books</span>
                        </div>
                        <Progress value={((data.detailedStats.bsrBuckets?.veryStrong || 0) / (data.detailedStats.totalBooks || 1)) * 100} className="h-2" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-medium">
                          <span>Strong (Rank 10k-100k)</span>
                          <span>{data.detailedStats.bsrBuckets?.strong || 0} books</span>
                        </div>
                        <Progress value={((data.detailedStats.bsrBuckets?.strong || 0) / (data.detailedStats.totalBooks || 1)) * 100} className="h-2" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-medium">
                          <span>Weak (Rank &gt; 300k)</span>
                          <span>{data.detailedStats.bsrBuckets?.weak || 0} books</span>
                        </div>
                        <Progress value={((data.detailedStats.bsrBuckets?.weak || 0) / (data.detailedStats.totalBooks || 1)) * 100} className="h-2" />
                      </div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-xl text-xs text-muted-foreground">
                      {data.detailedStats.evergreenSignal 
                        ? "🌱 Evergreen Signal: Both new and old books are selling well."
                        : "⚠️ Trend Alert: Most sales are coming from very recent books."}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Competition Analysis */}
                <AccordionItem value="competition" className="border-b border-border/50">
                  <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-gray-50">
                    <div className="flex items-center gap-3 text-left">
                      <div className="h-8 w-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
                        <Award size={16} />
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">Competition</div>
                        <div className="text-xs text-muted-foreground">Review Counts & Dominance</div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-5 pb-5 pt-1 space-y-4">
                     <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-2 bg-red-50 rounded-lg">
                          <div className="text-lg font-bold text-red-600">{data.detailedStats.strongCompetitors || 0}</div>
                          <div className="text-[10px] text-muted-foreground leading-tight">Giants<br/>(1000+ revs)</div>
                        </div>
                        <div className="p-2 bg-orange-50 rounded-lg">
                          <div className="text-lg font-bold text-orange-600">{data.detailedStats.midCompetitors || 0}</div>
                          <div className="text-[10px] text-muted-foreground leading-tight">Mid-Tier<br/>(100-1k revs)</div>
                        </div>
                        <div className="p-2 bg-green-50 rounded-lg">
                          <div className="text-lg font-bold text-green-600">{data.detailedStats.lowReviewBooks || 0}</div>
                          <div className="text-[10px] text-muted-foreground leading-tight">New<br/>(&lt;50 revs)</div>
                        </div>
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
                        <div className="font-mono font-medium">${data.detailedStats.priceMin?.toFixed(2)}</div>
                      </div>
                      <div className="h-px bg-border flex-1 mx-4 relative">
                        <div className="absolute left-1/2 -translate-x-1/2 -top-3 text-[10px] bg-white px-1 text-muted-foreground">Median</div>
                        <div className="absolute left-1/2 -translate-x-1/2 top-[-2px] h-2 w-2 bg-black rounded-full"></div>
                        <div className="absolute left-1/2 -translate-x-1/2 top-3 font-bold text-sm">${(data.detailedStats.priceMedian ?? 0).toFixed(2)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground mb-1">Max</div>
                        <div className="font-mono font-medium">${data.detailedStats.priceMax?.toFixed(2)}</div>
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
          )}

          {/* Suggestions */}
          {data.suggestions && data.suggestions.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h3 className="text-lg font-bold mb-4 px-1">Strategic Advice</h3>
              <div className="space-y-3">
                {data.suggestions.map((suggestion: string, i: number) => (
                  <div key={i} className="flex gap-4 p-4 bg-white rounded-2xl border border-border/50 shadow-sm">
                    <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">
                      {i + 1}
                    </div>
                    <p className="text-sm font-medium text-foreground/80">{suggestion}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Competitor Books */}
          {data.books && data.books.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="overflow-hidden"
            >
              <h3 className="text-lg font-bold mb-4 px-1">Top Competitors</h3>
              <div className="flex gap-4 overflow-x-auto pb-4 px-1 -mx-1 no-scrollbar">
                {data.books.map((book: any, i: number) => (
                  <div key={i} className="shrink-0 w-32">
                    <div 
                      className="w-32 h-48 rounded-lg shadow-md mb-3 relative overflow-hidden"
                      style={{ backgroundColor: book.image ? undefined : book.coverColor }}
                    >
                      {book.image ? (
                        <img 
                          src={book.image} 
                          alt={book.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            target.parentElement!.style.backgroundColor = book.coverColor;
                          }}
                        />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                      <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded backdrop-blur-sm">
                        #{book.rank?.toLocaleString()}
                      </div>
                      {!book.image && (
                        <div className="absolute bottom-3 left-3 right-3 text-white font-bold text-sm leading-tight shadow-black drop-shadow-md">
                          {book.title}
                        </div>
                      )}
                    </div>
                    <p className="text-xs font-medium truncate text-foreground">{book.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{book.author}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] font-bold bg-gray-100 px-1.5 rounded text-gray-600">★ {book.rating?.toFixed(1)}</span>
                      <span className="text-[10px] text-muted-foreground">({book.reviews})</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

        </div>
      </div>
    </MobileLayout>
  );
}
