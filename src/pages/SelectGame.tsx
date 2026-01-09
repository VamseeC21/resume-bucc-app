import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Gamepad2, Plus, LogOut } from 'lucide-react';
import { toast } from 'sonner';

interface Game {
  id: string;
  name: string;
  access_token: string;
  created_by: string;
  created_at: string;
}

export default function SelectGame() {
  const { user, loading: authLoading, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [accessToken, setAccessToken] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [myGames, setMyGames] = useState<Game[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (user) {
      fetchMyGames();
    }
  }, [user]);

  const fetchMyGames = async () => {
    if (!user) return;
    
    setIsLoadingGames(true);
    try {
      // Get games user created
      const { data: createdGames, error: createdError } = await supabase
        .from('games')
        .select('*')
        .eq('created_by', user.id);

      if (createdError) throw createdError;

      // Get games user has participated in (has comparisons)
      const { data: comparisons, error: compError } = await supabase
        .from('comparisons')
        .select('game_id')
        .eq('user_id', user.id)
        .limit(1000);

      if (compError) throw compError;

      const participatedGameIds = [...new Set((comparisons || []).map(c => c.game_id))];
      
      let participatedGames: Game[] = [];
      if (participatedGameIds.length > 0) {
        const { data, error } = await supabase
          .from('games')
          .select('*')
          .in('id', participatedGameIds);

        if (error) throw error;
        participatedGames = data || [];
      }

      // Combine and deduplicate
      const allGames = [...(createdGames || []), ...participatedGames];
      const uniqueGames = Array.from(
        new Map(allGames.map(g => [g.id, g])).values()
      );

      uniqueGames.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setMyGames(uniqueGames);
    } catch (err: any) {
      console.error('Error fetching games:', err);
      toast.error('Failed to load games');
    } finally {
      setIsLoadingGames(false);
    }
  };

  const handleJoinGame = async () => {
    if (!accessToken.trim() || !user) return;

    setIsJoining(true);
    try {
      const { data, error } = await supabase.rpc('join_game_by_token', {
        p_access_token: accessToken.trim().toUpperCase(),
        p_user_id: user.id
      });

      if (error) throw error;

      const result = data as unknown as { error?: string } & Game;

      if (result.error) {
        toast.error(result.error);
        return;
      }

      // Store current game in localStorage for session
      localStorage.setItem('currentGameId', result.id);
      localStorage.setItem('currentGameName', result.name);
      
      toast.success(`Joined game: ${result.name}`);
      navigate('/grade');
    } catch (err: any) {
      console.error('Error joining game:', err);
      toast.error(err.message || 'Failed to join game. Invalid access token.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleSelectGame = (game: Game) => {
    localStorage.setItem('currentGameId', game.id);
    localStorage.setItem('currentGameName', game.name);
    navigate('/grade');
  };

  const handleCreateGame = () => {
    navigate('/admin');
  };

  if (authLoading || isLoadingGames) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-4xl py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <img 
              src="/bucc-logo.png" 
              alt="Logo" 
              className="w-10 h-10 object-contain"
            />
            <h1 className="text-2xl font-bold">Resume Sifter</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>

        {/* Join Game Card */}
        <Card className="glass-panel mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gamepad2 className="w-5 h-5" />
              Join a Game
            </CardTitle>
            <CardDescription>
              Enter an access token to join a resume comparison game
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="accessToken" className="sr-only">Access Token</Label>
                <Input
                  id="accessToken"
                  placeholder="Enter 8-character access token (e.g., A1B2C3D4)"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value.toUpperCase())}
                  maxLength={8}
                  disabled={isJoining}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleJoinGame();
                    }
                  }}
                />
              </div>
              <Button 
                onClick={handleJoinGame} 
                disabled={!accessToken.trim() || isJoining}
              >
                {isJoining ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Join'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* My Games */}
        <Card className="glass-panel">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>My Games</CardTitle>
                <CardDescription>
                  Games you created or are participating in
                </CardDescription>
              </div>
              {isAdmin && (
                <Button onClick={handleCreateGame}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create New Game
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {myGames.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Gamepad2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No games yet. Join a game or create one to get started.</p>
                {isAdmin && (
                  <Button 
                    className="mt-4" 
                    onClick={handleCreateGame}
                    variant="outline"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Game
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {myGames.map((game) => (
                  <div
                    key={game.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => handleSelectGame(game)}
                  >
                    <div>
                      <h3 className="font-semibold">{game.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        Token: {game.access_token} • Created {new Date(game.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm">
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

