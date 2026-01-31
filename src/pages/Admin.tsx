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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Loader2, Upload, Trophy, Users, FileText, ArrowLeft, Search,
  ChevronUp, ChevronDown, Edit2, Check, X, Gamepad2, Plus, Copy, Eye, Video, User, Award, Download
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

interface VideoGradeAuditRow {
  id: string;
  application_id: string;
  question_1_score: number;
  question_2_choice: string | null;
  question_2_score: number;
  notes: string | null;
  graded_at: string;
  total_score?: number;
  applicant_name?: string;
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

interface VideoGradeDetail {
  grader_name: string;
  question_1_score: number;
  question_2_score: number;
  total_score: number;
}

interface Application {
  id: string;
  applicant_name: string; // Keep for backward compatibility
  first_name?: string;
  last_name?: string;
  applicant_email: string;
  year: string;
  major: string;
  minor?: string;
  profile_picture_path?: string;
  video_youtube_url: string;
  video_question_2_choice?: string;
  submitted_at: string;
  status: string;
  resume_id?: string;
  average_video_score?: number;
  video_grade_count?: number;
  video_grade_details?: VideoGradeDetail[];
}

interface FinalRanking {
  application_id: string;
  first_name: string;
  last_name: string;
  applicant_email: string;
  year: string;
  major: string;
  gender?: string;
  video_youtube_url: string;
  resume_id: string;
  resume_pdf_path: string;
  elo_rating: number;
  video_avg_score: number;
  video_grade_count: number;
  elo_normalized: number;
  video_normalized: number;
  combined_score: number;
}

// Helper function to get full name from first/last or fallback to applicant_name
function getFullName(app: Application): string {
  if (app.first_name && app.last_name) {
    return `${app.first_name} ${app.last_name}`.trim();
  }
  if (app.first_name) {
    return app.first_name.trim();
  }
  return (app.applicant_name || 'Unknown').trim();
}

// Component to display application profile picture
function ApplicationProfilePicture({ path, name }: { path?: string; name: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!path) {
      setIsLoading(false);
      return;
    }

    const loadImage = async () => {
      try {
        const { data, error } = await supabase.storage
          .from('profile-pictures')
          .createSignedUrl(path, 3600);

        if (!error && data) {
          setImageUrl(data.signedUrl);
        }
      } catch (err) {
        console.error('Error loading profile picture:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadImage();
  }, [path]);

  if (isLoading) {
    return (
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <User className="w-8 h-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
      <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
    </div>
  );
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
  const [auditVoteSubTab, setAuditVoteSubTab] = useState<'comparisons' | 'video-grades'>('comparisons');
  const [videoGradesAudit, setVideoGradesAudit] = useState<VideoGradeAuditRow[]>([]);
  const [isLoadingVideoGradesAudit, setIsLoadingVideoGradesAudit] = useState(false);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [expandedVideoScoreAppId, setExpandedVideoScoreAppId] = useState<string | null>(null);
  
  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editGrade, setEditGrade] = useState('');
  
  // Resume preview modal state
  const [previewResume, setPreviewResume] = useState<Resume | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Applications state
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoadingApplications, setIsLoadingApplications] = useState(false);
  const [applicationSearchQuery, setApplicationSearchQuery] = useState('');

  // Final Rankings state
  const [finalRankings, setFinalRankings] = useState<FinalRanking[]>([]);
  const [isLoadingFinalRankings, setIsLoadingFinalRankings] = useState(false);

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
      // Using type assertion because 'games' table exists but may not be in generated types
      const query = supabase.from('games' as never).select('*').eq('created_by', user.id).order('created_at', { ascending: false });
      const { data, error } = await query as { 
        data: Game[] | null; 
        error: Error | null 
      };

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
      toast.error('Please enter an application period name');
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
      // Using type assertion because 'create_game' function exists but may not be in generated types
      const rpcCall = supabase.rpc('create_game' as never, {
        p_name: newGameName.trim(),
        p_created_by: user.id
      } as never);
      const { data, error } = await rpcCall as unknown as { 
        data: { id: string; name: string; access_token: string; created_by: string; created_at: string } | null; 
        error: Error | null 
      };
      
      clearTimeout(timeoutId);

      console.log('RPC Response:', { data, error });

      if (error) {
        console.error('RPC Error:', error);
        const errorMsg = error instanceof Error ? error.message : (error as { message?: string; code?: string }).message || (error as { code?: string }).code || 'Unknown error';
        toast.error(`Error: ${errorMsg}`);
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
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      console.error('Exception creating game:', err);
      let errorMessage = 'Failed to create game. ';
      
      if (err instanceof Error) {
        if (err.message?.includes('function') || err.message?.includes('does not exist')) {
          errorMessage += 'The create_game function is missing. Please run the SQL migration in Supabase.';
        } else if (err.message?.includes('permission') || err.message?.includes('policy')) {
          errorMessage += 'Permission denied. Check your database policies.';
        } else {
          errorMessage += err.message;
        }
      } else if (err && typeof err === 'object' && 'code' in err) {
        errorMessage += `Error code: ${(err as { code: string }).code}`;
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
      // Using type assertion to avoid deep type instantiation
      const resumesQuery = supabase
        .from('resumes')
        .select('*')
        .eq('game_id' as never, selectedGameId)
        .order('created_at', { ascending: false });
      const { data: resumes, error: resumeError } = await resumesQuery as unknown as { 
        data: Resume[] | null; 
        error: Error | null 
      };

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
      // 1) Grader user_ids from comparisons: this game OR legacy (game_id null) so we don't miss anyone
      const compsQuery = supabase
        .from('comparisons')
        .select('user_id')
        .or(`game_id.eq.${selectedGameId},game_id.is.null` as never);
      const { data: comps } = await compsQuery as unknown as {
        data: Array<{ user_id: string }> | null;
        error: Error | null;
      };

      // 2) Grader ids from video_grades for this game
      const gradesQuery = supabase
        .from('video_grades' as never)
        .select('grader_id')
        .eq('game_id', selectedGameId);
      const { data: grades } = await gradesQuery as unknown as {
        data: Array<{ grader_id: string }> | null;
        error: Error | null;
      };

      const fromComps = (comps || []).map((c) => c.user_id);
      const fromGrades = (grades || []).map((g) => g.grader_id);
      const uniqueUserIds = [...new Set([...fromComps, ...fromGrades])];

      if (uniqueUserIds.length === 0) {
        setGraders([]);
        return;
      }

      const profilesQuery = supabase
        .from('profiles')
        .select('id, role, created_at, first_name, last_name')
        .in('id', uniqueUserIds)
        .order('created_at', { ascending: false });
      const { data: profiles, error } = await profilesQuery as unknown as {
        data: Profile[] | null;
        error: Error | null;
      };

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
      // Using type assertion to avoid deep type instantiation
      const compsQuery = supabase
        .from('comparisons')
        .select('*')
        .eq('user_id', graderId)
        .eq('game_id' as never, selectedGameId)
        .order('created_at', { ascending: false })
        .limit(100);
      const { data: comps, error } = await compsQuery as unknown as { 
        data: Comparison[] | null; 
        error: Error | null 
      };

      if (error) throw error;

      // Get resume names
      const resumeIds = new Set<string>();
      (comps || []).forEach(c => {
        resumeIds.add(c.resume_a_id);
        resumeIds.add(c.resume_b_id);
        resumeIds.add(c.winner_id);
      });

      // Using type assertion to avoid deep type instantiation
      const resumesQuery = supabase
        .from('resumes')
        .select('id, name')
        .in('id' as never, Array.from(resumeIds));
      const { data: resumes } = await resumesQuery as unknown as { 
        data: Array<{ id: string; name: string }> | null; 
        error: Error | null 
      };

      const resumeMap = new Map(resumes?.map(r => [r.id, r.name]) || []);

      // Get user profile with name
      // Using type assertion because 'first_name' and 'last_name' columns exist but may not be in generated types
      const profileQuery = supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', graderId)
        .single();
      const { data: profile } = await profileQuery as unknown as { 
        data: { first_name?: string; last_name?: string } | null; 
        error: Error | null 
      };

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

  const fetchVideoGradesAudit = useCallback(async (graderId: string) => {
    if (!selectedGameId) return;

    setIsLoadingVideoGradesAudit(true);
    try {
      type VideoGradeRow = {
        id: string;
        application_id: string;
        question_1_score: number;
        question_2_choice: string | null;
        question_2_score: number;
        notes: string | null;
        graded_at: string;
        total_score?: number;
        applications?: { applicant_name?: string } | null;
      };
      const { data: rows, error } = await supabase
        .from('video_grades' as never)
        .select('id, application_id, question_1_score, question_2_choice, question_2_score, notes, graded_at, total_score, applications(applicant_name)')
        .eq('grader_id', graderId)
        .eq('game_id', selectedGameId)
        .order('graded_at', { ascending: false }) as { data: VideoGradeRow[] | null; error: Error | null };

      if (error) throw error;

      const mapped: VideoGradeAuditRow[] = (rows || []).map((r) => {
        const app = r.applications;
        const name = (app?.applicant_name ?? '').trim() || 'Unknown';
        return {
          id: r.id,
          application_id: r.application_id,
          question_1_score: r.question_1_score,
          question_2_choice: r.question_2_choice,
          question_2_score: r.question_2_score,
          notes: r.notes,
          graded_at: r.graded_at,
          total_score: r.total_score,
          applicant_name: name,
        };
      });
      setVideoGradesAudit(mapped);
    } catch (err) {
      console.error('Error fetching video grades for audit:', err);
      toast.error('Failed to load video grades');
      setVideoGradesAudit([]);
    } finally {
      setIsLoadingVideoGradesAudit(false);
    }
  }, [selectedGameId]);

  const fetchApplications = useCallback(async () => {
    if (!selectedGameId) return;

    setIsLoadingApplications(true);
    try {
      // Fetch applications with video grade stats
      // Using type assertion because 'applications' table exists but may not be in generated types
      const appsQuery = supabase
        .from('applications' as never)
        .select('*')
        .eq('game_id', selectedGameId)
        .order('submitted_at', { ascending: false });
      const { data: apps, error: appsError } = await appsQuery as unknown as { 
        data: Application[] | null; 
        error: Error | null 
      };

      if (appsError) throw appsError;

      // Get video grade stats and per-grader details for each application
      if (apps && apps.length > 0) {
        const applicationIds = apps.map(a => a.id);
        type GradeRow = { application_id: string; grader_id: string; question_1_score: number; question_2_score: number; total_score: number };
        const gradesQuery = supabase
          .from('video_grades' as never)
          .select('application_id, grader_id, question_1_score, question_2_score, total_score')
          .in('application_id', applicationIds);
        const { data: grades, error: gradesError } = await gradesQuery as unknown as {
          data: GradeRow[] | null;
          error: Error | null;
        };

        if (!gradesError && grades) {
          const graderIds = [...new Set(grades.map(g => g.grader_id))];
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, first_name, last_name')
            .in('id', graderIds) as unknown as { data: Array<{ id: string; first_name?: string; last_name?: string }> | null };
          const graderNameMap = new Map<string, string>();
          (profiles || []).forEach(p => {
            const name = p.first_name && p.last_name ? `${p.first_name} ${p.last_name}`.trim() : p.first_name || p.last_name || p.id.slice(0, 8) + '...';
            graderNameMap.set(p.id, name);
          });

          const detailsMap = new Map<string, VideoGradeDetail[]>();
          grades.forEach(g => {
            const name = graderNameMap.get(g.grader_id) || 'Unknown';
            const detail: VideoGradeDetail = {
              grader_name: name,
              question_1_score: g.question_1_score,
              question_2_score: g.question_2_score,
              total_score: g.total_score,
            };
            if (!detailsMap.has(g.application_id)) detailsMap.set(g.application_id, []);
            detailsMap.get(g.application_id)!.push(detail);
          });

          const gradeCountMap = new Map<string, number[]>();
          grades.forEach(g => {
            if (!gradeCountMap.has(g.application_id)) gradeCountMap.set(g.application_id, []);
            gradeCountMap.get(g.application_id)!.push(g.total_score);
          });

          const enriched = apps.map(app => {
            const scores = gradeCountMap.get(app.id) || [];
            const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
            const video_grade_details = detailsMap.get(app.id) || [];
            return {
              ...app,
              average_video_score: avgScore,
              video_grade_count: scores.length,
              video_grade_details,
            };
          });

          setApplications(enriched);
        } else {
          setApplications(apps.map(app => ({ ...app, average_video_score: null, video_grade_count: 0, video_grade_details: [] })));
        }
      } else {
        setApplications([]);
      }
    } catch (err) {
      console.error('Error fetching applications:', err);
      toast.error('Failed to load applications');
    } finally {
      setIsLoadingApplications(false);
    }
  }, [selectedGameId]);

  const fetchFinalRankings = useCallback(async () => {
    if (!selectedGameId) return;

    setIsLoadingFinalRankings(true);
    try {
      // Using type assertion because 'get_combined_rankings' function exists but may not be in generated types
      const rpcCall = supabase.rpc('get_combined_rankings' as never, {
        p_game_id: selectedGameId,
      } as never);
      const { data, error } = await rpcCall as unknown as { 
        data: FinalRanking[] | null; 
        error: Error | null 
      };

      if (error) throw error;

      const rankings = (data || []) as unknown as FinalRanking[];
      setFinalRankings(rankings);
    } catch (err) {
      console.error('Error fetching final rankings:', err);
      toast.error('Failed to load final rankings');
      setFinalRankings([]);
    } finally {
      setIsLoadingFinalRankings(false);
    }
  }, [selectedGameId]);

  useEffect(() => {
    if (user && isAdmin && selectedGameId) {
      fetchRankings();
      fetchGraders();
      if (activeTab === 'applications') {
        fetchApplications();
      }
      if (activeTab === 'final-rankings') {
        fetchFinalRankings();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin, selectedGameId, activeTab]);

  useEffect(() => {
    setExpandedNoteId(null);
    if (selectedGrader) {
      fetchComparisons(selectedGrader);
      fetchVideoGradesAudit(selectedGrader);
    } else {
      setComparisons([]);
      setVideoGradesAudit([]);
    }
  }, [selectedGrader, fetchComparisons, fetchVideoGradesAudit]);

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

  const exportFinalRankingsToCSV = async () => {
    if (finalRankings.length === 0) {
      toast.error('No rankings data to export');
      return;
    }

    try {
      // Generate signed URLs for all resume PDFs (24 hour expiry for CSV export)
      const resumeUrls = await Promise.all(
        finalRankings.map(async (ranking) => {
          if (ranking.resume_pdf_path) {
            try {
              const { data, error } = await supabase.storage
                .from('resumes')
                .createSignedUrl(ranking.resume_pdf_path, 86400); // 24 hour expiry
              
              if (error) {
                console.error('Error generating signed URL for resume:', error);
                return null;
              }
              return data.signedUrl;
            } catch (err) {
              console.error('Error generating signed URL:', err);
              return null;
            }
          }
          return null;
        })
      );

      const headers = [
        'Rank',
        'First Name',
        'Last Name',
        'Email',
        'Year',
        'Major',
        'Gender',
        'ELO Rating',
        'Video Avg Score',
        'ELO Normalized',
        'Video Normalized',
        'Combined Score',
        'Video Link',
        'Resume PDF Link'
      ];

      const csvRows = [
        headers.join(','),
        ...finalRankings.map((ranking, index) => {
          const videoLink = ranking.video_youtube_url || '';
          const resumeLink = resumeUrls[index] || '';
          
          const row = [
            index + 1,
            `"${ranking.first_name || ''}"`,
            `"${ranking.last_name || ''}"`,
            `"${ranking.applicant_email || ''}"`,
            `"${ranking.year || ''}"`,
            `"${ranking.major || ''}"`,
            `"${ranking.gender || ''}"`,
            ranking.elo_rating?.toFixed(2) || '',
            ranking.video_avg_score?.toFixed(2) || '',
            ranking.elo_normalized?.toFixed(2) || '',
            ranking.video_normalized?.toFixed(2) || '',
            ranking.combined_score?.toFixed(2) || '',
            videoLink, // YouTube link - Excel/Sheets will make this clickable
            resumeLink // Resume PDF link - Excel/Sheets will make this clickable
          ];
          return row.join(',');
        })
      ];

      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `Final_Rankings_${selectedGameName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Rankings exported successfully with links');
    } catch (err) {
      console.error('Error exporting CSV:', err);
      toast.error('Failed to export rankings');
    }
  };

  const handlePreviewResumeFromRanking = async (ranking: FinalRanking) => {
    const resume: Resume = {
      id: ranking.resume_id,
      name: `${ranking.first_name} ${ranking.last_name}`,
      grade: null,
      pdf_path: ranking.resume_pdf_path,
      active: true,
      created_at: new Date().toISOString()
    };
    await handlePreviewResume(resume);
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
              Application Periods
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
            <TabsTrigger value="applications" className="flex items-center gap-2">
              <Video className="w-4 h-4" />
              Applications
            </TabsTrigger>
            <TabsTrigger value="final-rankings" className="flex items-center gap-2">
              <Award className="w-4 h-4" />
              Final Rankings
            </TabsTrigger>
          </TabsList>

          {/* Application Periods Tab */}
          <TabsContent value="games">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle>Create New Application Period</CardTitle>
                  <CardDescription>Create a new application period for student submissions</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="gameName">Application Period Name</Label>
                      <Input
                        id="gameName"
                        placeholder="e.g., BUCC 2025 Fall"
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
                          Create Application Period
                        </>
                      )}
                    </Button>
                    {newGameToken && (
                      <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                        <p className="text-sm font-medium mb-2">Application Period Created!</p>
                        <p className="text-xs text-muted-foreground mb-2">Share this access token with students:</p>
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
                  <CardTitle>My Application Periods</CardTitle>
                  <CardDescription>Application periods you've created</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {games.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        No application periods created yet. Create your first application period to get started.
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
                    <h3 className="text-lg font-semibold mb-2">No Application Period Selected</h3>
                    <p className="text-muted-foreground mb-4">
                      Please select or create an application period first before uploading resumes.
                    </p>
                    <Button onClick={() => setActiveTab('games')}>
                      Go to Application Periods
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
                      Please select or create an application period first to view rankings.
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
                      Please select or create an application period first to view vote history.
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
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
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
                  </div>
                  {selectedGrader && (
                    <Badge variant="secondary" className="shrink-0 gap-1.5 px-3 py-1.5 text-base font-semibold">
                      <span className="tabular-nums text-primary">
                        {auditVoteSubTab === 'comparisons' ? comparisons.length : videoGradesAudit.length}
                      </span>
                      <span className="font-normal text-muted-foreground">
                        {auditVoteSubTab === 'comparisons' ? 'votes' : 'grades'}
                      </span>
                    </Badge>
                  )}
                </CardHeader>
                <CardContent>
                  {!selectedGrader ? (
                    <div className="text-center py-12 text-muted-foreground">
                      Select a grader from the list to view their vote history
                    </div>
                  ) : (
                    <Tabs value={auditVoteSubTab} onValueChange={(v) => setAuditVoteSubTab(v as 'comparisons' | 'video-grades')}>
                      <TabsList className="grid w-full grid-cols-2 max-w-xs mb-4">
                        <TabsTrigger value="comparisons" className="flex items-center gap-2">
                          <Trophy className="w-4 h-4" />
                          Comparison votes
                        </TabsTrigger>
                        <TabsTrigger value="video-grades" className="flex items-center gap-2">
                          <Video className="w-4 h-4" />
                          Video grades
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="comparisons" className="mt-0">
                        {isLoadingComparisons ? (
                          <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                          </div>
                        ) : (
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
                                    No comparison votes for this grader
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        )}
                      </TabsContent>
                      <TabsContent value="video-grades" className="mt-0">
                        {isLoadingVideoGradesAudit ? (
                          <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Applicant</TableHead>
                                <TableHead>Q1</TableHead>
                                <TableHead>Q2</TableHead>
                                <TableHead>Total</TableHead>
                                <TableHead>Notes</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {videoGradesAudit.map((row) => {
                                const hasNotes = row.notes && row.notes.trim().length > 0;
                                const isLong = hasNotes && row.notes!.length > 80;
                                const isExpanded = expandedNoteId === row.id;
                                const showFull = !isLong || isExpanded;
                                return (
                                  <TableRow key={row.id}>
                                    <TableCell className="text-muted-foreground">
                                      {new Date(row.graded_at).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="font-medium">{row.applicant_name ?? '—'}</TableCell>
                                    <TableCell>{row.question_1_score}</TableCell>
                                    <TableCell>{row.question_2_score}</TableCell>
                                    <TableCell>{row.total_score ?? row.question_1_score + row.question_2_score}</TableCell>
                                    <TableCell className="max-w-[280px] text-muted-foreground align-top">
                                      {!hasNotes ? (
                                        '—'
                                      ) : (
                                        <div className="space-y-1">
                                          <span className={showFull ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}>
                                            {showFull ? row.notes : row.notes!.slice(0, 80) + (row.notes!.length > 80 ? '...' : '')}
                                          </span>
                                          {isLong && (
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className="h-7 text-xs text-primary px-0 hover:bg-transparent"
                                              onClick={() => setExpandedNoteId(isExpanded ? null : row.id)}
                                            >
                                              {isExpanded ? 'Show less' : 'Show more'}
                                            </Button>
                                          )}
                                        </div>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                              {videoGradesAudit.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                    No video grades for this grader
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        )}
                      </TabsContent>
                    </Tabs>
                  )}
                </CardContent>
              </Card>
            </div>
            )}
          </TabsContent>

          {/* Applications Tab */}
          <TabsContent value="applications">
            {!selectedGameId ? (
              <Card className="glass-panel">
                <CardContent className="py-12">
                  <div className="text-center">
                    <Video className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <h3 className="text-lg font-semibold mb-2">No Application Period Selected</h3>
                    <p className="text-muted-foreground mb-4">
                      Please select or create an application period first to view applications.
                    </p>
                    <Button onClick={() => setActiveTab('games')}>
                      Go to Application Periods
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                <Card className="glass-panel">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>Student Applications</CardTitle>
                        <CardDescription>
                          Applications for {selectedGameName}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Search by name or email..."
                          value={applicationSearchQuery}
                          onChange={(e) => setApplicationSearchQuery(e.target.value)}
                          className="w-64"
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {isLoadingApplications ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    ) : applications.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Video className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>No applications submitted yet for this period.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {applications
                          .filter(app => {
                            if (!applicationSearchQuery) return true;
                            const query = applicationSearchQuery.toLowerCase();
                            const fullName = getFullName(app).toLowerCase();
                            return fullName.includes(query) ||
                                   app.applicant_email.toLowerCase().includes(query) ||
                                   (app.major && app.major.toLowerCase().includes(query));
                          })
                          .map((app) => {
                            const fullName = getFullName(app);
                            return (
                            <Card key={app.id} className="border-border">
                              <CardContent className="pt-6">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex items-start gap-4 flex-1">
<ApplicationProfilePicture path={app.profile_picture_path} name={fullName} />
                                    <div className="flex-1 min-w-0">
                                      <h3 className="font-semibold text-lg mb-1">{fullName}</h3>
                                      <p className="text-sm text-muted-foreground mb-2">{app.applicant_email}</p>
                                      <div className="flex flex-wrap gap-2 text-sm">
                                        <Badge variant="secondary">{app.year}</Badge>
                                        <Badge variant="secondary">{app.major}</Badge>
                                        {app.minor && <Badge variant="outline">{app.minor} minor</Badge>}
                                        {app.video_question_2_choice && (
                                          <Badge variant="outline">
                                            Q2: {app.video_question_2_choice}
                                          </Badge>
                                        )}
                                      </div>
                                      {app.average_video_score !== null && app.video_grade_count !== undefined && app.video_grade_count > 0 && (
                                        <div className="mt-2">
                                          <Collapsible
                                            open={expandedVideoScoreAppId === app.id}
                                            onOpenChange={(open) => setExpandedVideoScoreAppId(open ? app.id : null)}
                                          >
                                            <CollapsibleTrigger asChild>
                                              <button
                                                type="button"
                                                className="inline-flex items-center gap-1.5 rounded-md border-0 bg-green-600 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                                              >
                                                Avg Video Score: {app.average_video_score.toFixed(1)}/10
                                                ({app.video_grade_count} {app.video_grade_count === 1 ? 'grade' : 'grades'})
                                                <ChevronDown
                                                  className={`h-3 w-3 opacity-80 transition-transform ${expandedVideoScoreAppId === app.id ? 'rotate-180' : ''}`}
                                                />
                                              </button>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent>
                                              <div className="mt-2 rounded-md border bg-muted/30 p-2 space-y-1.5 text-xs">
                                                {app.video_grade_details?.map((d, i) => (
                                                  <div key={i} className="flex justify-between items-center gap-2">
                                                    <span className="font-medium text-foreground">{d.grader_name}</span>
                                                    <span className="text-muted-foreground tabular-nums">
                                                      Q1: {d.question_1_score}, Q2: {d.question_2_score} — {d.total_score}/10
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            </CollapsibleContent>
                                          </Collapsible>
                                        </div>
                                      )}
                                      {app.video_grade_count === 0 && (
                                        <Badge variant="outline" className="mt-2 text-amber-600 border-amber-600">
                                          Not graded yet
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex flex-col gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => window.open(app.video_youtube_url, '_blank')}
                                    >
                                      <Video className="w-4 h-4 mr-2" />
                                      Watch Video
                                    </Button>
                                    {app.resume_id && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                          // Find resume and show in preview modal
                                          const { data: resume } = await supabase
                                            .from('resumes')
                                            .select('*')
                                            .eq('id', app.resume_id)
                                            .single();
                                          
                                          if (resume) {
                                            setPreviewResume(resume);
                                            setIsLoadingPreview(true);
                                            const { data, error } = await supabase.storage
                                              .from('resumes')
                                              .createSignedUrl(resume.pdf_path, 3600);
                                            
                                            if (!error && data) {
                                              setPreviewPdfUrl(data.signedUrl);
                                            }
                                            setIsLoadingPreview(false);
                                          }
                                        }}
                                      >
                                        <FileText className="w-4 h-4 mr-2" />
                                        View Resume
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                <div className="mt-4 pt-4 border-t text-xs text-muted-foreground">
                                  Submitted: {new Date(app.submitted_at).toLocaleString()}
                                </div>
                              </CardContent>
                            </Card>
                          );
                          })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Final Rankings Tab */}
          <TabsContent value="final-rankings">
            {!selectedGameId ? (
              <Card className="glass-panel">
                <CardContent className="py-12">
                  <div className="text-center">
                    <Gamepad2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <h3 className="text-lg font-semibold mb-2">No Game Selected</h3>
                    <p className="text-muted-foreground mb-4">
                      Please select or create an application period first to view final rankings.
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
                      <CardTitle>Final Rankings - Combined Scores</CardTitle>
                      <CardDescription>
                        Rankings based on 60% ELO score + 40% video score for "{selectedGameName}"
                      </CardDescription>
                    </div>
                    <Button
                      onClick={exportFinalRankingsToCSV}
                      disabled={finalRankings.length === 0 || isLoadingFinalRankings}
                      variant="outline"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoadingFinalRankings ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                  ) : finalRankings.length === 0 ? (
                    <div className="text-center py-12">
                      <Award className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                      <h3 className="text-lg font-semibold mb-2">No Rankings Available</h3>
                      <p className="text-muted-foreground">
                        No applications with both resume ELO ratings and video grades found for this period.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">Rank</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Year</TableHead>
                            <TableHead>Major</TableHead>
                            <TableHead>Gender</TableHead>
                            <TableHead className="text-right">ELO Score</TableHead>
                            <TableHead className="text-right">Video Avg</TableHead>
                            <TableHead className="text-right font-bold">Combined Score</TableHead>
                            <TableHead className="text-center">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {finalRankings.map((ranking, index) => (
                            <TableRow key={ranking.application_id}>
                              <TableCell className="font-semibold">
                                {index === 0 && <span className="text-yellow-600">🥇</span>}
                                {index === 1 && <span className="text-gray-400">🥈</span>}
                                {index === 2 && <span className="text-orange-600">🥉</span>}
                                {index > 2 && <span className="text-muted-foreground">{index + 1}</span>}
                              </TableCell>
                              <TableCell className="font-medium">
                                {ranking.first_name} {ranking.last_name}
                              </TableCell>
                              <TableCell>{ranking.applicant_email}</TableCell>
                              <TableCell>{ranking.year}</TableCell>
                              <TableCell>{ranking.major || 'N/A'}</TableCell>
                              <TableCell>{ranking.gender || '—'}</TableCell>
                              <TableCell className="text-right">
                                {ranking.elo_rating?.toFixed(0)}
                              </TableCell>
                              <TableCell className="text-right">
                                {ranking.video_avg_score?.toFixed(2)}/10
                              </TableCell>
                              <TableCell className="text-right font-bold text-lg">
                                {ranking.combined_score?.toFixed(2)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePreviewResumeFromRanking(ranking)}
                                    title="View Resume"
                                  >
                                    <FileText className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(ranking.video_youtube_url, '_blank')}
                                    title="Watch Video"
                                  >
                                    <Video className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
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
