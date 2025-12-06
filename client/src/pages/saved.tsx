import { useLocation } from "wouter";
import { MobileLayout } from "@/components/MobileLayout";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { 
  ArrowLeft, CheckCircle2, AlertTriangle, XCircle, 
  Download, Clock, ChevronRight, FileText, Inbox, X
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";

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

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { "Authorization": `Bearer ${session.access_token}` };
    }
  } catch (error) {
    console.warn("Failed to get auth session:", error);
  }
  return {};
}

export default function SavedResults() {
  const [, setLocation] = useLocation();
  const [results, setResults] = useState<SavedResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchResults() {
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch("/api/saved-results", {
          headers: authHeaders,
        });
        if (!response.ok) {
          console.error("Failed to fetch saved results:", response.status);
          return;
        }
        const data = await response.json();
        if (Array.isArray(data)) {
          setResults(data);
        }
      } catch (error) {
        console.error("Failed to fetch saved results:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchResults();
  }, []);

  const handleExportCSV = () => {
    window.location.href = "/api/saved-results/export/csv";
  };

  const handleViewResult = (id: string) => {
    setLocation(`/saved/${id}`);
  };

  const handleDeleteResult = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/saved-results/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (response.ok) {
        setResults(results.filter(r => r.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete result:", error);
    }
  };

  const groupedResults = {
    GREEN: results.filter(r => r.verdict === "GREEN"),
    YELLOW: results.filter(r => r.verdict === "YELLOW"),
    RED: results.filter(r => r.verdict === "RED"),
  };

  const verdictConfig = {
    GREEN: {
      icon: <CheckCircle2 size={16} />,
      label: "Green Light",
      color: "bg-emerald-500",
      textColor: "text-emerald-600",
      bgColor: "bg-emerald-50",
      borderColor: "border-emerald-200",
    },
    YELLOW: {
      icon: <AlertTriangle size={16} />,
      label: "Caution",
      color: "bg-amber-500",
      textColor: "text-amber-600",
      bgColor: "bg-amber-50",
      borderColor: "border-amber-200",
    },
    RED: {
      icon: <XCircle size={16} />,
      label: "Not Recommended",
      color: "bg-rose-500",
      textColor: "text-rose-600",
      bgColor: "bg-rose-50",
      borderColor: "border-rose-200",
    },
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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
            <h2 className="text-xl font-bold text-foreground">Loading Results...</h2>
            <p className="text-muted-foreground mt-2">Fetching your saved validations.</p>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="pb-20">
        {/* Nav */}
        <div className="px-6 py-4 flex items-center gap-4 sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/50">
          <button 
            onClick={() => setLocation("/")}
            className="h-10 w-10 bg-white rounded-full flex items-center justify-center shadow-sm border border-border text-foreground/80 hover:bg-gray-50"
            data-testid="button-back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="font-semibold text-lg truncate flex-1">Saved Results</h1>
          {results.length > 0 && (
            <button 
              onClick={handleExportCSV}
              className="h-10 px-4 bg-white rounded-full flex items-center justify-center gap-2 shadow-sm border border-border text-foreground/80 hover:bg-gray-50 text-sm font-medium"
              data-testid="button-export-csv"
            >
              <Download size={16} />
              CSV
            </button>
          )}
        </div>

        <div className="p-6 space-y-6">
          {results.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                <Inbox size={32} className="text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">No Saved Results</h3>
              <p className="text-muted-foreground text-sm max-w-xs">
                Validate your first book idea to see it saved here for future reference.
              </p>
              <button
                onClick={() => setLocation("/")}
                className="mt-6 px-6 py-3 bg-black text-white rounded-full font-medium text-sm hover:bg-gray-900 transition-colors"
                data-testid="button-validate-first"
              >
                Validate Your First Idea
              </button>
            </motion.div>
          ) : (
            <>
              {(["GREEN", "YELLOW", "RED"] as const).map((verdict) => {
                const items = groupedResults[verdict];
                if (items.length === 0) return null;
                
                const config = verdictConfig[verdict];
                
                return (
                  <motion.div
                    key={verdict}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`h-6 w-6 rounded-full ${config.color} text-white flex items-center justify-center`}>
                        {config.icon}
                      </div>
                      <h3 className="font-semibold text-foreground">{config.label}</h3>
                      <span className="text-xs text-muted-foreground bg-gray-100 px-2 py-0.5 rounded-full">
                        {items.length}
                      </span>
                    </div>
                    
                    <div className="space-y-2">
                      {items.map((result) => (
                        <div
                          key={result.id}
                          onClick={() => handleViewResult(result.id)}
                          className={`p-4 bg-white rounded-2xl border ${config.borderColor} cursor-pointer hover:shadow-md transition-all group`}
                          data-testid={`card-result-${result.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-foreground truncate mb-1">
                                {result.niche}
                              </h4>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Clock size={12} />
                                  {formatDate(result.createdAt)}
                                </span>
                                <span>Demand: {result.demandScore}</span>
                                <span>Competition: {result.competitionScore}</span>
                              </div>
                              {result.keyInsights && (
                                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                                  {result.keyInsights}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => handleDeleteResult(result.id, e)}
                                className="h-7 w-7 rounded-full bg-gray-100 hover:bg-red-100 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
                                data-testid={`button-delete-${result.id}`}
                              >
                                <X size={14} />
                              </button>
                              <ChevronRight size={20} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
