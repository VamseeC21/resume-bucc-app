import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, LogOut, Settings, Trophy, Video, User, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import { toast } from 'sonner';

interface Application {
  id: string;
  applicant_name: string; // Keep for backward compatibility
  first_name?: string;
  last_name?: string;
  applicant_email: string;
  year: string;
  major: string;
  profile_picture_path?: string;
  video_youtube_url: string;
  video_question_2_choice?: string;
  submitted_at: string;
  graded: boolean;
  grade_count?: number; // Total number of grades given to this application
  is_graded_by_me?: boolean; // Whether current grader has graded this
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

// Component to display profile picture with signed URL
function ProfilePictureDisplay({ path }: { path: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
        <User className="w-6 h-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden">
      <img src={imageUrl} alt="Profile" className="w-full h-full object-cover" />
    </div>
  );
}

interface ApplicationDetails extends Application {
  expected_graduation_year?: string;
  gender?: string;
  minor?: string;
  college_of_primary_major?: string;
  gpa?: string;
  act_score?: string;
  sat_score?: string;
  military_affiliated?: string;
  first_time_applying?: string;
  how_did_you_hear?: string;
  additional_info?: string;
}

export default function GradeVideos() {
  const { user, loading: authLoading, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [currentGameName, setCurrentGameName] = useState<string>('');
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedApplication, setSelectedApplication] = useState<ApplicationDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search by name
  const [nameSearch, setNameSearch] = useState('');

  // Grading form state
  const [question1Score, setQuestion1Score] = useState<string>('');
  const [question2Score, setQuestion2Score] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null);

