import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, GripVertical, ChevronDown, ChevronUp, Sparkles,
  Download, X, FileText, Video,
} from 'lucide-react';
import { toast } from 'sonner';

type Round = 'RESUME' | 'R1' | 'R2';

interface ScoreDetail {
  interviewer_id: string;
  interviewer_name: string;
  co_interviewer_name: string | null;
  room_label: string | null;
  section_scores: Record<string, Record<string, number | string>>;
  section_totals: Record<string, number>;
  total_score: number;
  recommendation: string | null;
  overall_impression: string | null;
  availability: Record<string, boolean>;
  candidate_phone: string | null;
  presentation_path: string | null;
  glaring_concerns: string | null;
}

interface DeliberationRow {
  round_candidate_id: string;
  application_id: string;
  candidate_number: number | null;
  first_name: string | null;
  last_name: string | null;
  applicant_email: string;
  year: string;
  major: string | null;
  gender: string | null;
  video_youtube_url: string | null;
  video_question_2_choice: string | null;
  resume_id: string | null;
  color: string | null;
  sort_order: number;
  notes: string | null;
  // interview rounds (R1/R2) only
  application_ranking?: number | null;
  was_in_r1?: boolean;
  was_in_r2?: boolean;
  avg_score?: number | null;
  score_count?: number;
  scores?: ScoreDetail[] | null;
  // resume round only
  elo_rating?: number | null;
  video_avg_score?: number | null;
  video_grade_count?: number | null;
  combined_score?: number | null;
}

interface Category {
  key: string;
  label: string;
  value: number | null;
  title?: string;
}

type SortValue = number | string | null;

const PALETTE: Array<{ key: string; hex: string; label: string }> = [
  { key: 'dark-green', hex: '#15803d', label: 'Guaranteed / accept' },
  { key: 'green', hex: '#4ade80', label: 'Leaning yes' },
  { key: 'yellow', hex: '#facc15', label: 'Middle ground' },
  { key: 'red', hex: '#f87171', label: 'Leaning no' },
  { key: 'dark-red', hex: '#b91c1c', label: 'Reject' },
  { key: 'purple', hex: '#a855f7', label: 'Invite to reapply' },
];

// Mirrors the Question 2 prompts on the application form (src/pages/Apply.tsx)
// so the deliberation tooltip shows what the candidate actually answered
// instead of just the bare letter.
const VIDEO_Q2_PROMPT: Record<string, string> = {
  A: "What are three things you don't care about at all?",
  B: 'If you had to give yourself a nickname, what would it be and why?',
};

const RECOMMENDATION_STYLE: Record<string, string> = {
  yes: 'text-green-600 border-green-600',
  juniors_yes: 'text-green-600 border-green-600',
  maybe: 'text-amber-600 border-amber-600',
  no: 'text-red-600 border-red-600',
  juniors_no: 'text-red-600 border-red-600',
};

function colorHex(key: string | null): string | undefined {
  return PALETTE.find((c) => c.key === key)?.hex;
}

function colorLabel(key: string | null): string {
  return PALETTE.find((c) => c.key === key)?.label || '';
}

function fullName(row: DeliberationRow): string {
  if (row.first_name && row.last_name) return `${row.first_name} ${row.last_name}`.trim();
  return row.first_name?.trim() || row.applicant_email;
}

function sectionKeysFor(rows: DeliberationRow[]): string[] {
  const keys = new Set<string>();
  rows.forEach((r) => (r.scores || []).forEach((s) => Object.keys(s.section_totals || {}).forEach((k) => keys.add(k))));
  return Array.from(keys);
}

// Average each section's total across every grader who scored this candidate,
// so the comparison table reflects a consensus per category rather than
// whichever score happened to be submitted first.
function avgSectionTotals(row: DeliberationRow): Record<string, number> {
  const acc: Record<string, { sum: number; count: number }> = {};
  (row.scores || []).forEach((s) => {
    Object.entries(s.section_totals || {}).forEach(([k, v]) => {
      const num = typeof v === 'number' ? v : Number(v);
      if (Number.isNaN(num)) return;
      if (!acc[k]) acc[k] = { sum: 0, count: 0 };
      acc[k].sum += num;
      acc[k].count += 1;
    });
  });
  const out: Record<string, number> = {};
  Object.entries(acc).forEach(([k, { sum, count }]) => { out[k] = sum / count; });
  return out;
}

function categoriesFor(row: DeliberationRow, round: Round, sectionKeys: string[]): Category[] {
  if (round === 'RESUME') {
    return [
      { key: 'elo', label: 'ELO', value: row.elo_rating ?? null },
      {
        key: 'video',
        label: 'Video Avg',
        value: row.video_avg_score ?? null,
        title: row.video_grade_count ? `${row.video_grade_count} grader(s)` : undefined,
      },
    ];
  }
  const avgs = avgSectionTotals(row);
  return sectionKeys.map((k) => ({ key: k, label: k, value: avgs[k] ?? null }));
}

function totalFor(row: DeliberationRow, round: Round): { label: string; value: number | null } {
  if (round === 'RESUME') return { label: 'Combined', value: row.combined_score ?? null };
  return { label: 'Avg Total', value: row.avg_score ?? null };
}

