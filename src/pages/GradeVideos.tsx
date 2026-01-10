import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, LogOut, Settings, Trophy, Video, User, CheckCircle2 } from 'lucide-react';
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

  // Grading form state
  const [question1Score, setQuestion1Score] = useState<string>('');
  const [question2Score, setQuestion2Score] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null);

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
    try {
      const { data, error } = await supabase.rpc('get_application_details', {
        p_application_id: applicationId,
      });

      if (error) throw error;

      const details = data as unknown as ApplicationDetails;
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
      toast.error('Failed to load application details');
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
    // Handle various YouTube URL formats
    const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
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
        p_question_2_choice: selectedApplication.video_question_2_choice,
        p_question_2_score: q2,
        p_notes: notes.trim() || null,
      });

      if (error) throw error;

      const result = data as unknown as { error?: string; success?: boolean };
      if (result.error) {
        throw new Error(result.error);
      }

      toast.success('Grade submitted successfully!');
      
      // Refresh applications list
      await fetchApplications();
      
      // Find next ungraded application
      const ungraded = applications.filter((app) => !app.graded && app.id !== selectedApplication.id);
      if (ungraded.length > 0) {
        handleOpenApplication(ungraded[0]);
      } else {
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
    const ungraded = applications.filter((app) => !app.graded);
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
      toast.info('All applications have been graded!');
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

  const ungradedCount = applications.filter((app) => !app.graded).length;
  const gradedCount = applications.filter((app) => app.graded).length;

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
                {gradedCount} / {applications.length} graded
              </span>
            </div>

            <Button variant="outline" size="sm" onClick={() => navigate('/select-game')}>
              Change Application Period
            </Button>

            <Button variant="outline" size="sm" onClick={() => navigate('/grade')}>
              Grade Resumes
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
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-2xl font-bold text-primary">{ungradedCount}</p>
                    <p className="text-sm text-muted-foreground">Ungraded</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-600">{gradedCount}</p>
                    <p className="text-sm text-muted-foreground">Graded</p>
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
                <CardTitle>Applications</CardTitle>
                <CardDescription>
                  Click on an application to grade it. Ungraded applications are shown first.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {applications.map((app) => (
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
                      <div className="flex items-center gap-2">
                        {app.graded ? (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Graded
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-600">
                            Pending
                          </Badge>
                        )}
                        <Button variant="ghost" size="sm">
                          Grade
                        </Button>
                      </div>
                    </div>
                  ))}
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
                    <p className="font-medium">{selectedApplication.applicant_email}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Expected Graduation</p>
                    <p className="font-medium">{selectedApplication.expected_graduation_year}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Major</p>
                    <p className="font-medium">{selectedApplication.major}</p>
                  </div>
                  {selectedApplication.minor && (
                    <div>
                      <p className="text-muted-foreground">Minor</p>
                      <p className="font-medium">{selectedApplication.minor}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground">GPA</p>
                    <p className="font-medium">{selectedApplication.gpa}</p>
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
                    Question 2 Choice: {selectedApplication.video_question_2_choice === 'A' 
                      ? 'A - Something I care deeply about'
                      : selectedApplication.video_question_2_choice === 'B'
                      ? 'B - A moment that changed my perspective'
                      : 'Not specified'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="aspect-video rounded-lg overflow-hidden border">
                    <iframe
                      src={convertYouTubeUrlToEmbed(selectedApplication.video_youtube_url)}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      title={`Video: ${getFullName(selectedApplication)}`}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Grading Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Grading</CardTitle>
                  <CardDescription>Rate each question on a scale of 1-5</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Question 1 */}
                  <div className="space-y-3">
                    <Label>
                      Question #1: Why BUCC? <span className="text-red-500">*</span>
                    </Label>
                    <RadioGroup
                      value={question1Score}
                      onValueChange={setQuestion1Score}
                      className="flex gap-4"
                    >
                      {[1, 2, 3, 4, 5].map((score) => (
                        <div key={score} className="flex items-center space-x-2">
                          <RadioGroupItem value={score.toString()} id={`q1-${score}`} />
                          <Label htmlFor={`q1-${score}`} className="cursor-pointer">
                            {score}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>

                  {/* Question 2 */}
                  <div className="space-y-3">
                    <Label>
                      Question #2:{' '}
                      {selectedApplication.video_question_2_choice === 'A'
                        ? 'What\'s something you care deeply about?'
                        : 'What\'s a moment that changed your perspective?'}{' '}
                      <span className="text-red-500">*</span>
                    </Label>
                    <RadioGroup
                      value={question2Score}
                      onValueChange={setQuestion2Score}
                      className="flex gap-4"
                    >
                      {[1, 2, 3, 4, 5].map((score) => (
                        <div key={score} className="flex items-center space-x-2">
                          <RadioGroupItem value={score.toString()} id={`q2-${score}`} />
                          <Label htmlFor={`q2-${score}`} className="cursor-pointer">
                            {score}
                          </Label>
                        </div>
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
                    {ungradedCount > 1 && (
                      <Button variant="outline" onClick={handleNext}>
                        Next Ungraded
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

