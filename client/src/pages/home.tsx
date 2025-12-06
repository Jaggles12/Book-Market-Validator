import { Link, useLocation } from "wouter";
import { MobileLayout } from "@/components/MobileLayout";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Search, Sparkles, BookOpen, TrendingUp, Loader2, History, LogOut, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function Home() {
  const [idea, setIdea] = useState("");
  const [, setLocation] = useLocation();
  const [trendingNiches, setTrendingNiches] = useState<string[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const { user, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    setLocation('/login');
  };

  useEffect(() => {
    async function fetchTrending() {
      try {
        const response = await fetch("/api/trending");
        const data = await response.json();
        if (data.niches && Array.isArray(data.niches)) {
          setTrendingNiches(data.niches);
        }
      } catch (error) {
        console.error("Failed to fetch trending niches:", error);
        setTrendingNiches([
          "Self-improvement habits for busy professionals",
          "Cozy mystery with small town setting",
          "Personal finance for millennials"
        ]);
      } finally {
        setLoadingTrending(false);
      }
    }
    fetchTrending();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (idea.trim()) {
      setLocation(`/validate?q=${encodeURIComponent(idea)}`);
    }
  };

  return (
    <MobileLayout>
      <div className="px-6 pt-8 pb-20 min-h-full flex flex-col">
        
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12 mt-4"
        >
          <div className="flex items-start justify-between mb-6">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-sm">
              <BookOpen size={24} strokeWidth={2.5} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLocation("/saved")}
                className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-border shadow-sm text-sm font-medium text-foreground/80 hover:bg-gray-50 transition-colors"
                data-testid="button-saved-results"
              >
                <History size={16} />
                Saved
              </button>
              <div className="relative group">
                <button
                  className="flex items-center gap-2 px-3 py-2 bg-white rounded-full border border-border shadow-sm text-sm font-medium text-foreground/80 hover:bg-gray-50 transition-colors"
                  data-testid="button-user-menu"
                >
                  <User size={16} />
                </button>
                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl border border-border shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <div className="p-3 border-b border-border">
                    <p className="text-xs text-muted-foreground">Signed in as</p>
                    <p className="text-sm font-medium text-foreground truncate" data-testid="text-user-email">
                      {user?.email || 'Unknown'}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    data-testid="button-logout"
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-3">
            Book Idea<br />
            <span className="text-primary">Validator</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Discover if your next book has a market before you write a single word.
          </p>
        </motion.div>

        {/* Input Card */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-[2rem] shadow-xl shadow-primary/5 p-1 mb-8 border border-border/50"
        >
          <form onSubmit={handleSearch} className="relative">
            <div className="absolute top-5 left-5 text-muted-foreground">
              <Search size={20} />
            </div>
            <input
              type="text"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Describe your book idea..."
              className="w-full h-16 pl-14 pr-4 rounded-[1.5rem] bg-transparent text-lg font-medium placeholder:text-muted-foreground/50 focus:outline-none"
            />
            <div className="p-2">
              <button 
                type="submit"
                disabled={!idea.trim()}
                className="w-full h-14 bg-black text-white rounded-[1.2rem] font-semibold text-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] hover:bg-gray-900"
              >
                Validate Idea
                <ArrowRight size={20} />
              </button>
            </div>
          </form>
        </motion.div>

        {/* Trending Niches from Amazon Data */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            <TrendingUp size={14} />
            <span>Trending Niches</span>
            {loadingTrending && <Loader2 size={12} className="animate-spin" />}
          </div>
          
          <div className="space-y-3" data-testid="trending-niches-list">
            {loadingTrending ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-4 bg-white rounded-2xl border border-border/50 animate-pulse">
                    <div className="h-5 bg-gray-200 rounded w-3/4"></div>
                  </div>
                ))}
              </div>
            ) : (
              trendingNiches.map((item, i) => (
                <div 
                  key={i}
                  data-testid={`trending-niche-${i}`}
                  onClick={() => setLocation(`/validate?q=${encodeURIComponent(item)}`)}
                  className="p-4 bg-white rounded-2xl border border-border/50 text-foreground/80 font-medium active:bg-gray-50 transition-colors cursor-pointer flex justify-between items-center group"
                >
                  {item}
                  <ArrowRight size={16} className="opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary" />
                </div>
              ))
            )}
          </div>
        </motion.div>

      </div>
    </MobileLayout>
  );
}
