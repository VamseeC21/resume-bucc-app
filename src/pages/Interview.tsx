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
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, LogOut, Settings, Trophy, Users, FileText, CheckCircle2, Search, ArrowLeft, Upload, Phone, BookOpen } from 'lucide-react';
import { toast } from 'sonner';

type Round = 'R1' | 'R2';
type Criterion = { key: string; label: string; min: number; max: number; variants?: string[] };
type Section = { key: string; title: string; script?: string; criteria: Criterion[] };
type RoundConfig = {
  sections: Section[];
  recommendationOptions: Array<{ value: string; label: string }>;
  availabilityQuestions: Array<{ key: string; label: string }>;
  needsPresentationUpload: boolean;
  needsPhoneNumber: boolean;
  needsGlaringConcerns: boolean;
  computeTotal: (raw: Record<string, Record<string, number>>) => { total: number; sectionTotals: Record<string, number> };
};

// TODO: this is the SP26 R1/R2 script + rubric, transcribed from the actual
// interview guides. Update this config (not the schema) when the guide
// changes next cycle -- section_scores/section_totals are flexible JSONB
// specifically so that's a one-file edit, not a migration.
const ROUND_CONFIGS: Record<Round, RoundConfig> = {
  R1: {
    sections: [
      {
        key: 'intro',
        title: 'General Introduction (2 min)',
        script: `Please ask for their resumes prior to beginning the interview. (If they do not have a copy, be understanding and assure them we have it on file from their application — resume is just to ease judging.)

[READ]: Congratulations on making it to the first-round interview for the Buckeye Undergraduate Consulting Club. This interview is not designed to be a "one of you advances" type of competition. All, none, or some of the candidates in this group interview may move on. This interview will consist of two sections: 1) a set of behavioral interview questions, and 2) a group problem-solving exercise.`,
        criteria: [],
      },
      {
        key: 'behavioral',
        title: 'Behavioral Questions (25 min) — 50%',
        script: `[READ]: We will now begin the behavioral portion of this interview. We will move in a random order for who answers questions first, and will ask a total of 3-5 questions, however many time permits.

GUIDELINES:
— Ask as many questions as possible within the 25 minutes allotted, but do not cut off any candidates (every candidate should be able to answer each question that gets asked).
— Do not ask any questions not listed in this guide.
— Take detailed notes on each interviewee's responses.
— Begin the group portion by minute 27 of the time slot.

SCORING GUIDE (applies to every behavioral question):
4 — Communicates concisely, confidently, clearly, and relevant to question
3 — Minor lapses with occasional lack of clarity or focus regarding question
2 — Mid
1 — Struggles to articulate experiences and thoughts, doesn't answer question
0 — Unable to provide coherent responses (you have no clue what they said)`,
        criteria: [
          { key: 'intro_why_bucc', label: 'Q1: Tell us about yourself & why BUCC', min: 0, max: 4 },
          { key: 'q2', label: 'Q2 (pick version asked)', min: 0, max: 4, variants: [
            'V1: Tell me about a time you were given a vague or poorly defined problem. How did you structure it and decide what to focus on first?',
            'V2: Describe a time you identified an opportunity for improvement that wasn\'t assigned to you. What action did you take and what impact did it have?',
          ] },
          { key: 'q3', label: 'Q3 (pick version asked)', min: 0, max: 4, variants: [
            'V1: Tell me about a time you disagreed with a teammate or leader on an approach. How did you handle it, and what was the outcome?',
            'V2: Give an example of a time you made a mistake. How did you take responsibility and what did you learn?',
          ] },
          { key: 'q4_creative', label: 'Q4: Creative (ONE per candidate)', min: 0, max: 4, variants: [
            'V1: What is the biggest problem with Ohio State University as you see it, and how would you resolve this issue?',
            'V2: You\'re designing a space meant to make people talk to each other. What does it look like?',
            'V3: Describe society as it is today to someone 200 years ago. What pillars of society hold us afloat today and how would you explain that to someone with no knowledge?',
          ] },
        ],
      },
      {
        key: 'case',
        title: 'Business Case Group Exercise (15 min brainstorm + 3 min pitch) — 50%',
        script: `[READ]: We will now move on to the problem-solving activity. All of you are part of a team and will work together to develop a solution to a prompt. After receiving your prompt, you will have 15 minutes to brainstorm your answer. Your team is allotted a whiteboard and markers (paper and pencil if no markers present). Use of electronics and research is NOT permitted during this exercise. We encourage "pass the marker" collaboration so every member gets a chance to contribute. After 15 minutes, your team will give a pitch on your idea, up to 3 minutes. We highly encourage everyone to present.

Confirm they're ready to hear the prompt and can take notes, then choose ONE prompt below and read it aloud.

PROMPT #1
Company Background: ByteDance, owner of TikTok, is one of the largest digital content and social media companies globally and has no direct consumer productivity platform presence in the United States. They are considering launching a productivity + collaboration platform for the U.S. market.
Objective: Estimate the U.S. market size for productivity and collaboration software and recommend a market entry strategy to compete with existing players like Microsoft (Teams), Google (Workspace), and Slack.
Your group will have 15 minutes to develop a strategy and three minutes to present.

PROMPT #2
Company Background: MoveWell is a small app that helps people improve posture and reduce back pain through short daily exercises. User growth has stalled over the past six months.
Objective: Identify the top 2–3 reasons user growth might be slowing and recommend practical steps the team should take in the next three months.
Your group will have 15 minutes to develop a strategy and three minutes to present.

GUIDELINES: If candidates ask about the prompt, you may ask them to make their own assumptions. Time the 15-minute brainstorm and develop the first two scores (Teamwork, Analysis) during that phase. Observe the pitch, ask questions if time permits, and time the group so the pitch doesn't exceed 3 minutes; score Presentation from the pitch.

SCORING GUIDE:
Teamwork & Leadership — 4: Drives conversation, passes marker, active listening, seeks other inputs. 3: Drives conversation but fails to include team members, or vice versa; above average. 2: Mid. 1: Performs poorly at either criteria. 0: Bro is a fly on the wall.
Analysis & Creativity — 4: Comes up with critical assumptions and/or important new insights. 3: Comes up with assumptions but no new insights, or vice versa; above average. 2: Mid. 1: Performs poorly/mid at either criteria. 0: Nothing going through bro's head.
Presentation — 4: Would put it in front of a client. Professional & concise. 3: Professional, lacks conciseness, fillers, but coachable; above average. 2: Mid. 1: Rambling, lacks proper train of thought. 0: Unprofessional.`,
        criteria: [
          { key: 'teamwork_leadership', label: 'Teamwork & Leadership', min: 0, max: 4 },
          { key: 'analysis_creativity', label: 'Analysis & Creativity', min: 0, max: 4 },
          { key: 'presentation', label: 'Presentation', min: 0, max: 4 },
        ],
      },
      {
        key: 'wrapup',
        title: 'Wrap-up',
        script: `[READ]: Are you available for CEP sessions 3:00–4:30pm on Sundays?

If time is available, give the candidate the opportunity to ask a question about BUCC (write any significant notes below).

GUT FEELING: Keep in mind only ~40% of candidates will move on to the second-round interview, so please be conservative with "Yes" responses.`,
        criteria: [],
      },
    ],
    recommendationOptions: [
      { value: 'yes', label: 'Yes' },
      { value: 'maybe', label: 'Maybe' },
      { value: 'no', label: 'No' },
    ],
    availabilityQuestions: [
      { key: 'cep', label: 'Available for CEP Sundays 3:00–4:30pm?' },
    ],
    needsPresentationUpload: false,
    needsPhoneNumber: false,
    needsGlaringConcerns: false,
    computeTotal: (raw) => {
      const behavioral = raw.behavioral || {};
      const caseSec = raw.case || {};
      const bSum = ['intro_why_bucc', 'q2', 'q3', 'q4_creative'].reduce((s, k) => s + (behavioral[k] || 0), 0);
      const cSum = ['teamwork_leadership', 'analysis_creativity', 'presentation'].reduce((s, k) => s + (caseSec[k] || 0), 0);
      const behavioralTotal = (bSum / 16) * 50;
      const caseTotal = (cSum / 12) * 50;
      return { total: behavioralTotal + caseTotal, sectionTotals: { behavioral: behavioralTotal, case: caseTotal } };
    },
  },
  R2: {
    sections: [
      {
        key: 'intro',
        title: 'General Introduction (1 min)',
        script: `Before you start, briefly introduce yourselves to the candidate.

[READ]: Congratulations on making it to the second-round interview for the Buckeye Undergraduate Consulting Club. This interview will contain two sections: 1) your client proposal, and 2) the case.

To start off, tell us a bit about yourself and why are you here?`,
        criteria: [],
      },
      {
        key: 'behavioral',
        title: 'Behavioral (3 min)',
        script: `SCORING GUIDE — Intro & Why BUCC:
4: Communicates concisely, fluently, confidently, and expresses genuine interest
3: Misses 1 of either conciseness, confidence, genuine interest, or fluency.
2: Mid
1: Struggles with conciseness or confidence, mid/generic response
0: Idk how they made it past R1 — cannot answer questions, rambles, generic responses, lists off resume`,
        criteria: [
          { key: 'intro_why_bucc', label: 'Tell us about yourself and why you\'re here?', min: 0, max: 4 },
        ],
      },
      {
        key: 'client_proposal',
        title: 'Client Proposal (5–7 min present + 5–10 min Q&A)',
        script: `[READ]: Next, we will begin the Client Proposal. As previously instructed, you are presenting to Netflix to propose a plan to drive revenue growth through non-subscription channels (e.g., gaming, live events, or merchandise) while improving long-term retention among "churn-prone" households.

You will have 5 to 7 minutes to walk us through your proposal. Please be cognizant of time — hard cutoff at the 7 minute mark. Following the presentation, we'll take 5-10 minutes for follow-up questions.

Ask the interviewer to pull out their laptop to present or connect to the screen. If no questions before starting, they may begin. Ask follow-up questions afterward if time permits.

SCORING GUIDELINES:
Overall Concept & Logic — 4: Logical idea, supporting evidence, reasonable assumption. 3: Great, but missing one of the three above. 2: Mid. 1: Idea unclear, numbers don't make sense. 0: Solution doesn't make sense, novice slides.
Slide Deck Visuals — 4: Client-ready slide deck (graphs, color scheme, visuals, words). 3: Pretty good presentation, looks like a good class presentation. 2: Mid. 1: Engineering slide deck. 0: Just the worst.
Analysis & Reasoning — 4: Strong use of numbers and quantitative analysis, reasonable assumptions to back up claims. 3: Great, but missing one of the three above. 2: Mid. 1: Numbers unrelated or not impactful, weak assumptions. 0: No quantitative analysis.
Public Speaking & Questions — 4: Prepared, great cadence/communication, responds well to questions. 3: Great, but missing one of the three above, stumbles but recovers well. 2: Mid. 1: Visible panic/nervousness, stumbles & poor recovery, poor responses. 0: Unprepared, read off slides, questions unanswered, bad presentation.

Note any glaring concerns/issues below.`,
        criteria: [
          { key: 'concept_logic', label: 'Overall Concept & Logic', min: 0, max: 4 },
          { key: 'slide_deck_visuals', label: 'Slide Deck Visuals', min: 0, max: 4 },
          { key: 'analysis_reasoning', label: 'Analysis & Reasoning', min: 0, max: 4 },
          { key: 'speaking_questions', label: 'Public Speaking & Questions', min: 0, max: 4 },
        ],
      },
      {
        key: 'case_intro',
        title: 'Case — Introduction',
        script: `[READ]: We will now move on to the case portion of the interview. Please get out some paper and something to write with and let us know when you're ready to begin.

All information for the case is in this guide, but interviewers can also refer to the full printed/digital case guide for additional reference (visual framework/brainstorm examples live there, not reproduced here).`,
        criteria: [],
      },
      {
        key: 'case',
        title: 'Case — Framework',
        script: `[READ]: Costco is exploring strategies to increase membership, especially among younger consumers who are less likely to buy bulk products. While existing members are loyal, new demographics remain underpenetrated, and the company is concerned that failure to attract younger members could limit long-term growth.

Your team has been hired to propose a strategic plan to grow Costco's membership base and improve engagement with younger consumers. Recommendations may address membership pricing, product assortment, digital strategy, marketing campaigns, and in-store experiences.

Give the candidate time to recap the prompt and ask clarifying questions.

CLARIFYING INFORMATION (only provide if asked):
— Member demographics: ~60% of members are over 35, 25% are 25–35, 15% are under 25.
— Product preferences: older members buy bulk household goods/groceries; younger members favor tech gadgets, fitness products, organic foods, smaller-pack specialty items.
— Marketing efforts: currently focused on in-store promotions and general email; digital campaigns targeting younger consumers are limited.
— Membership pricing: Basic $65/yr, Executive $130/yr. Discounts/promotions for students or new members possible with board approval.
— Success metrics: new memberships, renewal rates, total membership revenue, spending per member.

FRAMEWORK GUIDANCE: If three minutes pass without a finished framework, ask them to share what they have so far. Acknowledge their direction, then say something like: "I think it would be best if we started by looking at some of the costs of moving more manufacturing to the US."

FRAMEWORK SCORING RUBRIC:
4: 2-3 buckets that are MECE (Mutually Exclusive, Collectively Exhaustive). Candidate explains why they're looking into each section and all areas are relevant. Candidate has a hypothesis that clarifies their top consideration and attempts to drive the case forward.
3: 2-3 buckets that are mostly MECE, relevant to the prompt, break down the problem well. Little/no attempt made to drive the case forward.
2: Structured buckets with some overlap, mostly relevant but rush to solutions before addressing root cause.
1: Not MECE, rush to solutions but still some good ideas.
0: Not MECE, no effort made to generate relevant ideas, rushing to solutions.`,
        criteria: [
          { key: 'framework', label: 'Framework', min: 0, max: 4 },
        ],
      },
      {
        key: 'case_quant',
        title: 'Case — Quant',
        script: `[READ]: Costco is considering offering college students a 20% discount off all memberships in addition to investing in a marketing campaign to promote awareness of the discount and boost membership. Costco wants the campaign to generate 33% ROI — what is the average annual spend required by these new members to meet Costco's profit goal?

DATA PROVIDED:
— Total marketing campaign investment: $1,500,000
— Membership discount: 20% off for college students
— Standard membership: $65/yr, Executive membership: $130/yr
— 10,000 students will purchase a membership; 80% will do a standard membership
— Costco's profit margin is 10%

EXAMPLE CALCULATION (interviewer reference — do not read):
Revenue Goal: $1,500,000 × 1.33 = $2,000,000
Membership revenue: (0.80 × 10,000 × 65 × 0.80) + (0.20 × 10,000 × 130 × 0.80) = $624,000
Remaining revenue goal: $2,000,000 − $624,000 = $1,376,000
Apply profit margin: $1,376,000 = 0.10 × X → X = $13,760,000 total spend required from college students
$13,760,000 / 10,000 students = $1,376 required average annual spend to meet ROI goal

QUANT SCORING RUBRIC:
4: Recaps the numbers, walks interviewer through their thought process before calculating, gets the right answer with no help, puts the answer in context of the prompt.
3: Recaps the numbers, gets to the right answer without much help, puts the answer in context.
2: Gets to the answer with a few hiccups, recaps the numbers.
1: Gets to the answer but it takes time and a lot of help; does NOT put the number in context.
0: Never gets to the right answer, does not put the number in context.`,
        criteria: [
          { key: 'quant', label: 'Quant', min: 0, max: 4 },
        ],
      },
      {
        key: 'case_brainstorm',
        title: 'Case — Brainstorming',
        script: `[READ]: While the student discount might get Gen Z through the doors, data suggests that "bulk buying" is a barrier for students living in small dorms or shared apartments with limited storage space. This demographic also prioritizes digital convenience over the traditional "treasure hunt" in-store experience.

Beyond just a price discount, how can Costco redesign its product assortment and digital experience to become an essential brand for younger consumers without alienating its core base of suburban families?

BRAINSTORMING SCORING RUBRIC:
4: Separates ideas into 2-3 sections, creative yet practical solutions, explains how their solutions/ideas address the problem.
3: Has good creative solutions that would address the problem.
2: Has several solutions that are not structured; not all solutions address the problem.
1: Has only 1 or 2 good ideas that are not structured.
0: Solutions are not practical, do not address the problem, and are not structured.`,
        criteria: [
          { key: 'brainstorming', label: 'Brainstorming', min: 0, max: 4 },
        ],
      },
      {
        key: 'case_conclusion',
        title: 'Case — Conclusion',
        script: `[READ]: You have a meeting with Costco's Chief Marketing Officer, and they want your recommendation on what they should do. What do you tell them?

EXAMPLE CONCLUSION (interviewer reference — do not read):
"I would advise launching a targeted student membership campaign immediately. Offering a 20% discount combined with a focused marketing push is projected to generate an average annual spend of $1,376 per student, achieving the desired 33% ROI while driving long-term engagement with younger consumers. A key risk of this strategy is that the emphasis on smaller packs and digital convenience could harm the traditional bulk-buying experience valued by Costco's core suburban and family members, but this can be mitigated by maintaining bulk pricing and core product offerings while expanding student-focused bundles and digital options. Immediate next steps include piloting the discount at select stores, and refining product assortment and digital experiences based on initial engagement metrics."

CONCLUSION SCORING RUBRIC:
4: Under one minute. Leads with recommendation, gives points of reasoning, risks and mitigation, then next steps.
3: Has ¾ of the above points.
2: Has 2/4 of the above points.
1: Has ¼ of the above points.
0: Does not follow any of the above points.`,
        criteria: [
          { key: 'conclusion', label: 'Conclusion', min: 0, max: 4 },
        ],
      },
      {
        key: 'wrapup',
        title: 'Wrap-up',
        script: `[READ]: If accepted, would you be able to attend general body meetings 8:00–9:00pm on Tuesdays?

[READ]: If accepted, would you be able to attend CEP 3:00–4:30pm on Sundays? If time is available, give the candidate the opportunity to ask a question about BUCC.

Please be very detailed in your notes if you selected "Maybe" — include your overall impressions and justify your recommendation.`,
        criteria: [],
      },
    ],
    recommendationOptions: [
      { value: 'yes', label: 'Yes' },
      { value: 'maybe', label: 'Maybe' },
      { value: 'no', label: 'No' },
      { value: 'juniors_yes', label: '*Juniors* Yes — client-ready now' },
      { value: 'juniors_no', label: '*Juniors* No — not client-ready' },
    ],
    availabilityQuestions: [
      { key: 'gbm', label: 'Available for GBM Tuesdays 8:00–9:00pm?' },
      { key: 'cep', label: 'Available for CEP Sundays 3:00–4:30pm?' },
    ],
    needsPresentationUpload: true,
    needsPhoneNumber: true,
    needsGlaringConcerns: true,
    // No weighting was specified for R2 (unlike R1's stated 50/50) -- totaling
    // as a flat sum of every criterion. Revisit if a weighting scheme is given.
    computeTotal: (raw) => {
      const sectionTotals: Record<string, number> = {};
      let total = 0;
      for (const [sectionKey, values] of Object.entries(raw)) {
        const sum = Object.values(values).reduce((s, v) => s + (v || 0), 0);
        sectionTotals[sectionKey] = sum;
        total += sum;
      }
      return { total, sectionTotals };
    },
  },
};

