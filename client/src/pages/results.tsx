import { useLocation } from "wouter";
import { MobileLayout } from "@/components/MobileLayout";
import { useEffect, useState } from "react";
import { validateBookIdea, type MarketAnalysis } from "@/lib/mock-validator";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, BarChart3, Users, DollarSign, Book } from "lucide-react";

export default function Validate() {
  const [location, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MarketAnalysis | null>(null);
  
  const query = new URLSearchParams(window.location.search).get("q") || "";

  useEffect(() => {
    if (!query) {
      setLocation("/");
      return;
    }
    
    validateBookIdea(query).then((result) => {
      setData(result);
      setLoading(false);
    });
  }, [query, setLocation]);

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
          <h1 className="font-semibold text-lg truncate flex-1">{query}</h1>
        </div>

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
              <div className="text-2xl font-bold text-foreground">${data.stats.avgPrice.toFixed(2)}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm">
              <div className="flex items-center gap-2 text-muted-foreground mb-1 text-xs font-bold uppercase tracking-wide">
                <Book size={14} /> Genre
              </div>
              <div className="text-lg font-bold text-foreground capitalize leading-none mt-1">{data.genre.subtype}</div>
            </div>
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

           {/* Competitor Books */}
           <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="overflow-hidden"
          >
            <h3 className="text-lg font-bold mb-4 px-1">Top Competitors</h3>
            <div className="flex gap-4 overflow-x-auto pb-4 px-1 -mx-1 no-scrollbar">
              {data.books.map((book, i) => (
                <div key={i} className="shrink-0 w-32">
                  <div 
                    className="w-32 h-48 rounded-lg shadow-md mb-3 relative overflow-hidden"
                    style={{ backgroundColor: book.coverColor }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 text-white font-bold text-sm leading-tight shadow-black drop-shadow-md">
                      {book.title}
                    </div>
                  </div>
                  <p className="text-xs font-medium truncate text-foreground">{book.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{book.author}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[10px] font-bold bg-gray-100 px-1.5 rounded text-gray-600">★ {book.rating.toFixed(1)}</span>
                    <span className="text-[10px] text-muted-foreground">({book.reviews})</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

        </div>
      </div>
    </MobileLayout>
  );
}
