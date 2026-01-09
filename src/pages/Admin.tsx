import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { 
  Loader2, Upload, Trophy, Users, FileText, ArrowLeft, Search,
  ChevronUp, ChevronDown, Edit2, Check, X, Gamepad2, Plus, Copy, Eye
} from 'lucide-react';
import { toast } from 'sonner';

interface Resume {
  id: string;
  name: string;
  grade: string | null;
  pdf_path: string;
  active: boolean;
  created_at: string;
  rating?: number;
  games?: number;
}

interface Comparison {
  id: string;
  created_at: string;
  user_id: string;
  resume_a_id: string;
  resume_b_id: string;
  winner_id: string;
  resume_a_name?: string;
  resume_b_name?: string;
  winner_name?: string;
  user_first_name?: string;
  user_last_name?: string;
}

interface Profile {
  id: string;
  role: string;
  created_at: string;
  first_name?: string;
  last_name?: string;
}

interface Game {
  id: string;
  name: string;
  access_token: string;
  created_by: string;
  created_at: string;
}

export default function Admin() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState('games');
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  
  // Games state
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedGameName, setSelectedGameName] = useState<string>('');
  const [newGameName, setNewGameName] = useState('');
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [newGameToken, setNewGameToken] = useState<string | null>(null);
  
  // Rankings state
  const [rankings, setRankings] = useState<Resume[]>([]);
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [grades, setGrades] = useState<string[]>([]);
  
  // Audit state
  const [graders, setGraders] = useState<Profile[]>([]);
  const [selectedGrader, setSelectedGrader] = useState<string>('');
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [isLoadingComparisons, setIsLoadingComparisons] = useState(false);
  
  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editGrade, setEditGrade] = useState('');
  
  // Resume preview modal state
  const [previewResume, setPreviewResume] = useState<Resume | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) {
      navigate('/select-game');
    }
  }, [authLoading, user, isAdmin, navigate]);

  useEffect(() => {
    if (user) {
      // Load selected game from localStorage if exists
      const savedGameId = localStorage.getItem('currentGameId');
      if (savedGameId) {
        setSelectedGameId(savedGameId);
        const savedGameName = localStorage.getItem('currentGameName');
        if (savedGameName) setSelectedGameName(savedGameName);
      }
      fetchGames();
    }
  }, [user]);

  const fetchGames = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('games')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGames(data || []);
      
      // Auto-select first game if none selected and no saved game
      if (data && data.length > 0) {
        const savedGameId = localStorage.getItem('currentGameId');
        if (!savedGameId) {
          setSelectedGameId(data[0].id);
          setSelectedGameName(data[0].name);
          localStorage.setItem('currentGameId', data[0].id);
          localStorage.setItem('currentGameName', data[0].name);
        }
      }
    } catch (err) {
      console.error('Error fetching games:', err);
      toast.error('Failed to load games');
    }
  }, [user]);

  const createGame = async () => {
    if (!newGameName.trim() || !user) {
      toast.error('Please enter a game name');
      return;
    }
    
    setIsCreatingGame(true);
    console.log('Creating game:', { name: newGameName.trim(), userId: user.id });
    
    // Add timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      console.error('RPC call timed out after 10 seconds');
      toast.error('Request timed out. The function may not exist or there may be a database connection issue.');
      setIsCreatingGame(false);
    }, 10000);
    
    try {
      console.log('Calling RPC create_game...');
      const { data, error } = await supabase.rpc('create_game', {
        p_name: newGameName.trim(),
        p_created_by: user.id
      });
      
      clearTimeout(timeoutId);

      console.log('RPC Response:', { data, error });

      if (error) {
        console.error('RPC Error:', error);
        toast.error(`Error: ${error.message || error.code || 'Unknown error'}`);
        setIsCreatingGame(false);
        return;
      }

      if (!data) {
        console.error('No data returned');
        toast.error('No response from server. Please check your database connection.');
        setIsCreatingGame(false);
        return;
      }

      // Handle case where function returns error in JSON
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      
      if (result.error) {
        console.error('Function returned error:', result.error);
        toast.error(result.error);
        setIsCreatingGame(false);
        return;
      }

      // Check if result has required fields
      if (!result.id || !result.access_token) {
        console.error('Invalid game result:', result);
        toast.error('Invalid response format from server');
        setIsCreatingGame(false);
        return;
      }

      console.log('Game created successfully:', result);
      toast.success(`Game "${result.name}" created!`);
      setNewGameToken(result.access_token);
      setNewGameName('');
      
      // Refresh games list
      await fetchGames();
      
      // Auto-select the new game
      setSelectedGameId(result.id);
      setSelectedGameName(result.name);
      localStorage.setItem('currentGameId', result.id);
      localStorage.setItem('currentGameName', result.name);
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error('Exception creating game:', err);
      let errorMessage = 'Failed to create game. ';
      
      if (err.message?.includes('function') || err.message?.includes('does not exist')) {
        errorMessage += 'The create_game function is missing. Please run the SQL migration in Supabase.';
      } else if (err.message?.includes('permission') || err.message?.includes('policy')) {
        errorMessage += 'Permission denied. Check your database policies.';
      } else if (err.message) {
        errorMessage += err.message;
      } else if (err.code) {
        errorMessage += `Error code: ${err.code}`;
      } else {
        errorMessage += 'Unknown error occurred. Check the console for details.';
      }
      
      toast.error(errorMessage, { duration: 8000 });
    } finally {
      clearTimeout(timeoutId);
      console.log('Setting isCreatingGame to false');
      setIsCreatingGame(false);
    }
  };

  const copyAccessToken = (token: string) => {
    navigator.clipboard.writeText(token);
    toast.success('Access token copied to clipboard!');
  };

  const selectGame = (game: Game) => {
    setSelectedGameId(game.id);
    setSelectedGameName(game.name);
    localStorage.setItem('currentGameId', game.id);
    localStorage.setItem('currentGameName', game.name);
    fetchRankings();
  };

  const fetchRankings = useCallback(async () => {
    if (!selectedGameId) return;
    
    setIsLoading(true);
    try {
      // Fetch resumes with ratings for selected game
      const { data: resumes, error: resumeError } = await supabase
        .from('resumes')
        .select('*')
        .eq('game_id', selectedGameId)
        .order('created_at', { ascending: false });

      if (resumeError) throw resumeError;

      const { data: ratings, error: ratingError } = await supabase
        .from('elo_ratings')
        .select('*');

      if (ratingError) throw ratingError;

      // Merge ratings with resumes
      const merged = (resumes || []).map(resume => {
        const rating = ratings?.find(r => r.resume_id === resume.id);
        return {
          ...resume,
          rating: rating?.rating ?? 1500,
          games: rating?.games ?? 0
        };
      });

      // Sort by rating descending
      merged.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      setRankings(merged);

      // Extract unique grades
      const uniqueGrades = [...new Set(resumes?.filter(r => r.grade).map(r => r.grade!) || [])];
      setGrades(uniqueGrades);
    } catch (err) {
      console.error('Error fetching rankings:', err);
      toast.error('Failed to load rankings');
    } finally {
      setIsLoading(false);
    }
  }, [selectedGameId]);

  const fetchGraders = useCallback(async () => {
    if (!selectedGameId) return;
    
    try {
      // Get unique graders who have participated in this game
      const { data: comps } = await supabase
        .from('comparisons')
        .select('user_id')
        .eq('game_id', selectedGameId)
        .limit(1000);

      if (!comps || comps.length === 0) {
        setGraders([]);
        return;
      }

      const uniqueUserIds = [...new Set(comps.map(c => c.user_id))];
      
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, role, created_at, first_name, last_name')
        .in('id', uniqueUserIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGraders(profiles || []);
    } catch (err) {
      console.error('Error fetching graders:', err);
    }
  }, [selectedGameId]);

  const fetchComparisons = useCallback(async (graderId: string) => {
    if (!selectedGameId) return;
    
    setIsLoadingComparisons(true);
    try {
      const { data: comps, error } = await supabase
        .from('comparisons')
        .select('*')
        .eq('user_id', graderId)
        .eq('game_id', selectedGameId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Get resume names
      const resumeIds = new Set<string>();
      (comps || []).forEach(c => {
        resumeIds.add(c.resume_a_id);
        resumeIds.add(c.resume_b_id);
        resumeIds.add(c.winner_id);
      });

      const { data: resumes } = await supabase
        .from('resumes')
        .select('id, name')
        .in('id', Array.from(resumeIds));

      const resumeMap = new Map(resumes?.map(r => [r.id, r.name]) || []);

      // Get user profile with name
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', graderId)
        .single();

      const enriched = (comps || []).map(c => ({
        ...c,
        resume_a_name: resumeMap.get(c.resume_a_id) || 'Unknown',
        resume_b_name: resumeMap.get(c.resume_b_id) || 'Unknown',
        winner_name: resumeMap.get(c.winner_id) || 'Unknown',
        user_first_name: profile?.first_name || null,
        user_last_name: profile?.last_name || null
      }));

      setComparisons(enriched);
    } catch (err) {
      console.error('Error fetching comparisons:', err);
      toast.error('Failed to load comparisons');
    } finally {
      setIsLoadingComparisons(false);
    }
  }, [selectedGameId]);

  useEffect(() => {
    if (user && isAdmin && selectedGameId) {
      fetchRankings();
      fetchGraders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin, selectedGameId]);

  useEffect(() => {
    if (selectedGrader) {
      fetchComparisons(selectedGrader);
    } else {
      setComparisons([]);
    }
  }, [selectedGrader, fetchComparisons]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const file of Array.from(files)) {
        if (file.type !== 'application/pdf') {
          toast.error(`${file.name} is not a PDF`);
          errorCount++;
          continue;
        }

        // Upload to storage
        const fileName = `${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('resumes')
          .upload(fileName, file);

        if (uploadError) {
          console.error('Upload error:', uploadError);
          toast.error(`Failed to upload ${file.name}`);
          errorCount++;
          continue;
        }

        // Create resume record (trigger creates elo_ratings)
        if (!selectedGameId) {
          toast.error('Please select a game first');
          errorCount++;
          continue;
        }

        const { error: insertError } = await supabase
          .from('resumes')
          .insert({
            name: file.name.replace('.pdf', ''),
            pdf_path: fileName,
            game_id: selectedGameId
          });

        if (insertError) {
          console.error('Insert error:', insertError);
          toast.error(`Failed to save ${file.name}`);
          errorCount++;
          continue;
        }

        successCount++;
      }

      if (successCount > 0) {
        toast.success(`Uploaded ${successCount} resume(s)`);
        fetchRankings();
      }
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleEdit = (resume: Resume) => {
    setEditingId(resume.id);
    setEditName(resume.name);
    setEditGrade(resume.grade || '');
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    try {
      const { error } = await supabase
        .from('resumes')
        .update({ name: editName, grade: editGrade || null })
        .eq('id', editingId);

      if (error) throw error;
      
      toast.success('Resume updated');
      setEditingId(null);
      fetchRankings();
    } catch (err) {
      console.error('Error updating resume:', err);
      toast.error('Failed to update resume');
    }
  };

  const handlePreviewResume = async (resume: Resume) => {
    setPreviewResume(resume);
    setIsLoadingPreview(true);
    setPreviewPdfUrl(null);

    try {
      const { data, error } = await supabase.storage
        .from('resumes')
        .createSignedUrl(resume.pdf_path, 3600); // 1 hour expiry

      if (error) throw error;
      setPreviewPdfUrl(data.signedUrl);
    } catch (err) {
      console.error('Error loading PDF:', err);
      toast.error('Failed to load resume PDF');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const filteredRankings = rankings.filter(r => {
    const matchesGrade = gradeFilter === 'all' || r.grade === gradeFilter;
    const matchesSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesGrade && matchesSearch;
  });

  const getRankBadge = (index: number) => {
    if (index === 0) return <span className="rank-badge rank-gold">1</span>;
    if (index === 1) return <span className="rank-badge rank-silver">2</span>;
    if (index === 2) return <span className="rank-badge rank-bronze">3</span>;
    return <span className="rank-badge bg-muted text-muted-foreground">{index + 1}</span>;
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/grade')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Grading
            </Button>
            <div className="h-6 w-px bg-border" />
            <span className="font-semibold text-lg">Admin Dashboard</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="games" className="flex items-center gap-2">
              <Gamepad2 className="w-4 h-4" />
              Games
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload Resumes
            </TabsTrigger>
            <TabsTrigger value="rankings" className="flex items-center gap-2">
              <Trophy className="w-4 h-4" />
              Rankings
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Audit / Votes
            </TabsTrigger>
          </TabsList>

          {/* Games Tab */}
          <TabsContent value="games">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle>Create New Game</CardTitle>
                  <CardDescription>Create a new resume comparison game</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="gameName">Game Name</Label>
                      <Input
                        id="gameName"
                        placeholder="e.g., Spring 2024 Resume Review"
                        value={newGameName}
                        onChange={(e) => setNewGameName(e.target.value)}
                        disabled={isCreatingGame}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newGameName.trim()) {
                            createGame();
                          }
                        }}
                      />
                    </div>
                    <Button 
                      onClick={createGame} 
                      disabled={!newGameName.trim() || isCreatingGame}
                      className="w-full"
                    >
                      {isCreatingGame ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          Create Game
                        </>
                      )}
                    </Button>
                    {newGameToken && (
                      <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                        <p className="text-sm font-medium mb-2">Game Created!</p>
                        <p className="text-xs text-muted-foreground mb-2">Share this access token with participants:</p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 px-3 py-2 bg-background rounded border text-lg font-mono font-bold">
                            {newGameToken}
                          </code>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyAccessToken(newGameToken)}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 w-full"
                          onClick={() => setNewGameToken(null)}
                        >
                          Close
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle>My Games</CardTitle>
                  <CardDescription>Games you've created</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {games.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        No games created yet. Create your first game to get started.
                      </p>
                    ) : (
                      games.map((game) => (
                        <div
                          key={game.id}
                          className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                            selectedGameId === game.id
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:bg-muted/50 cursor-pointer'
                          }`}
                          onClick={() => selectGame(game)}
                        >
                          <div className="flex-1">
                            <h3 className="font-semibold">{game.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              Token: <code className="font-mono">{game.access_token}</code>
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Created {new Date(game.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          {selectedGameId === game.id && (
                            <Badge variant="default">Active</Badge>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  {selectedGameId && (
                    <div className="mt-4 p-3 rounded-lg bg-muted">
                      <p className="text-sm font-medium mb-2">Currently Managing:</p>
                      <p className="text-lg font-semibold">{selectedGameName}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        All uploads and rankings will be for this game
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Upload Tab */}
          <TabsContent value="upload">
            {!selectedGameId ? (
              <Card className="glass-panel">
                <CardContent className="py-12">
                  <div className="text-center">
                    <Gamepad2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <h3 className="text-lg font-semibold mb-2">No Game Selected</h3>
                    <p className="text-muted-foreground mb-4">
                      Please select or create a game first before uploading resumes.
                    </p>
                    <Button onClick={() => setActiveTab('games')}>
                      Go to Games
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="glass-panel">
                  <CardHeader>
                    <CardTitle>Upload New Resumes</CardTitle>
                    <CardDescription>
                      Upload PDF files to add to "{selectedGameName}"
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                    <input
                      type="file"
                      accept=".pdf"
                      multiple
                      onChange={handleFileUpload}
                      disabled={isUploading}
                      className="hidden"
                      id="file-upload"
                    />
                    <label htmlFor="file-upload" className="cursor-pointer">
                      {isUploading ? (
                        <div className="flex flex-col items-center">
                          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
                          <p className="text-muted-foreground">Uploading...</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <Upload className="w-10 h-10 text-muted-foreground mb-4" />
                          <p className="text-lg font-medium mb-1">Drop PDFs here or click to upload</p>
                          <p className="text-sm text-muted-foreground">Multiple files supported</p>
                        </div>
                      )}
                    </label>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle>Recent Uploads</CardTitle>
                  <CardDescription>Edit name and grade for uploaded resumes</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {rankings.slice(0, 10).map(resume => (
                      <div
                        key={resume.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                      >
                        {editingId === resume.id ? (
                          <div className="flex-1 flex items-center gap-2">
                            <Input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="flex-1"
                              placeholder="Name"
                            />
                            <Input
                              value={editGrade}
                              onChange={e => setEditGrade(e.target.value)}
                              className="w-32"
                              placeholder="Grade"
                            />
                            <Button size="sm" variant="ghost" onClick={handleSaveEdit}>
                              <Check className="w-4 h-4 text-success" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              <X className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-3">
                              <FileText className="w-5 h-5 text-muted-foreground" />
                              <div>
                                <p className="font-medium">{resume.name}</p>
                                {resume.grade && (
                                  <Badge variant="secondary" className="text-xs">
                                    {resume.grade}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => handleEdit(resume)}>
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                    {rankings.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">
                        No resumes uploaded yet
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
            )}
          </TabsContent>

          {/* Rankings Tab */}
          <TabsContent value="rankings">
            {!selectedGameId ? (
              <Card className="glass-panel">
                <CardContent className="py-12">
                  <div className="text-center">
                    <Gamepad2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <h3 className="text-lg font-semibold mb-2">No Game Selected</h3>
                    <p className="text-muted-foreground mb-4">
                      Please select or create a game first to view rankings.
                    </p>
                    <Button onClick={() => setActiveTab('games')}>
                      Go to Games
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-panel">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Resume Rankings</CardTitle>
                      <CardDescription>
                        Sorted by Elo rating (highest to lowest) for "{selectedGameName}"
                      </CardDescription>
                    </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="pl-9 w-64"
                      />
                    </div>
                    <Select value={gradeFilter} onValueChange={setGradeFilter}>
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="Filter by grade" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Grades</SelectItem>
                        {grades.map(grade => (
                          <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Rank</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead className="text-right">Rating</TableHead>
                      <TableHead className="text-right">Games</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRankings.map((resume, index) => (
                      <TableRow key={resume.id}>
                        <TableCell>{getRankBadge(index)}</TableCell>
                        <TableCell>
                          <button
                            onClick={() => handlePreviewResume(resume)}
                            className="font-medium text-primary hover:underline flex items-center gap-2 cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                            {resume.name}
                          </button>
                        </TableCell>
                        <TableCell>
                          {resume.grade ? (
                            <Badge variant="secondary">{resume.grade}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {resume.rating?.toFixed(0) ?? 1500}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {resume.games ?? 0}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredRankings.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No resumes found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            )}
          </TabsContent>

          {/* Audit Tab */}
          <TabsContent value="audit">
            {!selectedGameId ? (
              <Card className="glass-panel">
                <CardContent className="py-12">
                  <div className="text-center">
                    <Gamepad2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <h3 className="text-lg font-semibold mb-2">No Game Selected</h3>
                    <p className="text-muted-foreground mb-4">
                      Please select or create a game first to view vote history.
                    </p>
                    <Button onClick={() => setActiveTab('games')}>
                      Go to Games
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="glass-panel lg:col-span-1">
                  <CardHeader>
                    <CardTitle>Graders</CardTitle>
                    <CardDescription>Select a grader to view their votes in "{selectedGameName}"</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {graders.map(grader => {
                        const displayName = grader.first_name && grader.last_name
                          ? `${grader.first_name} ${grader.last_name}`
                          : grader.first_name || grader.last_name || grader.id.slice(0, 8) + '...';
                        return (
                          <Button
                            key={grader.id}
                            variant={selectedGrader === grader.id ? 'default' : 'ghost'}
                            className="w-full justify-start"
                            onClick={() => setSelectedGrader(grader.id)}
                          >
                            <Users className="w-4 h-4 mr-2" />
                            {displayName}
                          </Button>
                        );
                      })}
                      {graders.length === 0 && (
                        <p className="text-center text-muted-foreground py-4">
                          No graders yet for this game
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>

              <Card className="glass-panel lg:col-span-2">
                <CardHeader>
                  <CardTitle>Vote History</CardTitle>
                  <CardDescription>
                    {selectedGrader 
                      ? (() => {
                          const grader = graders.find(g => g.id === selectedGrader);
                          const graderName = grader?.first_name && grader?.last_name
                            ? `${grader.first_name} ${grader.last_name}`
                            : grader?.first_name || grader?.last_name || selectedGrader.slice(0, 8) + '...';
                          return `Showing votes for ${graderName}`;
                        })()
                      : 'Select a grader to view their vote history'
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingComparisons ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                  ) : selectedGrader ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Resume A</TableHead>
                          <TableHead>Resume B</TableHead>
                          <TableHead>Winner</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {comparisons.map(comp => {
                          const handleResumeClick = async (resumeId: string) => {
                            const { data } = await supabase
                              .from('resumes')
                              .select('*')
                              .eq('id', resumeId)
                              .single();
                            if (data) {
                              handlePreviewResume(data as Resume);
                            }
                          };
                          
                          return (
                            <TableRow key={comp.id}>
                              <TableCell className="text-muted-foreground">
                                {new Date(comp.created_at).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <button
                                  onClick={() => handleResumeClick(comp.resume_a_id)}
                                  className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  {comp.resume_a_name}
                                </button>
                              </TableCell>
                              <TableCell>
                                <button
                                  onClick={() => handleResumeClick(comp.resume_b_id)}
                                  className="text-primary hover:underline flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  {comp.resume_b_name}
                                </button>
                              </TableCell>
                              <TableCell>
                                <button
                                  onClick={() => handleResumeClick(comp.winner_id)}
                                  className="flex items-center gap-1 cursor-pointer"
                                >
                                  <Badge variant="default" className="bg-success hover:bg-success/80">
                                    <Eye className="w-3 h-3 mr-1" />
                                    {comp.winner_name}
                                  </Badge>
                                </button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {comparisons.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                              No votes recorded for this grader
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      Select a grader from the list to view their vote history
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Resume Preview Modal */}
      <Dialog open={!!previewResume} onOpenChange={(open) => !open && setPreviewResume(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {previewResume?.name}
              {previewResume?.grade && (
                <Badge variant="secondary" className="ml-3">
                  {previewResume.grade}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Preview resume PDF
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {isLoadingPreview ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : previewPdfUrl ? (
              <iframe
                src={`${previewPdfUrl}#toolbar=0&navpanes=0`}
                className="w-full h-full min-h-[600px] rounded border"
                title={`Resume: ${previewResume?.name}`}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Failed to load PDF
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
