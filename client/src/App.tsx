import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Toaster } from "@/components/ui/toaster";
import Home from "@/pages/home";
import Validate from "@/pages/results";
import SavedResults from "@/pages/saved";
import SavedDetail from "@/pages/saved-detail";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <ProtectedRoute>
          <Home />
        </ProtectedRoute>
      </Route>
      <Route path="/validate">
        <ProtectedRoute>
          <Validate />
        </ProtectedRoute>
      </Route>
      <Route path="/saved">
        <ProtectedRoute>
          <SavedResults />
        </ProtectedRoute>
      </Route>
      <Route path="/saved/:id">
        {(params) => (
          <ProtectedRoute>
            <SavedDetail />
          </ProtectedRoute>
        )}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
