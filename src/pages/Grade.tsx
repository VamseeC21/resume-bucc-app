import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronLeft, ChevronRight, LogOut, Settings, Trophy } from 'lucide-react';
import { toast } from 'sonner';

interface ResumeData {
  id: string;
  name: string;
  grade: string | null;
  pdfPath: string;
}

interface PairData {
  resumeA: ResumeData;
  resumeB: ResumeData;
  pairHash: string;
}

export default function Grade() {
  const { user, role, loading: authLoading, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [currentGameName, setCurrentGameName] = useState<string>('');
  const [pair, setPair] = useState<PairData | null>(null);
  const [pdfUrlA, setPdfUrlA] = useState<string | null>(null);
  const [pdfUrlB, setPdfUrlB] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [totalComparisons, setTotalComparisons] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const getSignedUrl = async (path: string): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from('resumes')
      .createSignedUrl(path, 3600); // 1 hour expiry
    
    if (error) {
      console.error('Error getting signed URL:', error);
      return null;
    }
    return data.signedUrl;
  };

  const fetchNextPair = useCallback(async () => {
    if (!user || !currentGameId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const { data, error } = await supabase.rpc('get_next_pair', {
        p_user_id: user.id,
        p_game_id: currentGameId
      });

      if (error) throw error;

      const result = data as unknown as { error?: string } & PairData;

      if (result.error) {
        setError(result.error);
        setPair(null);
        return;
      }

      setPair(result);

      // Get signed URLs for PDFs
      const [urlA, urlB] = await Promise.all([
        getSignedUrl(result.resumeA.pdfPath),
        getSignedUrl(result.resumeB.pdfPath)
      ]);

      setPdfUrlA(urlA);
      setPdfUrlB(urlB);
    } catch (err) {
      console.error('Error fetching pair:', err);
      setError('Failed to load resumes. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [user, currentGameId]);

  const fetchComparisonCount = useCallback(async () => {
    if (!user || !currentGameId) return;
    
    const { data, error } = await supabase.rpc('get_user_comparison_count', {
      p_user_id: user.id,
      p_game_id: currentGameId
    });

    if (!error && data !== null) {
      setTotalComparisons(data);
    }
  }, [user, currentGameId]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
      return;
    }

    // Check for current game
    const gameId = localStorage.getItem('currentGameId');
    const gameName = localStorage.getItem('currentGameName');
    
    if (!gameId) {
      navigate('/select-game');
      return;
    }

    setCurrentGameId(gameId);
    setCurrentGameName(gameName || 'Current Game');
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (user && currentGameId) {
      fetchNextPair();
      fetchComparisonCount();
    }
  }, [user, currentGameId]);

  const handleSelect = async (winnerId: string) => {
    if (!user || !pair || !currentGameId || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.rpc('submit_comparison', {
        p_user_id: user.id,
        p_game_id: currentGameId,
        p_resume_a: pair.resumeA.id,
        p_resume_b: pair.resumeB.id,
        p_winner: winnerId
      });

      if (error) throw error;

      const result = data as unknown as { success?: boolean; totalComparisons?: number; error?: string };

      if (result.error) {
        toast.error(result.error);
        return;
      }

      if (result.totalComparisons) {
        setTotalComparisons(result.totalComparisons);
      }

      toast.success('Vote recorded!');
      
      // Immediately fetch next pair
      await fetchNextPair();
    } catch (err: any) {
      console.error('Error submitting comparison:', err);
      if (err.message?.includes('unique_user_pair')) {
        toast.error('You already graded this pair');
        await fetchNextPair();
      } else {
        toast.error('Failed to submit. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || (isLoading && !pair)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading resumes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="/bucc-logo.png" 
              alt="Logo" 
              className="w-10 h-10 object-contain"
            />
            <div>
              <span className="font-semibold text-lg">Resume Sifter</span>
              {currentGameName && (
                <span className="text-sm text-muted-foreground ml-2">• {currentGameName}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="stat-card flex items-center gap-2 py-2">
              <Trophy className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">{totalComparisons} comparisons</span>
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/select-game')}
            >
              Change Game
            </Button>
            
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/admin')}
              >
                <Settings className="w-4 h-4 mr-2" />
                Admin
              </Button>
            )}
            
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {error ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
              <Trophy className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-bold mb-2">All Done!</h2>
            <p className="text-muted-foreground text-center max-w-md">{error}</p>
          </div>
        ) : pair ? (
          <div className="grid grid-cols-2 gap-6 h-[calc(100vh-12rem)]">
            {/* Resume A */}
            <div className="flex flex-col animate-slide-in-left">
              <Card className="flex-1 flex flex-col glass-panel">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl">{pair.resumeA.name}</CardTitle>
                      {pair.resumeA.grade && (
                        <Badge variant="secondary" className="mt-2">
                          {pair.resumeA.grade}
                        </Badge>
                      )}
                    </div>
                    <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <ChevronLeft className="w-5 h-5 text-emerald-500" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-4">
                  <div className="pdf-container h-full">
                    {pdfUrlA ? (
                      <iframe
                        src={`${pdfUrlA}#toolbar=0&navpanes=0`}
                        className="w-full h-full"
                        title={`Resume: ${pair.resumeA.name}`}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Button
                className="mt-4 winner-button winner-button-left h-14 text-lg font-semibold"
                onClick={() => handleSelect(pair.resumeA.id)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <ChevronLeft className="w-5 h-5 mr-2" />
                    Select Left
                  </>
                )}
              </Button>
            </div>

            {/* Resume B */}
            <div className="flex flex-col animate-slide-in-right">
              <Card className="flex-1 flex flex-col glass-panel">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                      <ChevronRight className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="text-right">
                      <CardTitle className="text-xl">{pair.resumeB.name}</CardTitle>
                      {pair.resumeB.grade && (
                        <Badge variant="secondary" className="mt-2">
                          {pair.resumeB.grade}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-4">
                  <div className="pdf-container h-full">
                    {pdfUrlB ? (
                      <iframe
                        src={`${pdfUrlB}#toolbar=0&navpanes=0`}
                        className="w-full h-full"
                        title={`Resume: ${pair.resumeB.name}`}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Button
                className="mt-4 winner-button winner-button-right h-14 text-lg font-semibold"
                onClick={() => handleSelect(pair.resumeB.id)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Select Right
                    <ChevronRight className="w-5 h-5 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
