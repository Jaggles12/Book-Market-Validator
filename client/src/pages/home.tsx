import { useLocation } from "wouter";
import { MobileLayout } from "@/components/MobileLayout";
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Search,
  BookOpen,
  TrendingUp,
  Loader2,
  History,
  LogOut,
  User,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (minutes < 1) return "Just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  return "Over a day ago";
}

export default function Home() {
  const [idea, setIdea] = useState("");
  const [bookType, setBookType] = useState<"fiction" | "nonfiction" | null>(
    null
  );
  const [, setLocation] = useLocation();
  const [trendingNiches, setTrendingNiches] = useState<string[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [refreshingTrending, setRefreshingTrending] = useState(false);
  const [trendingTimestamp, setTrendingTimestamp] = useState<number | null>(
    null
  );
  const [trendingError, setTrendingError] = useState<string | null>(null);
  const [isDefaultData, setIsDefaultData] = useState(false);
  const { user, signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    setLocation("/login");
  };

  const fetchTrending = useCallback(async (forceRefresh = false) => {
    try {
      setTrendingError(null);

      const url = forceRefresh ? "/api/trending/refresh" : "/api/trending";
      const options = forceRefresh ? { method: "POST" } : {};

      const response = await fetch(url, options);
      const data = await response.json();

      if (data.niches && Array.isArray(data.niches)) {
        setTrendingNiches(data.niches);
        setTrendingTimestamp(data.timestamp || Date.now());
        setIsDefaultData(data.isDefault || false);

        if (data.error) {
          setTrendingError(data.error);
        }
      }
    } catch (error) {
      console.error("Failed to fetch trending niches:", error);
      setTrendingError("Unable to load trending niches");
      setTrendingNiches([
        "Self-improvement habits for busy professionals",
        "Cozy mystery with small town setting",
        "Personal finance for millennials",
      ]);
      setTrendingTimestamp(Date.now());
      setIsDefaultData(true);
    }
  }, []);

  useEffect(() => {
    async function loadInitial() {
      await fetchTrending(false);
      setLoadingTrending(false);
    }
    loadInitial();
  }, [fetchTrending]);

  const handleRefreshTrending = async () => {
    setRefreshingTrending(true);
    await fetchTrending(true);
    setRefreshingTrending(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea.trim() || !bookType) return;

    const params = new URLSearchParams();
    params.set("q", idea);
    params.set("type", bookType);

    setLocation(`/validate?${params.toString()}`);
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
                    <p
                      className="text-sm font-medium text-foreground truncate"
                      data-testid="text-user-email"
                    >
                      {user?.email || "Unknown"}
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
            Book Market
            <br />
            <span className="text-primary">Validator</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Discover if your next book has a market before you write a single
            word.
          </p>
        </motion.div>

        {/* Input Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-[2rem] shadow-xl shadow-primary/5 px-5 pt-5 pb-4 mb-8 border border-border/50"
        >
          <form onSubmit={handleSearch} className="space-y-4">
            {/* Step 1: Book type selection */}
            <div className="border-b border-border/40 pb-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
                Step 1 · Choose book type
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBookType("fiction")}
                  className={[
                    "flex-1 flex items-center justify-center gap-2 rounded-full border text-sm font-medium py-2 transition-colors",
                    bookType === "fiction"
                      ? "bg-black text-white border-black shadow-sm"
                      : "bg-white text-foreground/80 border-border hover:bg-gray-50",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "h-2.5 w-2.5 rounded-full border",
                      bookType === "fiction"
                        ? "bg-white border-white"
                        : "bg-transparent border-border",
                    ].join(" ")}
                  />
                  <span>Fiction</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBookType("nonfiction")}
                  className={[
                    "flex-1 flex items-center justify-center gap-2 rounded-full border text-sm font-medium py-2 transition-colors",
                    bookType === "nonfiction"
                      ? "bg-black text-white border-black shadow-sm"
                      : "bg-white text-foreground/80 border-border hover:bg-gray-50",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "h-2.5 w-2.5 rounded-full border",
                      bookType === "nonfiction"
                        ? "bg-white border-white"
                        : "bg-transparent border-border",
                    ].join(" ")}
                  />
                  <span>Nonfiction</span>
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                We use this to choose the right comps, structure, and next steps
                for your book.
              </p>
            </div>

            {/* Step 2: Idea input */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Step 2 · Describe your book idea
              </p>
              <div className="relative">
                <div className="absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                  <Search size={18} />
                </div>
                <input
                  type="text"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="e.g. A single mom finds an anonymous journal about her teen's secret struggles..."
                  className="w-full h-14 pl-10 pr-4 rounded-2xl bg-gray-50/70 text-sm md:text-base font-medium placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white transition-all"
                  data-testid="input-book-idea"
                />
              </div>
            </div>

            {/* Submit */}
            <div>
              <button
                type="submit"
                disabled={!idea.trim() || !bookType}
                className="w-full h-12 bg-black text-white rounded-2xl font-semibold text-sm md:text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] hover:bg-gray-900"
                data-testid="button-validate"
              >
                Validate Idea
                <ArrowRight size={18} />
              </button>
              <p className="mt-2 text-[11px] text-muted-foreground text-center">
                We’ll scan Amazon bestsellers and show demand, competition, and
                a custom book blueprint.
              </p>
            </div>
          </form>
        </motion.div>

        {/* Trending Niches from Amazon Data */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <TrendingUp size={14} />
              <span>Trending Niches</span>
              {(loadingTrending || refreshingTrending) && (
                <Loader2 size={12} className="animate-spin" />
              )}
            </div>
            <button
              onClick={handleRefreshTrending}
              disabled={loadingTrending || refreshingTrending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-refresh-trending"
            >
              <RefreshCw
                size={12}
                className={refreshingTrending ? "animate-spin" : ""}
              />
              Refresh
            </button>
          </div>

          {/* Timestamp and status */}
          <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
            {trendingTimestamp && (
              <span data-testid="text-trending-timestamp">
                Updated {formatTimeAgo(trendingTimestamp)}
              </span>
            )}
            {isDefaultData && !trendingError && (
              <span className="text-amber-600">(sample ideas)</span>
            )}
          </div>

          {/* Error message */}
          {trendingError && (
            <div
              className="flex items-center gap-2 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm"
              data-testid="alert-trending-error"
            >
              <AlertCircle size={16} />
              <span>{trendingError}</span>
            </div>
          )}

          <div className="space-y-3" data-testid="trending-niches-list">
            {loadingTrending ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="p-4 bg-white rounded-2xl border border-border/50 animate-pulse"
                  >
                    <div className="h-5 bg-gray-200 rounded w-3/4"></div>
                  </div>
                ))}
              </div>
            ) : (
              trendingNiches.map((item, i) => (
                <div
                  key={i}
                  data-testid={`trending-niche-${i}`}
                  onClick={() =>
                    setLocation(`/validate?q=${encodeURIComponent(item)}`)
                  }
                  className="p-4 bg-white rounded-2xl border border-border/50 text-foreground/80 font-medium active:bg-gray-50 transition-colors cursor-pointer flex justify-between items-center group"
                >
                  {item}
                  <ArrowRight
                    size={16}
                    className="opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-primary"
                  />
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </MobileLayout>
  );
}
