import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, AlertCircle, LogIn } from 'lucide-react';
import { toast } from 'sonner';

export default function Apply() {
  const navigate = useNavigate();
  const [periodName, setPeriodName] = useState<string | null>(null);
  const [isLoadingPeriod, setIsLoadingPeriod] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Form fields
  const [formData, setFormData] = useState({
    applicant_first_name: '',
    applicant_last_name: '',
    applicant_email: '',
    year: '',
    expected_graduation_year: '',
    gender: '',
    major: '',
    minor: '',
    college_of_primary_major: '',
    gpa: '',
    act_score: '',
    sat_score: '',
    military_affiliated: '',
    first_time_applying: '',
    how_did_you_hear: '',
    video_youtube_url: '',
    video_question_2_choice: '',
    additional_info: '',
  });

  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [profilePictureFile, setProfilePictureFile] = useState<File | null>(null);

  useEffect(() => {
    // Automatically load the default application period on page load
    loadDefaultPeriod();
  }, []);

  const loadDefaultPeriod = async () => {
    setIsLoadingPeriod(true);
    try {
      // Get the most recent game (default application period)
      const { data, error } = await supabase
        .from('games')
        .select('id, name')
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        setPeriodName(data[0].name);
      } else {
        toast.error('No application period is currently available. Please contact the administrator.');
        setPeriodName(null);
      }
    } catch (err: any) {
      console.error('Error loading default period:', err);
      toast.error('Failed to load application period. Please try again later.');
      setPeriodName(null);
    } finally {
      setIsLoadingPeriod(false);
    }
  };

  const validateYouTubeUrl = (url: string): boolean => {
    if (!url.trim()) return false;
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return youtubeRegex.test(url);
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!periodName) {
      toast.error('Application period not loaded. Please refresh the page.');
      return;
    }

    // Validate required fields
    if (!formData.applicant_first_name.trim()) {
      toast.error('First name is required');
      return;
    }
    if (!formData.applicant_email.trim()) {
      toast.error('Email is required');
      return;
    }
    if (!formData.applicant_email.includes('@osu.edu') && !formData.applicant_email.includes('@')) {
      toast.warning('Please use your OSU email (lastname.#@osu.edu)');
    }
    if (!formData.year) {
      toast.error('Year is required');
      return;
    }
    if (!formData.expected_graduation_year) {
      toast.error('Expected graduation year is required');
      return;
    }
    if (!formData.gender) {
      toast.error('Gender is required');
      return;
    }
    if (!formData.major.trim()) {
      toast.error('Major is required');
      return;
    }
    if (!formData.college_of_primary_major.trim()) {
      toast.error('College of Primary Major is required');
      return;
    }
    if (!formData.gpa.trim()) {
      toast.error('GPA is required');
      return;
    }
    if (!formData.military_affiliated) {
      toast.error('Military affiliation is required');
      return;
    }
    if (!formData.first_time_applying) {
      toast.error('Please specify if this is your first time applying');
      return;
    }
    if (!formData.how_did_you_hear.trim()) {
      toast.error('Please tell us how you heard about BUCC');
      return;
    }
    if (!formData.video_youtube_url.trim()) {
      toast.error('YouTube link is required');
      return;
    }
    if (!validateYouTubeUrl(formData.video_youtube_url)) {
      toast.error('Please enter a valid YouTube URL');
      return;
    }
    if (!formData.video_question_2_choice) {
      toast.error('Please specify which question you answered (A or B)');
      return;
    }
    if (!resumeFile) {
      toast.error('Resume PDF is required');
      return;
    }
    if (resumeFile.type !== 'application/pdf') {
      toast.error('Resume must be a PDF file');
      return;
    }
    if (resumeFile.size > 10 * 1024 * 1024) {
      toast.error('Resume file size must be less than 10 MB');
      return;
    }

    setIsSubmitting(true);

    try {
      // Upload resume
      const resumeFileName = `${Date.now()}-${resumeFile.name}`;
      const { error: resumeUploadError } = await supabase.storage
        .from('resumes')
        .upload(resumeFileName, resumeFile);

      if (resumeUploadError) {
        throw new Error(`Failed to upload resume: ${resumeUploadError.message}`);
      }

      // Upload profile picture (optional)
      let profilePicturePath: string | null = null;
      if (profilePictureFile) {
        if (profilePictureFile.size > 10 * 1024 * 1024) {
          throw new Error('Profile picture file size must be less than 10 MB');
        }
        const profileFileName = `${Date.now()}-${profilePictureFile.name}`;
        const { error: pictureUploadError } = await supabase.storage
          .from('profile-pictures')
          .upload(profileFileName, profilePictureFile);

        if (pictureUploadError) {
          console.error('Profile picture upload error:', pictureUploadError);
          toast.warning('Resume uploaded but profile picture failed. Continuing...');
        } else {
          profilePicturePath = profileFileName;
        }
      }

      // Submit application via RPC (access token is optional, will use default if not provided)
      const { data, error } = await supabase.rpc('submit_application', {
        p_applicant_first_name: formData.applicant_first_name.trim(),
        p_applicant_last_name: formData.applicant_last_name.trim() || null,
        p_applicant_email: formData.applicant_email.trim().toLowerCase(),
        p_year: formData.year,
        p_expected_graduation_year: formData.expected_graduation_year,
        p_gender: formData.gender || null,
        p_major: formData.major.trim() || null,
        p_minor: formData.minor.trim() || null,
        p_college_of_primary_major: formData.college_of_primary_major.trim() || null,
        p_gpa: formData.gpa.trim() || null,
        p_act_score: formData.act_score.trim() || null,
        p_sat_score: formData.sat_score.trim() || null,
        p_military_affiliated: formData.military_affiliated || null,
        p_first_time_applying: formData.first_time_applying || null,
        p_how_did_you_hear: formData.how_did_you_hear.trim() || null,
        p_resume_path: resumeFileName,
        p_profile_picture_path: profilePicturePath,
        p_video_youtube_url: formData.video_youtube_url.trim(),
        p_video_question_2_choice: formData.video_question_2_choice,
        p_additional_info: formData.additional_info.trim() || null,
        // p_access_token is optional and at the end - will use default period if not provided
      });

      if (error) {
        throw error;
      }

      const result = data as unknown as { error?: string; success?: boolean };
      if (result.error) {
        throw new Error(result.error);
      }

      setIsSubmitted(true);
      toast.success('Application submitted successfully!');
    } catch (err: any) {
      console.error('Error submitting application:', err);
      toast.error(err.message || 'Failed to submit application. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="glass-panel max-w-md w-full">
          <CardContent className="pt-6">
            <div className="text-center">
              <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-2">Application Submitted!</h2>
              <p className="text-muted-foreground mb-6">
                Thank you for your application. We'll review it and get back to you soon.
              </p>
              <Button onClick={() => navigate('/apply')}>Submit Another Application</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 relative">
      {/* Login Button for Graders - Top Right */}
      <div className="fixed top-4 right-4 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/auth')}
          className="bg-background/80 backdrop-blur-sm"
        >
          <LogIn className="w-4 h-4 mr-2" />
          Grader Login
        </Button>
      </div>

      <div className="container mx-auto max-w-4xl py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/bucc-logo.png" alt="BUCC Logo" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-3xl font-bold mb-2">BUCC Application</h1>
          <p className="text-muted-foreground">Submit your application for consideration</p>
        </div>

        {/* Loading State */}
        {isLoadingPeriod && (
          <Card className="glass-panel mb-6">
            <CardContent className="py-12">
              <div className="flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="ml-3 text-muted-foreground">Loading application period...</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Application Period Info */}
        {!isLoadingPeriod && periodName && (
          <Card className="glass-panel mb-6 border-primary/20">
            <CardContent className="pt-6">
              <div>
                <p className="text-sm text-muted-foreground">Application Period</p>
                <p className="text-xl font-semibold">{periodName}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Application Form */}
        {!isLoadingPeriod && periodName && (
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle>Application Form</CardTitle>
              <CardDescription>Please fill out all required fields (*)</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Personal Information Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Personal Information</h3>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="applicant_first_name">
                        First Name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="applicant_first_name"
                        placeholder="Brutus"
                        value={formData.applicant_first_name}
                        onChange={(e) =>
                          setFormData({ ...formData, applicant_first_name: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="applicant_last_name">
                        Last Name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="applicant_last_name"
                        placeholder="Buckeye"
                        value={formData.applicant_last_name}
                        onChange={(e) =>
                          setFormData({ ...formData, applicant_last_name: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="applicant_email">
                      Email <span className="text-red-500">*</span>
                    </Label>
                      <Input
                        id="applicant_email"
                        type="email"
                        placeholder="lastname.1@osu.edu"
                        value={formData.applicant_email}
                        onChange={(e) =>
                          setFormData({ ...formData, applicant_email: e.target.value })
                        }
                        required
                      />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="year">
                        Year <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={formData.year}
                        onValueChange={(value) => setFormData({ ...formData, year: value })}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select year" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Freshman">Freshman</SelectItem>
                          <SelectItem value="Sophomore">Sophomore</SelectItem>
                          <SelectItem value="Junior">Junior</SelectItem>
                          <SelectItem value="Senior">Senior</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="expected_graduation_year">
                        Expected Graduation Year <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={formData.expected_graduation_year}
                        onValueChange={(value) =>
                          setFormData({ ...formData, expected_graduation_year: value })
                        }
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select year" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2026">2026</SelectItem>
                          <SelectItem value="2027">2027</SelectItem>
                          <SelectItem value="2028">2028</SelectItem>
                          <SelectItem value="2029">2029</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gender">
                      Gender <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={formData.gender}
                      onValueChange={(value) => setFormData({ ...formData, gender: value })}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                        <SelectItem value="Nonbinary/Other">Nonbinary/Other</SelectItem>
                        <SelectItem value="Prefer not to answer">Prefer not to answer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="major">
                        Major(s) <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="major"
                        placeholder="Computer Science"
                        value={formData.major}
                        onChange={(e) => setFormData({ ...formData, major: e.target.value })}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="minor">Minor(s)</Label>
                      <Input
                        id="minor"
                        placeholder="Business"
                        value={formData.minor}
                        onChange={(e) => setFormData({ ...formData, minor: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="college_of_primary_major">
                      College of Primary Major <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="college_of_primary_major"
                      placeholder="Engineering"
                      value={formData.college_of_primary_major}
                      onChange={(e) =>
                        setFormData({ ...formData, college_of_primary_major: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="gpa">
                        GPA <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="gpa"
                        type="number"
                        step="0.01"
                        min="0"
                        max="4.0"
                        placeholder="3.5"
                        value={formData.gpa}
                        onChange={(e) => setFormData({ ...formData, gpa: e.target.value })}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="act_score">ACT Test Score</Label>
                      <Input
                        id="act_score"
                        type="number"
                        placeholder="Optional"
                        value={formData.act_score}
                        onChange={(e) => setFormData({ ...formData, act_score: e.target.value })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="sat_score">SAT Test Score</Label>
                      <Input
                        id="sat_score"
                        type="number"
                        placeholder="Optional"
                        value={formData.sat_score}
                        onChange={(e) => setFormData({ ...formData, sat_score: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="military_affiliated">
                      Are you a military-affiliated student? <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={formData.military_affiliated}
                      onValueChange={(value) =>
                        setFormData({ ...formData, military_affiliated: value })
                      }
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select option" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                        <SelectItem value="Prefer not to answer">Prefer not to answer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="first_time_applying">
                      Is this your first time applying to BUCC?{' '}
                      <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={formData.first_time_applying}
                      onValueChange={(value) =>
                        setFormData({ ...formData, first_time_applying: value })
                      }
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select option" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="how_did_you_hear">
                      How did you hear about BUCC? <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="how_did_you_hear"
                      placeholder="e.g., Friend, social media, career fair"
                      value={formData.how_did_you_hear}
                      onChange={(e) =>
                        setFormData({ ...formData, how_did_you_hear: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                {/* Application Questions Section */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-semibold">Application Questions</h3>
                  <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
                    <p>
                      <strong>Question #1:</strong> Why BUCC?
                    </p>
                    <p>
                      <strong>Question #2:</strong> Choose one to answer:
                    </p>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      <li>
                        <strong>A:</strong> What's something you care deeply about or could talk
                        hours about? What draws you to it?
                      </li>
                      <li>
                        <strong>B:</strong> What's a moment, interaction, or realization that
                        quietly changed how you see people or the world?
                      </li>
                    </ul>
                    <p className="text-xs text-muted-foreground mt-2">
                      Upload a video of your responses through YouTube. Videos must be under 2:30
                      min. Make sure your YouTube link is PUBLIC or UNLISTED!
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="video_youtube_url">
                        YouTube Link <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="video_youtube_url"
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={formData.video_youtube_url}
                        onChange={(e) =>
                          setFormData({ ...formData, video_youtube_url: e.target.value })
                        }
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Make sure your video is PUBLIC or UNLISTED
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="video_question_2_choice">
                        Which question did you answer for Question #2?{' '}
                        <span className="text-red-500">*</span>
                      </Label>
                      <Select
                        value={formData.video_question_2_choice}
                        onValueChange={(value) =>
                          setFormData({ ...formData, video_question_2_choice: value })
                        }
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select A or B" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A">A - Something I care deeply about</SelectItem>
                          <SelectItem value="B">B - A moment that changed my perspective</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* File Uploads Section */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-semibold">File Uploads</h3>

                  <div className="space-y-2">
                    <Label htmlFor="resume">
                      Resume (PDF) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="resume"
                      type="file"
                      accept=".pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setResumeFile(file);
                        }
                      }}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Format: FirstName_LastName_Resume_Grade.pdf (e.g.,
                      Buckeye_Brutus_Resume_Freshman.pdf)
                    </p>
                    {resumeFile && (
                      <p className="text-sm text-green-600">
                        ✓ {resumeFile.name} ({Math.round(resumeFile.size / 1024)} KB)
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="profile_picture">Profile Picture</Label>
                    <Input
                      id="profile_picture"
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setProfilePictureFile(file);
                        }
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Headshot or easily recognizable photo (optional, max 10 MB)
                    </p>
                    {profilePictureFile && (
                      <p className="text-sm text-green-600">
                        ✓ {profilePictureFile.name} ({Math.round(profilePictureFile.size / 1024)}{' '}
                        KB)
                      </p>
                    )}
                  </div>
                </div>

                {/* Additional Info Section */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-semibold">Additional Information (Optional)</h3>
                  <div className="space-y-2">
                    <Label htmlFor="additional_info">
                      Anything else we should know?
                    </Label>
                    <Textarea
                      id="additional_info"
                      placeholder="If you wish to provide details of circumstances or qualifications not reflected in the application, please use this space..."
                      value={formData.additional_info}
                      onChange={(e) =>
                        setFormData({ ...formData, additional_info: e.target.value })
                      }
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground">
                      This section is optional and will not negatively impact your application if
                      you elect not to fill it out.
                    </p>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex gap-4 pt-4">
                  <Button type="submit" disabled={isSubmitting} className="flex-1">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      'Submit Application'
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