function gradersFor(row: DeliberationRow): string {
  const names = new Set<string>();
  (row.scores || []).forEach((s) => {
    if (s.interviewer_name) names.add(s.interviewer_name);
    if (s.co_interviewer_name) names.add(s.co_interviewer_name);
  });
  return Array.from(names).join(', ') || '—';
}

function recommendationsFor(row: DeliberationRow): string[] {
  return (row.scores || []).map((s) => s.recommendation).filter((r): r is string => !!r);
}

function commentsFor(row: DeliberationRow): string {
  return (row.scores || []).map((s) => s.overall_impression).filter(Boolean).join(' | ');
}

function scoreValueFor(row: DeliberationRow, round: Round): number | null {
  return round === 'RESUME' ? row.combined_score ?? null : row.avg_score ?? null;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

// Nulls always sink to the bottom regardless of direction, so unscored
// candidates don't scatter to the top on an ascending sort.
function compareValues(a: SortValue, b: SortValue, dir: 'asc' | 'desc', tieA: number, tieB: number): number {
  if (a === null && b === null) return tieA - tieB;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'string' || typeof b === 'string') {
    const cmp = String(a).localeCompare(String(b), undefined, { numeric: true });
    return dir === 'asc' ? cmp : -cmp;
  }
  const cmp = (a as number) - (b as number);
  return dir === 'asc' ? cmp : -cmp;
}

function sortRowsByValue(rows: DeliberationRow[], getValue: (r: DeliberationRow) => SortValue, dir: 'asc' | 'desc'): DeliberationRow[] {
  const indexed = rows.map((r, i) => ({ r, i, val: getValue(r) }));
  indexed.sort((a, b) => compareValues(a.val, b.val, dir, a.i, b.i));
  return indexed.map(({ r }, i) => ({ ...r, sort_order: i }));
}

// Truncated cell that expands into a popover on click so long grader lists /
// comments can be read in full during deliberation without leaving the row.
function ExpandableText({ label, value }: { label: string; value: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground truncate text-left w-full hover:text-foreground hover:underline decoration-dotted underline-offset-2"
          title={value}
        >
          {value || '—'}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-h-80 overflow-y-auto" align="start">
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">{label}</p>
        <p className="text-sm whitespace-pre-wrap">{value || '—'}</p>
      </PopoverContent>
    </Popover>
  );
}

