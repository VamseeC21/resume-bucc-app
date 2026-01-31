import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Auth from "./pages/Auth";
import SelectGame from "./pages/SelectGame";
import Grade from "./pages/Grade";
import Admin from "./pages/Admin";
import Apply from "./pages/Apply";
import GradeVideos from "./pages/GradeVideos";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/apply" replace />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/apply" element={<Apply />} />
            <Route path="/apply/form" element={<Apply />} />
            <Route path="/select-game" element={<SelectGame />} />
            <Route path="/grade" element={<Grade />} />
            <Route path="/grade-videos" element={<GradeVideos />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
