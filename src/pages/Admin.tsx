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
import { 
  Loader2, Upload, Trophy, Users, FileText, ArrowLeft, Search,
  ChevronUp, ChevronDown, Edit2, Check, X
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
  resume_a_id: string;
  resume_b_id: string;
  winner_id: string;
  resume_a_name?: string;
  resume_b_name?: string;
  winner_name?: string;
}

interface Profile {
  id: string;
  role: string;
  created_at: string;
}

export default function Admin() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState('upload');
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  
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

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) {
      navigate('/grade');
    }
  }, [authLoading, user, isAdmin, navigate]);

  const fetchRankings = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch resumes with ratings
      const { data: resumes, error: resumeError } = await supabase
        .from('resumes')
        .select('*')
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
  }, []);

  const fetchGraders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'grader')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGraders(data || []);
    } catch (err) {
      console.error('Error fetching graders:', err);
    }
  }, []);

  const fetchComparisons = useCallback(async (graderId: string) => {
    setIsLoadingComparisons(true);
    try {
      const { data: comps, error } = await supabase
        .from('comparisons')
        .select('*')
        .eq('user_id', graderId)
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

      const enriched = (comps || []).map(c => ({
        ...c,
        resume_a_name: resumeMap.get(c.resume_a_id) || 'Unknown',
        resume_b_name: resumeMap.get(c.resume_b_id) || 'Unknown',
        winner_name: resumeMap.get(c.winner_id) || 'Unknown'
      }));

      setComparisons(enriched);
    } catch (err) {
      console.error('Error fetching comparisons:', err);
      toast.error('Failed to load comparisons');
    } finally {
      setIsLoadingComparisons(false);
    }
  }, []);

  useEffect(() => {
    if (user && isAdmin) {
      fetchRankings();
      fetchGraders();
    }
  }, [user, isAdmin, fetchRankings, fetchGraders]);

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
        const { error: insertError } = await supabase
          .from('resumes')
          .insert({
            name: file.name.replace('.pdf', ''),
            pdf_path: fileName
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

          {/* Upload Tab */}
          <TabsContent value="upload">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle>Upload New Resumes</CardTitle>
                  <CardDescription>Upload PDF files to add to the grading pool</CardDescription>
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
          </TabsContent>

          {/* Rankings Tab */}
          <TabsContent value="rankings">
            <Card className="glass-panel">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Resume Rankings</CardTitle>
                    <CardDescription>Sorted by Elo rating (highest to lowest)</CardDescription>
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
                        <TableCell className="font-medium">{resume.name}</TableCell>
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
          </TabsContent>

          {/* Audit Tab */}
          <TabsContent value="audit">
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="glass-panel lg:col-span-1">
                <CardHeader>
                  <CardTitle>Graders</CardTitle>
                  <CardDescription>Select a grader to view their votes</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {graders.map(grader => (
                      <Button
                        key={grader.id}
                        variant={selectedGrader === grader.id ? 'default' : 'ghost'}
                        className="w-full justify-start"
                        onClick={() => setSelectedGrader(grader.id)}
                      >
                        <Users className="w-4 h-4 mr-2" />
                        {grader.id.slice(0, 8)}...
                      </Button>
                    ))}
                    {graders.length === 0 && (
                      <p className="text-center text-muted-foreground py-4">
                        No graders yet
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
                      ? `Showing votes for grader ${selectedGrader.slice(0, 8)}...`
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
                        {comparisons.map(comp => (
                          <TableRow key={comp.id}>
                            <TableCell className="text-muted-foreground">
                              {new Date(comp.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell>{comp.resume_a_name}</TableCell>
                            <TableCell>{comp.resume_b_name}</TableCell>
                            <TableCell>
                              <Badge variant="default" className="bg-success">
                                {comp.winner_name}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
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
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