interface Applicant {
  id: string;
  candidate_number: number | null;
  first_name: string | null;
  last_name: string | null;
  applicant_name: string;
  applicant_email: string;
  year: string;
  major: string | null;
  resume_id: string | null;
  score_count: number;
  scored_by_me: boolean;
}

interface CandidateFormState {
  scores: Record<string, Record<string, number>>;
  variants: Record<string, string>;
  recommendation: string;
  overallImpression: string;
  availability: Record<string, boolean>;
  candidatePhone: string;
  glaringConcerns: string;
  presentationFile: File | null;
  isSubmitting: boolean;
  isSubmitted: boolean;
  resumeUrl: string | null;
}

const emptyForm = (): CandidateFormState => ({
  scores: {}, variants: {}, recommendation: '', overallImpression: '',
  availability: {}, candidatePhone: '', glaringConcerns: '',
  presentationFile: null, isSubmitting: false, isSubmitted: false, resumeUrl: null,
});

function getFullName(app: Applicant): string {
  if (app.first_name && app.last_name) return `${app.first_name} ${app.last_name}`.trim();
  if (app.first_name) return app.first_name.trim();
  return (app.applicant_name || 'Unknown').trim();
}

const criterionMap = (config: RoundConfig) => {
  const map = new Map<string, { sectionKey: string; criterion: Criterion }>();
  config.sections.forEach((s) => s.criteria.forEach((c) => map.set(c.key, { sectionKey: s.key, criterion: c })));
  return map;
};