  // Filter applications by name (and email) for search
  const filteredApplications = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter((app) => {
      const fullName = getFullName(app).toLowerCase();
      const email = (app.applicant_email || '').toLowerCase();
      return fullName.includes(q) || email.includes(q);
    });
  }, [applications, nameSearch]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (user) {
      // Load current game from localStorage
      const savedGameId = localStorage.getItem('currentGameId');
      const savedGameName = localStorage.getItem('currentGameName');
      
      if (savedGameId && savedGameName) {
        setCurrentGameId(savedGameId);
        setCurrentGameName(savedGameName);
      } else {
        setError('Please select an application period first');
        navigate('/select-game');
      }
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user && currentGameId) {
      fetchApplications();
    }
  }, [user, currentGameId]);

  const fetchApplications = useCallback(async () => {
    if (!user || !currentGameId) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.rpc('get_applications_for_grading', {
        p_game_id: currentGameId,
        p_grader_id: user.id,
        p_graded_only: false,
      });

      if (error) throw error;

      const result = data as unknown as Application[];
      setApplications(result || []);
    } catch (err: any) {
      console.error('Error fetching applications:', err);
      setError(err.message || 'Failed to load applications');
      toast.error('Failed to load applications');
    } finally {
      setIsLoading(false);
    }
  }, [user, currentGameId]);

  const loadApplicationDetails = async (applicationId: string) => {
    setIsLoadingDetails(true);
    setSelectedApplication(null); // Reset to prevent showing stale data
    try {
      const { data, error } = await supabase.rpc('get_application_details', {
        p_application_id: applicationId,
      });

      if (error) {
        console.error('RPC Error:', error);
        throw error;
      }

      if (!data) {
        console.error('No data returned from get_application_details');
        throw new Error('No data returned from server');
      }

      // Handle case where function returns error JSON
      const dataObj = data as any;
      if (dataObj && dataObj.error) {
        console.error('Application details error:', dataObj.error);
        throw new Error(dataObj.error || 'Failed to load application');
      }

      // Handle case where function returns null (application not found)
      if (data === null || (typeof dataObj === 'object' && !dataObj.id)) {
        console.error('Application not found or invalid data:', data);
        throw new Error('Application not found');
      }

      const details = data as unknown as ApplicationDetails;
      console.log('Loaded application details:', details);
      
      if (!details || !details.id) {
        console.error('Invalid application data:', details);
        throw new Error('Invalid application data received');
      }
      
      setSelectedApplication(details);

      // Load profile picture if exists
      if (details.profile_picture_path) {
        const { data: picData, error: picError } = await supabase.storage
          .from('profile-pictures')
          .createSignedUrl(details.profile_picture_path, 3600);

        if (!picError && picData) {
          setProfilePictureUrl(picData.signedUrl);
        }
      } else {
        setProfilePictureUrl(null);
      }

      // Check if already graded and load existing grade
      const { data: gradeData } = await supabase
        .from('video_grades')
        .select('question_1_score, question_2_score, notes')
        .eq('application_id', applicationId)
        .eq('grader_id', user!.id)
        .maybeSingle();

      if (gradeData) {
        setQuestion1Score(gradeData.question_1_score.toString());
        setQuestion2Score(gradeData.question_2_score.toString());
        setNotes(gradeData.notes || '');
      } else {
        setQuestion1Score('');
        setQuestion2Score('');
        setNotes('');
      }
    } catch (err: any) {
      console.error('Error loading application details:', err);
      toast.error(err.message || 'Failed to load application details');
      setSelectedApplication(null); // Close modal on error
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleOpenApplication = (application: Application) => {
    loadApplicationDetails(application.id);
  };

  const handleCloseModal = () => {
    setSelectedApplication(null);
    setProfilePictureUrl(null);
    setQuestion1Score('');
    setQuestion2Score('');
    setNotes('');
  };

  const convertYouTubeUrlToEmbed = (url: string): string => {
    // Handle various YouTube URL formats including Shorts
    // Formats: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, youtube.com/shorts/ID, youtube.com/v/ID
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(youtubeRegex);
    
    if (match && match[1]) {
      return `https://www.youtube.com/embed/${match[1]}`;
    }
    
    return url; // Return original if can't parse
  };

  const handleSubmitGrade = async () => {
    if (!selectedApplication || !user) return;

    if (!question1Score || !question2Score) {
      toast.error('Please provide scores for both questions');
      return;
    }

    const q1 = parseInt(question1Score);
    const q2 = parseInt(question2Score);

    if (q1 < 1 || q1 > 5 || q2 < 1 || q2 > 5) {
      toast.error('Scores must be between 1 and 5');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.rpc('submit_video_grade', {
        p_application_id: selectedApplication.id,
        p_grader_id: user.id,
        p_question_1_score: q1,
        p_question_2_choice: selectedApplication?.video_question_2_choice || null,
        p_question_2_score: q2,
        p_notes: notes.trim() || null,
      });

      if (error) throw error;

      const result = data as unknown as { error?: string; success?: boolean };
      if (result.error) {
        throw new Error(result.error);
      }

      toast.success('Grade submitted successfully!');
      
      // Refresh applications list to get updated grade counts
      const { data: freshApps, error: fetchError } = await supabase.rpc('get_applications_for_grading', {
        p_game_id: currentGameId!,
        p_grader_id: user.id,
        p_graded_only: false,
      });
      
      if (fetchError) {
        console.error('Error fetching updated applications:', fetchError);
      } else if (freshApps) {
        // Update the applications list with fresh data
        const appsList = (freshApps || []) as unknown as Application[];
        setApplications(appsList);
        
        // Update the selected application with the new grade count
        if (selectedApplication) {
          const updated = appsList.find(app => app.id === selectedApplication.id);
          if (updated) {
            setSelectedApplication({
              ...selectedApplication,
              grade_count: updated.grade_count || 0,
              is_graded_by_me: updated.is_graded_by_me,
            });
          }
        }
        
        // Find next ungraded application (not graded by this user)
        const ungraded = appsList.filter((app) => !app.is_graded_by_me && app.id !== selectedApplication?.id);
        if (ungraded.length > 0) {
          handleOpenApplication(ungraded[0]);
        } else {
          handleCloseModal();
        }
      } else {
        // Fallback: just refresh the list
        await fetchApplications();
        handleCloseModal();
      }
    } catch (err: any) {
      console.error('Error submitting grade:', err);
      toast.error(err.message || 'Failed to submit grade');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getNextUngradedApplication = () => {
    const ungraded = applications.filter((app) => !app.is_graded_by_me);
    if (ungraded.length === 0) return null;
    
    const currentIndex = selectedApplication 
      ? ungraded.findIndex((app) => app.id === selectedApplication.id)
      : -1;
    
    const nextIndex = (currentIndex + 1) % ungraded.length;
    return ungraded[nextIndex];
  };

  const handleNext = () => {
    const next = getNextUngradedApplication();
    if (next) {
      handleOpenApplication(next);
    } else {
      toast.info('All applications have been graded by you!');
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !currentGameId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => navigate('/select-game')}>Select Application Period</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ungradedByMeCount = applications.filter((app) => !app.is_graded_by_me).length;
  const gradedByMeCount = applications.filter((app) => app.is_graded_by_me).length;
  const completeCount = applications.filter((app) => (app.grade_count ?? 0) >= 3).length;
  const pendingCount = applications.filter((app) => (app.grade_count ?? 0) < 3).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/bucc-logo.png" alt="Logo" className="w-10 h-10 object-contain" />
            <div>
              <span className="font-semibold text-lg">Video Grading</span>
              {currentGameName && (
                <span className="text-sm text-muted-foreground ml-2">• {currentGameName}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="stat-card flex items-center gap-2 py-2">
              <Trophy className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">
                {gradedByMeCount} / {applications.length} graded by you
              </span>
            </div>

            <Button variant="outline" size="sm" onClick={() => navigate('/select-game')}>
              Change Application Period
            </Button>

            <Button variant="outline" size="sm" onClick={() => navigate('/grade')}>
              Grade Resumes
            </Button>

            <Button variant="outline" size="sm" onClick={() => navigate('/interview')}>
              Interview Scoring
            </Button>

            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => navigate('/admin')}>
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
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={fetchApplications}>Try Again</Button>
          </div>
        ) : applications.length === 0 ? (
          <Card className="glass-panel">
            <CardContent className="pt-6 text-center py-12">
              <Video className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No Applications Yet</h3>
              <p className="text-muted-foreground">
                There are no applications submitted for this period yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Stats Card */}
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle>Grading Progress</CardTitle>
                <CardDescription>Applications to grade for {currentGameName}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  <div>
                    <p className="text-2xl font-bold text-primary">{ungradedByMeCount}</p>
                    <p className="text-sm text-muted-foreground">Not Graded by You</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">{gradedByMeCount}</p>
                    <p className="text-sm text-muted-foreground">Graded by You</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
                    <p className="text-sm text-muted-foreground">Pending (Need 3 grades)</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">{completeCount}</p>
                    <p className="text-sm text-muted-foreground">Complete (3+ grades)</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{applications.length}</p>
                    <p className="text-sm text-muted-foreground">Total</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Applications List */}
            <Card className="glass-panel">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>Applications</CardTitle>
                    <CardDescription>
                      Click on an application to grade it. Each video needs 3 grades to be marked complete. 
                      Applications you haven't graded are shown first.
                    </CardDescription>
                  </div>
                  <div className="relative w-full sm:w-64 shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="search"
                      placeholder="Search by name or email..."
                      value={nameSearch}
                      onChange={(e) => setNameSearch(e.target.value)}
                      className="pl-9"
                      aria-label="Search applications by name or email"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {filteredApplications.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      {nameSearch.trim() ? (
                        <>No applications match &quot;{nameSearch.trim()}&quot;. Try a different search.</>
                      ) : (
                        'No applications to display.'
                      )}
                    </div>
                  ) : (
                    <>
                      {filteredApplications.map((app) => (
                        <div
                          key={app.id}
                          className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer"
                          onClick={() => handleOpenApplication(app)}
                        >
                          <div className="flex items-center gap-4">
                            {app.profile_picture_path ? (
                              <ProfilePictureDisplay path={app.profile_picture_path} />
                            ) : (
                              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                <User className="w-6 h-6 text-primary" />
                              </div>
                            )}
                            <div>
                              <h3 className="font-semibold">{getFullName(app)}</h3>
                              <p className="text-sm text-muted-foreground">
                                {app.year} • {app.major}
                              </p>
                              <p className="text-xs text-muted-foreground">{app.applicant_email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {/* Grade Count and Status Indicator */}
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">
                                Grades: {app.grade_count ?? 0}/3
                              </span>
                              {app.grade_count !== undefined && app.grade_count >= 3 ? (
                                <Badge variant="outline" className="text-green-600 border-green-600 bg-green-50">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Complete
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-600 border-amber-600 bg-amber-50">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  Pending
                                </Badge>
                              )}
                            </div>
                            {/* Personal Grading Status */}
                            {app.is_graded_by_me ? (
                              <Badge variant="outline" className="text-blue-600 border-blue-600">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Graded by You
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground border-muted">
                                Pending
                              </Badge>
                            )}
                            <Button variant="ghost" size="sm">
                              Grade
                            </Button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Application Grading Modal */}
      <Dialog open={!!selectedApplication} onOpenChange={(open) => !open && handleCloseModal()}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {profilePictureUrl ? (
                <img
                  src={profilePictureUrl}
                  alt={selectedApplication ? getFullName(selectedApplication) : 'Profile picture'}
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-6 h-6 text-primary" />
                </div>
              )}
              <div>
                <div>{selectedApplication ? getFullName(selectedApplication) : 'Unknown'}</div>
                <div className="text-sm font-normal text-muted-foreground">
                  {selectedApplication?.year} • {selectedApplication?.major}
                </div>
              </div>
            </DialogTitle>
            <DialogDescription>Grade this application's video</DialogDescription>
          </DialogHeader>

          {isLoadingDetails ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Loading application details...</span>
            </div>
          ) : selectedApplication ? (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-6">
              {/* Student Info Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Student Information</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Email</p>
                    <p className="font-medium">{selectedApplication?.applicant_email || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Expected Graduation</p>
                    <p className="font-medium">{selectedApplication?.expected_graduation_year || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Major</p>
                    <p className="font-medium">{selectedApplication?.major || 'N/A'}</p>
                  </div>
                  {selectedApplication.minor && (
                    <div>
                      <p className="text-muted-foreground">Minor</p>
                      <p className="font-medium">{selectedApplication.minor}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground">GPA</p>
                    <p className="font-medium">{selectedApplication?.gpa || 'N/A'}</p>
                  </div>
                  {selectedApplication.military_affiliated && (
                    <div>
                      <p className="text-muted-foreground">Military Affiliated</p>
                      <p className="font-medium">{selectedApplication.military_affiliated}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Video Player */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Video Response</CardTitle>
                  <CardDescription>
                    Question 2 Choice: {selectedApplication?.video_question_2_choice === 'A' 
                      ? 'A - Something I care deeply about'
                      : selectedApplication?.video_question_2_choice === 'B'
                      ? 'B - A moment that changed my perspective'
                      : 'Not specified'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedApplication?.video_youtube_url ? (
                    <div className="aspect-video rounded-lg overflow-hidden border">
                      <iframe
                        src={convertYouTubeUrlToEmbed(selectedApplication.video_youtube_url)}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title={`Video: ${getFullName(selectedApplication)}`}
                      />
                    </div>
                  ) : (
                    <div className="aspect-video rounded-lg border flex items-center justify-center bg-muted">
                      <p className="text-muted-foreground">No video URL provided</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Grading Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Grading</CardTitle>
                  <CardDescription>
                    40%: Application (2.5 min video - CONTENT BASED, EDITING IS NOT FACTORED)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Question 1 */}
                  <div className="space-y-3">
                    <div>
                      <Label className="text-base font-semibold">
                        Question #1: Why BUCC? <span className="text-red-500">*</span>
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Evaluate how clear, well-spoken, and personalized their response is
                      </p>
                    </div>
                    <RadioGroup
                      value={question1Score}
                      onValueChange={setQuestion1Score}
                      className="space-y-3"
                    >
                      {[
                        { score: 5, desc: 'Clear, very well spoken, interesting, differentiable (cohesively connects their response to themselves)' },
                        { score: 4, desc: 'Above average response, genuine interest, minor issues (generic, less elaboration, etc)' },
                        { score: 3, desc: 'Not bad but not a standout, knowledgeable about BUCC (mediocre)' },
                        { score: 2, desc: 'Minimal effort, extremely generic (feels you can apply to any club with this – buzz word heavy w/ no personality)' },
                        { score: 1, desc: 'No effort, incomplete - seemed forced to apply' },
                      ].map(({ score, desc }) => (
                        <Label
                          key={score}
                          htmlFor={`q1-${score}`}
                          className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
                        >
                          <RadioGroupItem value={score.toString()} id={`q1-${score}`} className="mt-1" />
                          <div className="flex-1">
                            <span className="font-medium">
                              {score}
                            </span>
                            <p className="text-sm text-muted-foreground mt-1">{desc}</p>
                          </div>
                        </Label>
                      ))}
                    </RadioGroup>
                  </div>

                  {/* Question 2 */}
                  <div className="space-y-3">
                    <div>
                      <Label className="text-base font-semibold">
                        Question #2:{' '}
                        {selectedApplication?.video_question_2_choice === 'A'
                          ? 'What\'s something you care deeply about?'
                          : selectedApplication?.video_question_2_choice === 'B'
                          ? 'What\'s a moment that changed your perspective?'
                          : 'Question #2'}{' '}
                        <span className="text-red-500">*</span>
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Evaluate how much insight you gained about their personality
                      </p>
                    </div>
                    <RadioGroup
                      value={question2Score}
                      onValueChange={setQuestion2Score}
                      className="space-y-3"
                    >
                      {[
                        { score: 5, desc: 'Phenomenal Response, clearly gained insight into their personality, feel like I know them well' },
                        { score: 4, desc: 'Above average response. I am invested in learning more about them' },
                        { score: 3, desc: 'Average, I got to know them from their response' },
                        { score: 2, desc: 'Generic/Not personable response' },
                        { score: 1, desc: 'No effort, learned nothing new about the applicant' },
                      ].map(({ score, desc }) => (
                        <Label
                          key={score}
                          htmlFor={`q2-${score}`}
                          className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
                        >
                          <RadioGroupItem value={score.toString()} id={`q2-${score}`} className="mt-1" />
                          <div className="flex-1">
                            <span className="font-medium">
                              {score}
                            </span>
                            <p className="text-sm text-muted-foreground mt-1">{desc}</p>
                          </div>
                        </Label>
                      ))}
                    </RadioGroup>
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes (Optional)</Label>
                    <Textarea
                      id="notes"
                      placeholder="Any additional notes about this application..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-4 pt-4">
                    <Button
                      onClick={handleSubmitGrade}
                      disabled={isSubmitting || !question1Score || !question2Score}
                      className="flex-1"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        'Submit Grade'
                      )}
                    </Button>
                    {ungradedByMeCount > 1 && (
                      <Button variant="outline" onClick={handleNext}>
                        Next Ungraded
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-lg font-semibold mb-2">Failed to Load Application</p>
              <p className="text-sm text-muted-foreground mb-4">
                Unable to load application details. Please try again or check the console for errors.
              </p>
              <Button variant="outline" onClick={handleCloseModal}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