// Same click-to-expand pattern as ExpandableText, but keeps each grader's
// comment attributed to them instead of flattening everyone into one
// '|'-joined string -- easier to tell who said what during deliberation.
function CommentsCell({ scores }: { scores: ScoreDetail[] }) {
  const withComments = (scores || []).filter((s) => s.overall_impression);
  const preview = withComments.map((s) => s.overall_impression).join(' | ');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground truncate text-left w-full hover:text-foreground hover:underline decoration-dotted underline-offset-2"
          title={preview}
        >
          {preview || '—'}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-h-80 overflow-y-auto" align="start">
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">Comments</p>
        {withComments.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <div className="space-y-2.5">
            {withComments.map((s, i) => (
              <div key={i}>
                <p className="text-xs font-medium">
                  {[s.interviewer_name, s.co_interviewer_name].filter(Boolean).join(', ')}
                  {s.room_label ? ` — ${s.room_label}` : ''}
                </p>
                <p className="text-sm whitespace-pre-wrap">{s.overall_impression}</p>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SortableRow({
  row, round, sectionKeys, position, selected, onToggleSelect, expanded, onToggleExpand,
  onViewResume, onNotesChange, onNotesSave, dimmed,
}: {
  row: DeliberationRow;
  round: Round;
  sectionKeys: string[];
  position: number;
  selected: boolean;
  onToggleSelect: (id: string, shiftKey?: boolean) => void;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onViewResume: (resumeId: string) => void;
  onNotesChange: (id: string, notes: string) => void;
  onNotesSave: (id: string, notes: string) => void;
  dimmed?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.round_candidate_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const hex = colorHex(row.color);
  const categories = categoriesFor(row, round, sectionKeys);
  const total = totalFor(row, round);
  const isResume = round === 'RESUME';

  const notesInput = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full text-left text-xs px-1 py-0.5 truncate rounded hover:bg-muted/50"
          title={row.notes || ''}
        >
          {row.notes ? row.notes : <span className="text-muted-foreground">Add a note…</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">Note</p>
        <Textarea
          autoFocus
          value={row.notes ?? ''}
          onChange={(e) => onNotesChange(row.round_candidate_id, e.target.value)}
          onBlur={(e) => onNotesSave(row.round_candidate_id, e.target.value)}
          placeholder="Add a note…"
          rows={4}
          className="text-sm"
        />
      </PopoverContent>
    </Popover>
  );

  if (isResume) {
    return (
      <tr ref={setNodeRef} style={{ ...style, backgroundColor: hex ? `${hex}14` : undefined }} className={`border-b border-border text-xs align-middle ${dimmed ? 'opacity-50' : ''}`}>
        <td className="px-2 py-1 text-center tabular-nums select-none text-muted-foreground" style={{ borderLeft: hex ? `6px solid ${hex}` : '6px solid transparent' }} title="Position in current order">
          {position}
        </td>
        <td className="px-1 py-1">
          <button type="button" className="cursor-grab active:cursor-grabbing text-muted-foreground touch-none" {...attributes} {...listeners} aria-label="Drag to reorder">
            <GripVertical className="w-3.5 h-3.5" />
          </button>
        </td>
        <td
          className="px-1 py-1"
          onClickCapture={(e) => {
            if (e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect(row.round_candidate_id, true);
            }
          }}
        >
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(row.round_candidate_id)} aria-label={`Select ${fullName(row)}`} />
        </td>
        <td className="px-2 py-1 tabular-nums text-muted-foreground whitespace-nowrap">{row.candidate_number ? `#${row.candidate_number}` : '—'}</td>
        <td className="px-2 py-1 font-medium max-w-[220px] truncate" title={fullName(row)}>{fullName(row)}</td>
        <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{row.year?.slice(0, 4)}</td>
        <td className="px-2 py-1 text-muted-foreground max-w-[160px] truncate" title={row.major || ''}>{row.major || '—'}</td>
        <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{row.gender || '—'}</td>
        {categories.map((c) => (
          <td key={c.key} className="px-2 py-1 text-right tabular-nums" title={c.title}>
            {c.value !== null ? c.value.toFixed(1) : '—'}
          </td>
        ))}
        <td className="px-2 py-1 text-right font-semibold tabular-nums">
          {total.value !== null ? total.value.toFixed(1) : '—'}
        </td>
        <td className="px-2 py-1 max-w-[220px]">{notesInput}</td>
        <td className="px-2 py-1">
          <span className="flex items-center gap-1">
            {row.video_question_2_choice && (
              <Badge
                variant="outline"
                className="text-[10px] px-1 shrink-0"
                title={`Q2 (${row.video_question_2_choice}): ${VIDEO_Q2_PROMPT[row.video_question_2_choice] || 'Unknown option'}`}
              >
                Q2:{row.video_question_2_choice}
              </Badge>
            )}
            {row.video_youtube_url && (
              <button type="button" onClick={() => window.open(row.video_youtube_url!, '_blank')} title="Watch video">
                <Video className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
            {row.resume_id && (
              <button type="button" onClick={() => onViewResume(row.resume_id!)} title="View resume">
                <FileText className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </span>
        </td>
      </tr>
    );
  }

  const graders = gradersFor(row);
  const recommendations = recommendationsFor(row);
  const colCount = 18 + sectionKeys.length;

  return (
    <>
      <tr ref={setNodeRef} style={{ ...style, backgroundColor: hex ? `${hex}14` : undefined }} className={`border-b border-border text-xs align-middle ${dimmed ? 'opacity-50' : ''}`}>
        <td className="px-2 py-1 text-center tabular-nums select-none text-muted-foreground" style={{ borderLeft: hex ? `6px solid ${hex}` : '6px solid transparent' }} title="Position in current order">
          {position}
        </td>
        <td className="px-1 py-1">
          <button type="button" className="cursor-grab active:cursor-grabbing text-muted-foreground touch-none" {...attributes} {...listeners} aria-label="Drag to reorder">
            <GripVertical className="w-3.5 h-3.5" />
          </button>
        </td>
        <td
          className="px-1 py-1"
          onClickCapture={(e) => {
            if (e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect(row.round_candidate_id, true);
            }
          }}
        >
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(row.round_candidate_id)} aria-label={`Select ${fullName(row)}`} />
        </td>
        <td className="px-2 py-1 tabular-nums text-muted-foreground whitespace-nowrap">{row.candidate_number ? `#${row.candidate_number}` : '—'}</td>
        <td className="px-2 py-1 font-medium max-w-[220px] truncate" title={fullName(row)}>{fullName(row)}</td>
        <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{row.year?.slice(0, 4)}</td>
        <td className="px-2 py-1 text-muted-foreground max-w-[140px] truncate" title={row.major || ''}>{row.major || '—'}</td>
        <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{row.gender || '—'}</td>
        <td className="px-2 py-1 whitespace-nowrap">
          <span className="flex flex-nowrap gap-0.5">
            {recommendations.length > 0 ? recommendations.map((r, i) => (
              <Badge key={i} variant="outline" className={`text-[10px] px-1 shrink-0 ${RECOMMENDATION_STYLE[r] || ''}`}>
                {r.replace('juniors_', 'Jr ')}
              </Badge>
            )) : '—'}
          </span>
        </td>
        {categories.map((c) => (
          <td key={c.key} className="px-2 py-1 text-right tabular-nums" title={c.label}>
            {c.value !== null ? c.value.toFixed(1) : '—'}
          </td>
        ))}
        <td className="px-2 py-1 text-right font-semibold tabular-nums">
          {total.value !== null ? total.value.toFixed(1) : '—'}
        </td>
        <td className="px-2 py-1 max-w-[180px]"><ExpandableText label="Graders" value={graders} /></td>
        <td className="px-2 py-1 max-w-[220px]"><CommentsCell scores={row.scores || []} /></td>
        <td className="px-2 py-1 max-w-[220px]">{notesInput}</td>
        <td className="px-2 py-1">
          <span className="flex gap-1">
            {row.video_youtube_url && (
              <button type="button" onClick={() => window.open(row.video_youtube_url!, '_blank')} title="Watch video">
                <Video className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
            {row.resume_id && (
              <button type="button" onClick={() => onViewResume(row.resume_id!)} title="View resume">
                <FileText className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </span>
        </td>
        <td className="px-2 py-1 text-muted-foreground tabular-nums text-right">{row.application_ranking ?? '—'}</td>
        <td className="px-2 py-1 text-center">{row.was_in_r1 ? <CheckCircle className="w-3.5 h-3.5 text-green-600 mx-auto" /> : '—'}</td>
        <td className="px-2 py-1 text-center">{row.was_in_r2 ? <CheckCircle className="w-3.5 h-3.5 text-green-600 mx-auto" /> : '—'}</td>
        <td className="px-1 py-1">
          <Button
            type="button" variant="ghost" size="sm" className="h-6 w-6 p-0"
            disabled={!row.scores?.length}
            onClick={() => onToggleExpand(row.round_candidate_id)}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={colCount} className="px-4 pb-3 pt-2">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Per-grader breakdown</p>
              {(row.scores || []).map((s, i) => (
                <div key={i} className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {[s.interviewer_name, s.co_interviewer_name].filter(Boolean).join(', ')}
                      {s.room_label ? ` — ${s.room_label}` : ''}
                    </span>
                    <span className="tabular-nums">{s.total_score.toFixed(1)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {Object.entries(s.section_totals || {}).map(([k, v]) => (
                      <span key={k}>{k}: {v.toFixed(1)}</span>
                    ))}
                    {s.candidate_phone && <span>Phone: {s.candidate_phone}</span>}
                    {Object.entries(s.availability || {}).map(([k, v]) => (
                      <span key={k}>{k}: {v ? 'Yes' : 'No'}</span>
                    ))}
                  </div>
                  {s.glaring_concerns && <p className="text-xs text-amber-700">Concerns: {s.glaring_concerns}</p>}
                  {s.overall_impression && <p className="text-muted-foreground">{s.overall_impression}</p>}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function SortHeader({ label, sortKey, getValue, align, sortState, onSort }: {
  label: string;
  sortKey: string;
  getValue: (r: DeliberationRow) => SortValue;
  align?: 'right' | 'center';
  sortState: { key: string; dir: 'asc' | 'desc' } | null;
  onSort: (key: string, getValue: (r: DeliberationRow) => SortValue) => void;
}) {
  const isActive = sortState?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey, getValue)}
      className={`flex items-center gap-0.5 hover:text-foreground ${align === 'right' ? 'justify-end w-full' : ''}`}
    >
      {label}
      {isActive ? (
        sortState!.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      ) : null}
    </button>
  );
}

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}

const ROUND_LABEL: Record<Round, string> = { RESUME: 'Resume', R1: 'Round 1', R2: 'Round 2' };

export default function DeliberationBoard({ gameId, gameName }: { gameId: string; gameName: string }) {
  const [round, setRound] = useState<Round>('RESUME');
  const [rows, setRows] = useState<DeliberationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [sortState, setSortState] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [advanceCounts, setAdvanceCounts] = useState<Record<Round, number | null>>({ RESUME: null, R1: null, R2: null });
  const [advanceDraft, setAdvanceDraft] = useState('');
  const [outerSigma, setOuterSigma] = useState('2');
  const [innerSigma, setInnerSigma] = useState('1');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fetchRows = useCallback(async () => {
    setIsLoading(true);
    setSelectedIds(new Set());
    try {
      // Check this BEFORE seeding, so "fresh round" means "nobody has ever
      // opened this round's board before" -- not "no new candidates showed
      // up since last time," which would re-trigger the default sort (and
      // wipe out manual reordering) on every subsequent visit.
      const { count: existingCount } = await supabase
        .from('round_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('game_id', gameId)
        .eq('round', round);
      const isFreshRound = !existingCount;

      await supabase.rpc('seed_round_candidates', { p_game_id: gameId, p_round: round });
      const rpcName = round === 'RESUME' ? 'get_resume_deliberation' : 'get_round_deliberation';
      const rpcParams = round === 'RESUME' ? { p_game_id: gameId } : { p_game_id: gameId, p_round: round };
      const { data, error } = await supabase.rpc(rpcName, rpcParams);
      if (error) throw error;
      const result = data as unknown as DeliberationRow[] | { error: string };
      if (!Array.isArray(result)) throw new Error(result.error || 'Failed to load deliberation data');

      if (isFreshRound) {
        // First time this round has ever been opened: sort by score once so
        // there's something useful to look at. After this, order is
        // whatever the committee leaves it in (drag, or an explicit sort
        // click) -- this branch only fires when there was nothing yet to
        // preserve.
        const sorted = sortRowsByValue(result, (r) => scoreValueFor(r, round), 'desc');
        setRows(sorted);
        setSortState({ key: 'score', dir: 'desc' });

        if (sorted.length > 1) {
          supabase.rpc('reorder_round_candidates', {
            p_updates: sorted.map((r) => ({ id: r.round_candidate_id, sort_order: r.sort_order })),
          }).then(({ error: reorderError }) => {
            if (reorderError) console.error('Error persisting default score order:', reorderError);
          });
        }
      } else {
        // Rows already come back ordered by the persisted sort_order (see
        // get_*_deliberation) -- respect whatever order the committee last
        // left it in instead of silently re-ranking on every visit.
        setRows(result);
        setSortState(null);
      }
    } catch (err) {
      console.error('Error loading deliberation data:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to load deliberation data');
    } finally {
      setIsLoading(false);
    }
  }, [gameId, round]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const fetchCutoffs = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_round_cutoffs', { p_game_id: gameId });
      if (error) throw error;
      const result = data as unknown as Record<string, number | null> | { error: string };
      if (result && 'error' in result) throw new Error(result.error);
      setAdvanceCounts({ RESUME: result.RESUME ?? null, R1: result.R1 ?? null, R2: result.R2 ?? null });
    } catch (err) {
      console.error('Error fetching advance cutoffs:', err);
    }
  }, [gameId]);

  useEffect(() => { fetchCutoffs(); }, [fetchCutoffs]);

  // Keep the input in sync with whichever round's tab is active, and with
  // whatever the last confirmed save landed on.
  useEffect(() => {
    setAdvanceDraft(advanceCounts[round] != null ? String(advanceCounts[round]) : '');
  }, [round, advanceCounts]);

  const saveAdvanceCount = async (value: number | null) => {
    const previous = advanceCounts[round];
    if (previous === value) return;
    setAdvanceCounts((prev) => ({ ...prev, [round]: value }));
    try {
      const { error } = await supabase.rpc('set_round_advance_count', {
        p_game_id: gameId, p_round: round, p_count: value,
      });
      if (error) throw error;
      toast.success(value === null ? `Cleared the advance cutoff for ${ROUND_LABEL[round]}` : `Top ${value} will advance from ${ROUND_LABEL[round]}`);
    } catch (err) {
      console.error('Error saving advance cutoff:', err);
      toast.error('Failed to save advance cutoff — refreshing');
      setAdvanceCounts((prev) => ({ ...prev, [round]: previous }));
    }
  };

  const commitAdvanceDraft = () => {
    const trimmed = advanceDraft.trim();
    if (trimmed === '') { saveAdvanceCount(null); return; }
    const parsed = Math.max(0, parseInt(trimmed, 10));
    if (Number.isNaN(parsed)) { setAdvanceDraft(advanceCounts[round] != null ? String(advanceCounts[round]) : ''); return; }
    saveAdvanceCount(parsed);
  };

  const sectionKeys = useMemo(() => (round === 'RESUME' ? [] : sectionKeysFor(rows)), [rows, round]);

  // lastClickedIndex backs shift-click range select (Resume table only, for
  // now): shift-click extends the selection between the last click and this
  // one, Explorer/Sheets-style, instead of toggling just the one row.
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  const toggleSelect = (id: string, shiftKey?: boolean) => {
    const idx = rows.findIndex((r) => r.round_candidate_id === id);
    if (shiftKey && lastClickedIndex !== null && idx !== -1) {
      const [start, end] = idx < lastClickedIndex ? [idx, lastClickedIndex] : [lastClickedIndex, idx];
      const rangeIds = rows.slice(start, end + 1).map((r) => r.round_candidate_id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        rangeIds.forEach((rid) => next.add(rid));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
    if (idx !== -1) setLastClickedIndex(idx);
  };

  const selectAll = () => setSelectedIds(new Set(rows.map((r) => r.round_candidate_id)));
  const clearSelection = () => setSelectedIds(new Set());

  const viewResume = async (resumeId: string) => {
    const { data: resume } = await supabase.from('resumes').select('pdf_path').eq('id', resumeId).maybeSingle();
    if (!resume?.pdf_path) { toast.error('No resume on file'); return; }
    const { data: signed } = await supabase.storage.from('resumes').createSignedUrl(resume.pdf_path, 3600);
    if (signed) setPreviewUrl(signed.signedUrl);
  };

  const applyColor = async (color: string | null) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setRows((prev) => prev.map((r) => (selectedIds.has(r.round_candidate_id) ? { ...r, color } : r)));
    try {
      const { error } = await supabase.rpc('set_round_candidate_color', { p_ids: ids, p_color: color });
      if (error) throw error;
    } catch (err) {
      console.error('Error applying color:', err);
      toast.error('Failed to save color — refreshing');
      fetchRows();
    }
  };

  // Purple ("invite to reapply") is intentionally never auto-assigned here —
  // it's a judgment call about a specific person, not a score threshold.
  // Thresholds are editable (outerSigma/innerSigma, default 2σ/1σ) rather
  // than hardcoded, since what counts as "clearly above the pack" varies by
  // cycle and by how tightly scores are clustered.
  const autoColorByScore = () => {
    const outer = parseFloat(outerSigma);
    const inner = parseFloat(innerSigma);
    if (Number.isNaN(outer) || Number.isNaN(inner) || outer < inner) {
      toast.error('Outer σ must be a number ≥ inner σ');
      return;
    }

    const scored = rows.filter((r) => scoreValueFor(r, round) !== null);
    if (scored.length < 2) {
      toast.info('Need at least a couple of scored candidates to auto-color');
      return;
    }
    const mean = scored.reduce((a, r) => a + (scoreValueFor(r, round) || 0), 0) / scored.length;
    const variance = scored.reduce((a, r) => a + ((scoreValueFor(r, round) || 0) - mean) ** 2, 0) / scored.length;
    const sd = Math.sqrt(variance) || 1;

    const next = rows.map((r) => {
      const val = scoreValueFor(r, round);
      if (val === null) return r;
      const z = (val - mean) / sd;
      let color: string;
      if (z >= outer) color = 'dark-green';
      else if (z >= inner) color = 'green';
      else if (z <= -outer) color = 'dark-red';
      else if (z <= -inner) color = 'red';
      else color = 'yellow';
      return { ...r, color };
    });

    setRows(next);
    (async () => {
      try {
        await Promise.all(
          PALETTE.map((c) => {
            const ids = next.filter((r) => r.color === c.key).map((r) => r.round_candidate_id);
            if (ids.length === 0) return Promise.resolve();
            return supabase.rpc('set_round_candidate_color', { p_ids: ids, p_color: c.key });
          }),
        );
        toast.success('Auto-colored by standard deviation');
      } catch (err) {
        console.error('Error auto-coloring:', err);
        toast.error('Failed to save auto-color — refreshing');
        fetchRows();
      }
    })();
  };

  // Backs every clickable column header. Toggles direction on repeat clicks
  // of the same column.
  const sortRows = async (key: string, getValue: (r: DeliberationRow) => SortValue) => {
    if (rows.length < 2) return;
    const dir: 'asc' | 'desc' = sortState?.key === key && sortState.dir === 'desc' ? 'asc' : 'desc';
    const reordered = sortRowsByValue(rows, getValue, dir);
    setRows(reordered);
    setSortState({ key, dir });

    try {
      const { error } = await supabase.rpc('reorder_round_candidates', {
        p_updates: reordered.map((r) => ({ id: r.round_candidate_id, sort_order: r.sort_order })),
      });
      if (error) throw error;
    } catch (err) {
      console.error('Error sorting:', err);
      toast.error('Failed to save order — refreshing');
      fetchRows();
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rows.findIndex((r) => r.round_candidate_id === active.id);
    const newIndex = rows.findIndex((r) => r.round_candidate_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(rows, oldIndex, newIndex).map((r, i) => ({ ...r, sort_order: i }));
    setRows(reordered);
    setSortState(null);

    try {
      const { error } = await supabase.rpc('reorder_round_candidates', {
        p_updates: reordered.map((r) => ({ id: r.round_candidate_id, sort_order: r.sort_order })),
      });
      if (error) throw error;
    } catch (err) {
      console.error('Error saving order:', err);
      toast.error('Failed to save order — refreshing');
      fetchRows();
    }
  };

  const updateNotesLocal = (id: string, notes: string) => {
    setRows((prev) => prev.map((r) => (r.round_candidate_id === id ? { ...r, notes } : r)));
  };

  const saveNotes = async (id: string, notes: string) => {
    try {
      const { error } = await supabase.rpc('set_round_candidate_notes', { p_id: id, p_notes: notes });
      if (error) throw error;
    } catch (err) {
      console.error('Error saving note:', err);
      toast.error('Failed to save note — refreshing');
      fetchRows();
    }
  };

  const exportToCsv = async () => {
    if (rows.length === 0) { toast.error('No candidates to export'); return; }
    setIsExporting(true);
    try {
      const withLinks = await Promise.all(rows.map(async (r) => {
        let resumeUrl = '';
        if (r.resume_id) {
          const { data: resume } = await supabase.from('resumes').select('pdf_path').eq('id', r.resume_id).maybeSingle();
          if (resume?.pdf_path) {
            const { data: signed } = await supabase.storage.from('resumes').createSignedUrl(resume.pdf_path, 86400);
            resumeUrl = signed?.signedUrl || '';
          }
        }
        return { r, resumeUrl };
      }));

      let headers: string[];
      let csvRows: unknown[][];

      if (round === 'RESUME') {
        headers = ['ID', 'Name', 'Email', 'Year', 'Major', 'Gender', 'Q2 Choice', 'ELO', 'Video Avg', 'Combined', 'Color', 'Notes', 'Video Link', 'Resume Link'];
        csvRows = withLinks.map(({ r, resumeUrl }) => [
          r.candidate_number ?? '', fullName(r), r.applicant_email, r.year, r.major || '', r.gender || '',
          r.video_question_2_choice || '',
          r.elo_rating?.toFixed(1) ?? '', r.video_avg_score?.toFixed(1) ?? '', r.combined_score?.toFixed(1) ?? '',
          colorLabel(r.color), r.notes || '', r.video_youtube_url || '', resumeUrl,
        ]);
      } else {
        headers = ['ID', 'Name', 'Email', 'Year', 'Major', 'Gender', 'Recommendations', ...sectionKeys, 'Avg Total', 'Graders', 'Comments', 'Notes', 'Color', 'App Rank', 'Video Link', 'Resume Link'];
        csvRows = withLinks.map(({ r, resumeUrl }) => {
          const avgs = avgSectionTotals(r);
          return [
            r.candidate_number ?? '', fullName(r), r.applicant_email, r.year, r.major || '', r.gender || '',
            recommendationsFor(r).join('; '),
            ...sectionKeys.map((k) => (avgs[k] !== undefined ? avgs[k].toFixed(1) : '')),
            r.avg_score?.toFixed(1) ?? '', gradersFor(r), commentsFor(r), r.notes || '',
            colorLabel(r.color), r.application_ranking ?? '', r.video_youtube_url || '', resumeUrl,
          ];
        });
      }

      const csvContent = [headers, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Deliberation_${ROUND_LABEL[round].replace(/\s+/g, '_')}_${gameName.replace(/[^a-z0-9]/gi, '_')}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Exported to CSV');
    } catch (err) {
      console.error('Error exporting CSV:', err);
      toast.error('Failed to export CSV');
    } finally {
      setIsExporting(false);
    }
  };

  const rowIds = useMemo(() => rows.map((r) => r.round_candidate_id), [rows]);
  const isResume = round === 'RESUME';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Tabs value={round} onValueChange={(v) => setRound(v as Round)}>
          <TabsList>
            <TabsTrigger value="RESUME">Resume</TabsTrigger>
            <TabsTrigger value="R1">Round 1</TabsTrigger>
            <TabsTrigger value="R2">Round 2</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Outer</span>
            <Input
              type="number" step={0.25} value={outerSigma}
              onChange={(e) => setOuterSigma(e.target.value)}
              className="h-8 w-14 text-xs" title="Outer σ — dark-green/dark-red cutoff"
            />
            <span>σ / Inner</span>
            <Input
              type="number" step={0.25} value={innerSigma}
              onChange={(e) => setInnerSigma(e.target.value)}
              className="h-8 w-14 text-xs" title="Inner σ — green/red cutoff"
            />
            <span>σ</span>
          </div>
          <Button variant="outline" size="sm" onClick={autoColorByScore}>
            <Sparkles className="w-4 h-4 mr-2" />
            Auto-color by std. dev.
          </Button>
          <Button variant="outline" size="sm" onClick={exportToCsv} disabled={isExporting || rows.length === 0}>
            {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Export CSV
          </Button>
        </div>
      </div>

      <Card className="glass-panel">
        <CardHeader>
          <CardTitle>Deliberation — {ROUND_LABEL[round]}</CardTitle>
          <CardDescription>
            Sorted by score by default — drag to reorder or click a column header to re-sort, select multiple candidates and assign a color, click Notes to type inline. The top N set below advance to the next round. {gameName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="sticky top-16 z-30 -mx-6 px-6 py-3 mb-4 bg-card/95 backdrop-blur-sm border-b border-border flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label htmlFor="advance-count" className="text-sm text-muted-foreground whitespace-nowrap">Advance top</label>
              <Input
                id="advance-count"
                type="number"
                min={0}
                max={rows.length}
                value={advanceDraft}
                onChange={(e) => setAdvanceDraft(e.target.value)}
                onBlur={commitAdvanceDraft}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                placeholder="—"
                className="h-8 w-16 text-sm"
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">of {rows.length}</span>
            </div>
            <div className="h-5 w-px bg-border" />
            <span className="text-sm font-medium">{rows.length} candidate{rows.length === 1 ? '' : 's'}</span>
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <Button variant="ghost" size="sm" onClick={selectAll}>Select all</Button>
            <Button variant="ghost" size="sm" onClick={clearSelection} disabled={selectedIds.size === 0}>Clear</Button>
            <div className="h-5 w-px bg-border" />
            {PALETTE.map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.label}
                onClick={() => applyColor(c.key)}
                disabled={selectedIds.size === 0}
                className="w-6 h-6 rounded-full border border-border disabled:opacity-30 disabled:cursor-not-allowed hover:scale-110 transition-transform"
                style={{ backgroundColor: c.hex }}
              />
            ))}
            <button
              type="button"
              title="Clear color"
              onClick={() => applyColor(null)}
              disabled={selectedIds.size === 0}
              className="w-6 h-6 rounded-full border border-border disabled:opacity-30 disabled:cursor-not-allowed hover:scale-110 transition-transform flex items-center justify-center"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No candidates for this round yet.</div>
          ) : isResume ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-xs font-medium text-muted-foreground border-b border-border">
                    <th className="px-2 pb-1.5 font-medium text-center" title="Position in current order">#</th>
                    <th className="px-1 pb-1.5" />
                    <th className="px-1 pb-1.5" />
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="ID" sortKey="id" getValue={(r) => r.candidate_number ?? null} sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Name" sortKey="name" getValue={(r) => fullName(r)} sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Year" sortKey="year" getValue={(r) => r.year} sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Major" sortKey="major" getValue={(r) => r.major} sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium">Gender</th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="ELO" sortKey="elo" getValue={(r) => r.elo_rating ?? null} align="right" sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Video Avg" sortKey="video" getValue={(r) => r.video_avg_score ?? null} align="right" sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Combined" sortKey="score" getValue={(r) => scoreValueFor(r, round)} align="right" sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium">Notes</th>
                    <th className="px-2 pb-1.5 font-medium">Links</th>
                  </tr>
                </thead>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                    <tbody>
                      {(() => {
                        const cutoff = advanceCounts[round];
                        return rows.map((row, index) => (
                          <Fragment key={row.round_candidate_id}>
                            {cutoff !== null && cutoff > 0 && cutoff < rows.length && index === cutoff && (
                              <tr>
                                <td colSpan={13} className="py-1 text-[11px] font-medium text-muted-foreground select-none text-center border-t border-dashed border-border">
                                  top {cutoff} advance
                                </td>
                              </tr>
                            )}
                            <SortableRow
                              row={row}
                              round={round}
                              sectionKeys={sectionKeys}
                              position={index + 1}
                              selected={selectedIds.has(row.round_candidate_id)}
                              onToggleSelect={toggleSelect}
                              expanded={expandedId === row.round_candidate_id}
                              onToggleExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
                              onViewResume={viewResume}
                              onNotesChange={updateNotesLocal}
                              onNotesSave={saveNotes}
                              dimmed={cutoff !== null && index >= cutoff}
                            />
                          </Fragment>
                        ));
                      })()}
                    </tbody>
                  </SortableContext>
                </DndContext>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-xs font-medium text-muted-foreground border-b border-border">
                    <th className="px-2 pb-1.5 font-medium text-center" title="Position in current order">#</th>
                    <th className="px-1 pb-1.5" />
                    <th className="px-1 pb-1.5" />
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="ID" sortKey="id" getValue={(r) => r.candidate_number ?? null} sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Name" sortKey="name" getValue={(r) => fullName(r)} sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Year" sortKey="year" getValue={(r) => r.year} sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Major" sortKey="major" getValue={(r) => r.major} sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium">Gender</th>
                    <th className="px-2 pb-1.5 font-medium">Rec.</th>
                    {sectionKeys.map((k) => (
                      <th key={k} className="px-2 pb-1.5 font-medium"><SortHeader label={k} sortKey={`sec:${k}`} getValue={(r) => avgSectionTotals(r)[k] ?? null} align="right" sortState={sortState} onSort={sortRows} /></th>
                    ))}
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Avg Total" sortKey="score" getValue={(r) => scoreValueFor(r, round)} align="right" sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium">Graders</th>
                    <th className="px-2 pb-1.5 font-medium">Comments</th>
                    <th className="px-2 pb-1.5 font-medium">Notes</th>
                    <th className="px-2 pb-1.5 font-medium">Links</th>
                    <th className="px-2 pb-1.5 font-medium"><SortHeader label="Rank" sortKey="rank" getValue={(r) => r.application_ranking ?? null} align="right" sortState={sortState} onSort={sortRows} /></th>
                    <th className="px-2 pb-1.5 font-medium text-center">R1</th>
                    <th className="px-2 pb-1.5 font-medium text-center">R2</th>
                    <th className="px-1 pb-1.5" />
                  </tr>
                </thead>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                    <tbody>
                      {(() => {
                        const cutoff = advanceCounts[round];
                        const colCount = 18 + sectionKeys.length;
                        return rows.map((row, index) => (
                          <Fragment key={row.round_candidate_id}>
                            {cutoff !== null && cutoff > 0 && cutoff < rows.length && index === cutoff && (
                              <tr>
                                <td colSpan={colCount} className="py-1 text-[11px] font-medium text-muted-foreground select-none text-center border-t border-dashed border-border">
                                  top {cutoff} advance
                                </td>
                              </tr>
                            )}
                            <SortableRow
                              row={row}
                              round={round}
                              sectionKeys={sectionKeys}
                              position={index + 1}
                              selected={selectedIds.has(row.round_candidate_id)}
                              onToggleSelect={toggleSelect}
                              expanded={expandedId === row.round_candidate_id}
                              onToggleExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
                              onViewResume={viewResume}
                              onNotesChange={updateNotesLocal}
                              onNotesSave={saveNotes}
                              dimmed={cutoff !== null && index >= cutoff}
                            />
                          </Fragment>
                        ));
                      })()}
                    </tbody>
                  </SortableContext>
                </DndContext>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setPreviewUrl(null)}>
          <div className="bg-background rounded-lg w-full max-w-3xl h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <iframe src={`${previewUrl}#toolbar=0&navpanes=0`} className="w-full h-full" title="Resume preview" />
          </div>
        </div>
      )}
    </div>
  );
}