export default function Interview() {
  const { user, loading: authLoading, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [currentGameName, setCurrentGameName] = useState<string>('');
  const [round, setRound] = useState<Round>('R1');
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameSearch, setNameSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [grading, setGrading] = useState(false);
  const [coInterviewerName, setCoInterviewerName] = useState('');
  const [roomLabel, setRoomLabel] = useState('');
  const [forms, setForms] = useState<Record<string, CandidateFormState>>({});

  const config = ROUND_CONFIGS[round];
  const allCriteria = useMemo(() => criterionMap(config), [config]);

  const filteredApplicants = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    if (!q) return applicants;
    return applicants.filter((a) => {
      const name = getFullName(a).toLowerCase();
      return name.includes(q) || a.applicant_email.toLowerCase().includes(q) || String(a.candidate_number || '').includes(q);
    });
  }, [applicants, nameSearch]);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    const savedGameId = localStorage.getItem('currentGameId');
    const savedGameName = localStorage.getItem('currentGameName');
    if (savedGameId && savedGameName) {
      setCurrentGameId(savedGameId);
      setCurrentGameName(savedGameName);
    } else {
      setError('Please select an application period first');
      navigate('/select-game');
    }
  }, [user, navigate]);

  const fetchApplicants = useCallback(async () => {
    if (!user || !currentGameId) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data: apps, error: appsError } = await supabase
        .from('applications')
        .select('id, candidate_number, first_name, last_name, applicant_name, applicant_email, year, major, resume_id')
        .eq('game_id', currentGameId)
        .order('candidate_number', { ascending: true });

      if (appsError) throw appsError;

      const { data: roundScores, error: scoresError } = await supabase
        .from('interview_scores')
        .select('application_id, interviewer_id')
        .eq('game_id', currentGameId)
        .eq('round', round);

      if (scoresError) throw scoresError;

      const countByApp = new Map<string, number>();
      const mineByApp = new Set<string>();
      (roundScores || []).forEach((s) => {
        countByApp.set(s.application_id, (countByApp.get(s.application_id) || 0) + 1);
        if (s.interviewer_id === user.id) mineByApp.add(s.application_id);
      });

      setApplicants((apps || []).map((a) => ({
        ...a,
        score_count: countByApp.get(a.id) || 0,
        scored_by_me: mineByApp.has(a.id),
      })));
    } catch (err) {
      console.error('Error fetching applicants:', err);
      setError(err instanceof Error ? err.message : 'Failed to load applicants');
      toast.error('Failed to load applicants');
    } finally {
      setIsLoading(false);
    }
  }, [user, currentGameId, round]);

  useEffect(() => {
    if (user && currentGameId) fetchApplicants();
  }, [user, currentGameId, round, fetchApplicants]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) {
        toast.info('You can grade at most 3 candidates at once');
        return prev;
      }
      return [...prev, id];
    });
  };

  const startGrading = async () => {
    const initial: Record<string, CandidateFormState> = {};
    for (const id of selectedIds) {
      initial[id] = emptyForm();
    }
    setForms(initial);
    setGrading(true);

    for (const applicant of applicants.filter((a) => selectedIds.includes(a.id))) {
      if (!applicant.resume_id) continue;
      const { data: resume } = await supabase.from('resumes').select('pdf_path').eq('id', applicant.resume_id).maybeSingle();
      if (resume?.pdf_path) {
        const { data: signed } = await supabase.storage.from('resumes').createSignedUrl(resume.pdf_path, 3600);
        if (signed) setForms((prev) => ({ ...prev, [applicant.id]: { ...prev[applicant.id], resumeUrl: signed.signedUrl } }));
      }
    }
  };

  const updateForm = (applicantId: string, patch: Partial<CandidateFormState>) => {
    setForms((prev) => ({ ...prev, [applicantId]: { ...prev[applicantId], ...patch } }));
  };

  const setScore = (applicantId: string, sectionKey: string, criterionKey: string, value: number) => {
    setForms((prev) => ({
      ...prev,
      [applicantId]: {
        ...prev[applicantId],
        scores: { ...prev[applicantId].scores, [sectionKey]: { ...prev[applicantId].scores[sectionKey], [criterionKey]: value } },
      },
    }));
  };

  const submitCandidate = async (applicant: Applicant) => {
    const form = forms[applicant.id];
    if (!user || !form) return;

    const allScored = config.sections.every((s) => s.criteria.every((c) => form.scores[s.key]?.[c.key] !== undefined));
    if (!allScored) {
      toast.error(`Please score every criterion for ${getFullName(applicant)}`);
      return;
    }
    if (!form.recommendation) {
      toast.error(`Please pick a recommendation for ${getFullName(applicant)}`);
      return;
    }

    updateForm(applicant.id, { isSubmitting: true });
    try {
      let presentationPath: string | null = null;
      if (config.needsPresentationUpload && form.presentationFile) {
        const path = `${applicant.id}-${Date.now()}-${form.presentationFile.name}`;
        const { error: uploadError } = await supabase.storage.from('presentations').upload(path, form.presentationFile);
        if (uploadError) throw new Error(`Failed to upload presentation: ${uploadError.message}`);
        presentationPath = path;
      }

      const { total, sectionTotals } = config.computeTotal(form.scores);
      const scoresWithVariants: Record<string, Record<string, number | string>> = {};
      for (const [sectionKey, values] of Object.entries(form.scores)) {
        scoresWithVariants[sectionKey] = { ...values };
      }
      for (const [criterionKey, variant] of Object.entries(form.variants)) {
        const entry = allCriteria.get(criterionKey);
        if (entry) scoresWithVariants[entry.sectionKey][`${criterionKey}_variant`] = variant;
      }

      const { data, error } = await supabase.rpc('submit_interview_score', {
        p_application_id: applicant.id,
        p_interviewer_id: user.id,
        p_round: round,
        p_co_interviewer_name: coInterviewerName.trim() || null,
        p_room_label: roomLabel.trim() || null,
        p_section_scores: scoresWithVariants,
        p_section_totals: sectionTotals,
        p_total_score: total,
        p_recommendation: form.recommendation,
        p_overall_impression: form.overallImpression.trim() || null,
        p_availability: form.availability,
        p_candidate_phone: form.candidatePhone.trim() || null,
        p_presentation_path: presentationPath,
        p_glaring_concerns: form.glaringConcerns.trim() || null,
      });

      if (error) throw error;
      const result = data as { error?: string; success?: boolean };
      if (result.error) throw new Error(result.error);

      toast.success(`Score submitted for ${getFullName(applicant)}`);
      updateForm(applicant.id, { isSubmitted: true });
      fetchApplicants();
    } catch (err) {
      console.error('Error submitting interview score:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to submit score');
    } finally {
      updateForm(applicant.id, { isSubmitting: false });
    }
  };

  const selectedApplicants = applicants.filter((a) => selectedIds.includes(a.id));
  const scoredByMeCount = applicants.filter((a) => a.scored_by_me).length;

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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/bucc-logo.png" alt="Logo" className="w-10 h-10 object-contain" />
            <div>
              <span className="font-semibold text-lg">Interview Scoring</span>
              {currentGameName && <span className="text-sm text-muted-foreground ml-2">• {currentGameName}</span>}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="stat-card flex items-center gap-2 py-2">
              <Trophy className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">{scoredByMeCount} / {applicants.length} scored by you</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/select-game')}>Change Application Period</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/grade')}>Grade Resumes</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/grade-videos')}>Grade Videos</Button>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => navigate('/admin')}>
                <Settings className="w-4 h-4 mr-2" /> Admin
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="w-4 h-4 mr-2" /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className={grading ? 'w-full max-w-[1900px] mx-auto px-4 py-6' : 'container mx-auto px-4 py-8'}>
        <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
          <Tabs value={round} onValueChange={(v) => { setRound(v as Round); setSelectedIds([]); setGrading(false); }}>
            <TabsList>
              <TabsTrigger value="R1">Round 1</TabsTrigger>
              <TabsTrigger value="R2">Round 2</TabsTrigger>
            </TabsList>
          </Tabs>
          {grading && (
            <Button variant="outline" size="sm" onClick={() => setGrading(false)}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Roster
            </Button>
          )}
        </div>

        {!grading ? (
          error ? (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={fetchApplicants}>Try Again</Button>
            </div>
          ) : applicants.length === 0 ? (
            <Card className="glass-panel">
              <CardContent className="pt-6 text-center py-12">
                <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No Applicants Yet</h3>
                <p className="text-muted-foreground">There are no applicants for this period yet.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="glass-panel">
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>Candidates — {round === 'R1' ? 'Round 1' : 'Round 2'}</CardTitle>
                    <CardDescription>Select up to 3 candidates in a room, then grade them side by side.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative w-full sm:w-56 shrink-0">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                      <Input
                        type="search"
                        placeholder="Search name, email, or ID..."
                        value={nameSearch}
                        onChange={(e) => setNameSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <Button onClick={startGrading} disabled={selectedIds.length === 0}>
                      Grade Selected ({selectedIds.length})
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {filteredApplicants.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      {nameSearch.trim() ? `No candidates match "${nameSearch.trim()}".` : 'No candidates to display.'}
                    </div>
                  ) : (
                    filteredApplicants.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => toggleSelect(a.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox checked={selectedIds.includes(a.id)} onCheckedChange={() => toggleSelect(a.id)} onClick={(e) => e.stopPropagation()} />
                          <div>
                            <h3 className="font-semibold">
                              {a.candidate_number && <span className="text-muted-foreground font-normal">#{a.candidate_number} — </span>}
                              {getFullName(a)}
                            </h3>
                            <p className="text-sm text-muted-foreground">{a.year} • {a.major}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">{a.score_count} scored</span>
                          {a.scored_by_me ? (
                            <Badge variant="outline" className="text-blue-600 border-blue-600">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Scored
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground border-muted">Pending</Badge>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          )
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
            {/* Left: interview script/guide, one persistent scrollable panel */}
            <div className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] overflow-y-auto">
              <Card className="glass-panel">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="w-4 h-4" /> Interview Guide
                  </CardTitle>
                  <CardDescription>{round === 'R1' ? 'Round 1' : 'Round 2'} — read-aloud script & rubric</CardDescription>
                </CardHeader>
                <CardContent>
                  <Accordion type="multiple" defaultValue={[config.sections[0]?.key]} className="w-full">
                    {config.sections.filter((s) => s.script).map((s) => (
                      <AccordionItem key={s.key} value={s.key}>
                        <AccordionTrigger className="text-sm text-left">{s.title}</AccordionTrigger>
                        <AccordionContent>
                          <p className="text-xs whitespace-pre-line text-muted-foreground leading-relaxed">{s.script}</p>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            </div>

            {/* Right: shared session info + compact scoring grid + per-candidate wrap-up */}
            <div className="space-y-4 min-w-0">
              <Card className="glass-panel">
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Interviewer 1 (you)</Label>
                      <Input value={user ? `${user.email}` : ''} disabled className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Interviewer 2 Full Name</Label>
                      <Input value={coInterviewerName} onChange={(e) => setCoInterviewerName(e.target.value)} placeholder="Co-interviewer's name" className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Room</Label>
                      <Input value={roomLabel} onChange={(e) => setRoomLabel(e.target.value)} placeholder="e.g. Room 3" className="h-8 text-xs" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Scoring</CardTitle>
                  <CardDescription>Consult the guide on the left while scoring — labels here are intentionally short.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <div className="min-w-[560px]">
                    <div
                      className="grid gap-y-1 items-end pb-2"
                      style={{ gridTemplateColumns: `minmax(200px,1fr) repeat(${selectedApplicants.length}, minmax(150px,1fr))` }}
                    >
                      <span />
                      {selectedApplicants.map((a, idx) => (
                        <div
                          key={a.id}
                          className={`text-xs font-semibold truncate pb-1 pr-2 ${idx > 0 ? 'pl-4 border-l border-border' : ''}`}
                          title={getFullName(a)}
                        >
                          {a.candidate_number ? `#${a.candidate_number} ` : ''}{getFullName(a)}
                        </div>
                      ))}
                    </div>

                    {config.sections.filter((s) => s.criteria.length > 0).map((section) => (
                      <div key={section.key} className="mb-3">
                        <div className="text-xs font-semibold text-muted-foreground mb-1.5 mt-2">{section.title}</div>
                        {section.criteria.map((criterion) => (
                          <div
                            key={criterion.key}
                            className="grid gap-y-1 items-center py-2 border-t border-border/60"
                            style={{ gridTemplateColumns: `minmax(200px,1fr) repeat(${selectedApplicants.length}, minmax(150px,1fr))` }}
                          >
                            <span className="text-xs leading-snug pr-2">{criterion.label}</span>
                            {selectedApplicants.map((a, idx) => {
                              const form = forms[a.id];
                              if (!form) return <span key={a.id} />;
                              return (
                                <div key={a.id} className={`space-y-1 py-1 pr-2 ${idx > 0 ? 'pl-4 border-l border-border' : ''}`}>
                                  {criterion.variants && (
                                    <Select
                                      value={form.variants[criterion.key] || ''}
                                      onValueChange={(v) => updateForm(a.id, { variants: { ...form.variants, [criterion.key]: v } })}
                                    >
                                      <SelectTrigger className="h-6 text-[10px] px-1.5"><SelectValue placeholder="Version..." /></SelectTrigger>
                                      <SelectContent>
                                        {criterion.variants.map((v, i) => (
                                          <SelectItem key={i} value={v} className="text-xs">{v}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                  <div className="flex gap-1">
                                    {Array.from({ length: criterion.max - criterion.min + 1 }, (_, i) => criterion.min + i).map((score) => (
                                      <button
                                        key={score}
                                        type="button"
                                        onClick={() => setScore(a.id, section.key, criterion.key, score)}
                                        className={`flex-1 h-7 rounded border text-xs font-medium transition-colors ${
                                          form.scores[section.key]?.[criterion.key] === score
                                            ? 'bg-primary text-primary-foreground border-primary'
                                            : 'hover:bg-muted/50 border-border'
                                        }`}
                                      >
                                        {score}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                {selectedApplicants.map((a) => {
                  const form = forms[a.id];
                  if (!form) return null;
                  return (
                    <Card key={a.id} className="glass-panel">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">{getFullName(a)}</CardTitle>
                          {form.isSubmitted && <Badge variant="outline" className="text-blue-600 border-blue-600 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Saved</Badge>}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {form.resumeUrl && (
                          <Button variant="outline" size="sm" className="w-full" onClick={() => window.open(form.resumeUrl!, '_blank')}>
                            <FileText className="w-4 h-4 mr-2" /> View Resume
                          </Button>
                        )}

                        {config.needsGlaringConcerns && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Glaring concerns/issues?</Label>
                            <Textarea value={form.glaringConcerns} onChange={(e) => updateForm(a.id, { glaringConcerns: e.target.value })} rows={2} className="text-xs" />
                          </div>
                        )}

                        <div className="space-y-1.5">
                          {config.availabilityQuestions.map((q) => (
                            <label key={q.key} className="flex items-center gap-2 text-xs cursor-pointer">
                              <Checkbox
                                checked={!!form.availability[q.key]}
                                onCheckedChange={(v) => updateForm(a.id, { availability: { ...form.availability, [q.key]: !!v } })}
                              />
                              {q.label}
                            </label>
                          ))}
                        </div>

                        {config.needsPhoneNumber && (
                          <div className="space-y-1.5">
                            <Label className="text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> Candidate phone #</Label>
                            <Input value={form.candidatePhone} onChange={(e) => updateForm(a.id, { candidatePhone: e.target.value })} className="h-8 text-xs" />
                          </div>
                        )}

                        {config.needsPresentationUpload && (
                          <div className="space-y-1.5">
                            <Label className="text-xs flex items-center gap-1"><Upload className="w-3 h-3" /> Client proposal file</Label>
                            <Input type="file" onChange={(e) => updateForm(a.id, { presentationFile: e.target.files?.[0] || null })} className="h-8 text-xs" />
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <Label className="text-xs">Recommendation</Label>
                          <Select value={form.recommendation} onValueChange={(v) => updateForm(a.id, { recommendation: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick one" /></SelectTrigger>
                            <SelectContent>
                              {config.recommendationOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            Overall impression / notes {form.recommendation === 'maybe' && <span className="text-amber-600">(be detailed if Maybe)</span>}
                          </Label>
                          <Textarea value={form.overallImpression} onChange={(e) => updateForm(a.id, { overallImpression: e.target.value })} rows={3} className="text-xs" />
                        </div>

                        <Button onClick={() => submitCandidate(a)} disabled={form.isSubmitting} className="w-full" size="sm">
                          {form.isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : form.isSubmitted ? 'Re-submit' : 'Submit Score'}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
