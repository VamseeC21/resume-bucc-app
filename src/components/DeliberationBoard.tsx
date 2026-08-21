import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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

const RESUME_ROW_TEMPLATE = '32px 24px 24px 60px minmax(160px,1fr) 60px minmax(90px,1fr) 60px 90px 90px 90px minmax(140px,1fr) 90px';

function interviewRowTemplate(sectionCount: number): string {
  return `32px 24px 24px 60px minmax(140px,1fr) 60px 70px 60px 90px repeat(${sectionCount}, 70px) 70px 140px minmax(140px,1fr) minmax(140px,1fr) 60px 70px 50px 50px 32px`;
}

function SortableRow({
  row, round, sectionKeys, gridTemplate, position, selected, onToggleSelect, expanded, onToggleExpand,
  onViewResume, onNotesChange, onNotesSave,
}: {
  row: DeliberationRow;
  round: Round;
  sectionKeys: string[];
  gridTemplate: string;
  position: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onViewResume: (resumeId: string) => void;
  onNotesChange: (id: string, notes: string) => void;
  onNotesSave: (id: string, notes: string) => void;
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
    <input
      type="text"
      value={row.notes ?? ''}
      onChange={(e) => onNotesChange(row.round_candidate_id, e.target.value)}
      onBlur={(e) => onNotesSave(row.round_candidate_id, e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="Add a note…"
      title={row.notes || ''}
      className="w-full bg-transparent border-0 border-b border-dashed border-transparent hover:border-border focus:border-primary focus:outline-none text-xs px-1 py-0.5 truncate"
    />
  );

  if (isResume) {
    return (
      <div ref={setNodeRef} style={style} className="rounded-lg border border-border overflow-hidden bg-card">
        <div
          className="grid items-center gap-2 px-2 py-2 text-sm overflow-x-auto"
          style={{
            gridTemplateColumns: gridTemplate,
            ...(hex ? { borderLeft: `6px solid ${hex}`, backgroundColor: `${hex}14` } : { borderLeft: '6px solid transparent' }),
          }}
        >
          <span className="text-xs text-muted-foreground text-center tabular-nums select-none" title="Position in current order">{position}</span>
          <button type="button" className="cursor-grab active:cursor-grabbing text-muted-foreground touch-none" {...attributes} {...listeners} aria-label="Drag to reorder">
            <GripVertical className="w-4 h-4" />
          </button>
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(row.round_candidate_id)} aria-label={`Select ${fullName(row)}`} />
          <span className="text-xs text-muted-foreground tabular-nums">{row.candidate_number ? `#${row.candidate_number}` : '—'}</span>
          <span className="font-medium truncate" title={fullName(row)}>{fullName(row)}</span>
          <span className="text-xs text-muted-foreground">{row.year?.slice(0, 4)}</span>
          <span className="text-xs text-muted-foreground truncate" title={row.major || ''}>{row.major || '—'}</span>
          <span className="text-xs text-muted-foreground">{row.gender || '—'}</span>
          {categories.map((c) => (
            <span key={c.key} className="text-xs text-right tabular-nums" title={c.title}>
              {c.value !== null ? c.value.toFixed(1) : '—'}
            </span>
          ))}
          <span className="text-right font-semibold tabular-nums">
            {total.value !== null ? total.value.toFixed(1) : '—'}
          </span>
          {notesInput}
          <span className="flex items-center gap-1">
            {row.video_question_2_choice && (
              <Badge
                variant="outline"
                className="text-[10px] px-1 shrink-0"
                title={`Answered Question 2, option ${row.video_question_2_choice}`}
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
        </div>
      </div>
    );
  }

  const graders = gradersFor(row);
  const recommendations = recommendationsFor(row);
  const comments = commentsFor(row);

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-border overflow-hidden bg-card">
      <Collapsible open={expanded} onOpenChange={() => onToggleExpand(row.round_candidate_id)}>
        <div
          className="grid items-center gap-2 px-2 py-2 text-sm overflow-x-auto"
          style={{
            gridTemplateColumns: gridTemplate,
            ...(hex ? { borderLeft: `6px solid ${hex}`, backgroundColor: `${hex}14` } : { borderLeft: '6px solid transparent' }),
          }}
        >
          <span className="text-xs text-muted-foreground text-center tabular-nums select-none" title="Position in current order">{position}</span>
          <button type="button" className="cursor-grab active:cursor-grabbing text-muted-foreground touch-none" {...attributes} {...listeners} aria-label="Drag to reorder">
            <GripVertical className="w-4 h-4" />
          </button>
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(row.round_candidate_id)} aria-label={`Select ${fullName(row)}`} />
          <span className="text-xs text-muted-foreground tabular-nums">{row.candidate_number ? `#${row.candidate_number}` : '—'}</span>
          <span className="font-medium truncate" title={fullName(row)}>{fullName(row)}</span>
          <span className="text-xs text-muted-foreground">{row.year?.slice(0, 4)}</span>
          <span className="text-xs text-muted-foreground truncate" title={row.major || ''}>{row.major || '—'}</span>
          <span className="text-xs text-muted-foreground">{row.gender || '—'}</span>
          <span className="flex flex-wrap gap-0.5">
            {recommendations.length > 0 ? recommendations.map((r, i) => (
              <Badge key={i} variant="outline" className={`text-[10px] px-1 ${RECOMMENDATION_STYLE[r] || ''}`}>
                {r.replace('juniors_', 'Jr ')}
              </Badge>
            )) : '—'}
          </span>
          {categories.map((c) => (
            <span key={c.key} className="text-xs text-right tabular-nums" title={c.label}>
              {c.value !== null ? c.value.toFixed(1) : '—'}
            </span>
          ))}
          <span className="text-right font-semibold tabular-nums">
            {total.value !== null ? total.value.toFixed(1) : '—'}
          </span>
          <span className="text-xs text-muted-foreground truncate" title={graders}>{graders}</span>
          <span className="text-xs text-muted-foreground truncate" title={comments}>{comments || '—'}</span>
          {notesInput}
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
          <span className="text-xs text-muted-foreground tabular-nums text-right">{row.application_ranking ?? '—'}</span>
          <span className="text-center">{row.was_in_r1 ? <CheckCircle className="w-3.5 h-3.5 text-green-600 mx-auto" /> : '—'}</span>
          <span className="text-center">{row.was_in_r2 ? <CheckCircle className="w-3.5 h-3.5 text-green-600 mx-auto" /> : '—'}</span>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={!row.scores?.length}>
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="px-4 pb-3 pt-1 space-y-3 border-t bg-muted/20">
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
        </CollapsibleContent>
      </Collapsible>
    </div>
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fetchRows = useCallback(async () => {
    setIsLoading(true);
    setSelectedIds(new Set());
    try {
      await supabase.rpc('seed_round_candidates', { p_game_id: gameId, p_round: round });
      const rpcName = round === 'RESUME' ? 'get_resume_deliberation' : 'get_round_deliberation';
      const rpcParams = round === 'RESUME' ? { p_game_id: gameId } : { p_game_id: gameId, p_round: round };
      const { data, error } = await supabase.rpc(rpcName, rpcParams);
      if (error) throw error;
      const result = data as unknown as DeliberationRow[] | { error: string };
      if (!Array.isArray(result)) throw new Error(result.error || 'Failed to load deliberation data');

      // Always come in sorted by score, highest first, so no manual step is
      // needed to see the ranking that actually matters for deliberation.
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
    } catch (err) {
      console.error('Error loading deliberation data:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to load deliberation data');
    } finally {
      setIsLoading(false);
    }
  }, [gameId, round]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const sectionKeys = useMemo(() => (round === 'RESUME' ? [] : sectionKeysFor(rows)), [rows, round]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
  const autoColorByScore = () => {
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
      if (z >= 2) color = 'dark-green';
      else if (z >= 1) color = 'green';
      else if (z <= -2) color = 'dark-red';
      else if (z <= -1) color = 'red';
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
  const gridTemplate = isResume ? RESUME_ROW_TEMPLATE : interviewRowTemplate(sectionKeys.length);

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
            Sorted by score by default — drag to reorder or click a column header to re-sort, select multiple candidates and assign a color, click Notes to type inline. {gameName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
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
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid gap-2 px-2 pb-2 text-xs font-medium text-muted-foreground min-w-max"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <span className="text-center" title="Position in current order">#</span>
                <span /><span />
                <SortHeader label="ID" sortKey="id" getValue={(r) => r.candidate_number ?? null} sortState={sortState} onSort={sortRows} />
                <SortHeader label="Name" sortKey="name" getValue={(r) => fullName(r)} sortState={sortState} onSort={sortRows} />
                <SortHeader label="Year" sortKey="year" getValue={(r) => r.year} sortState={sortState} onSort={sortRows} />
                <SortHeader label="Major" sortKey="major" getValue={(r) => r.major} sortState={sortState} onSort={sortRows} />
                <span>Gender</span>
                {isResume ? (
                  <>
                    <SortHeader label="ELO" sortKey="elo" getValue={(r) => r.elo_rating ?? null} align="right" sortState={sortState} onSort={sortRows} />
                    <SortHeader label="Video Avg" sortKey="video" getValue={(r) => r.video_avg_score ?? null} align="right" sortState={sortState} onSort={sortRows} />
                    <SortHeader label="Combined" sortKey="score" getValue={(r) => scoreValueFor(r, round)} align="right" sortState={sortState} onSort={sortRows} />
                    <span>Notes</span>
                    <span>Links</span>
                  </>
                ) : (
                  <>
                    <span>Rec.</span>
                    {sectionKeys.map((k) => (
                      <SortHeader key={k} label={k} sortKey={`sec:${k}`} getValue={(r) => avgSectionTotals(r)[k] ?? null} align="right" sortState={sortState} onSort={sortRows} />
                    ))}
                    <SortHeader label="Avg Total" sortKey="score" getValue={(r) => scoreValueFor(r, round)} align="right" sortState={sortState} onSort={sortRows} />
                    <span>Graders</span><span>Comments</span><span>Notes</span><span>Links</span>
                    <SortHeader label="Rank" sortKey="rank" getValue={(r) => r.application_ranking ?? null} align="right" sortState={sortState} onSort={sortRows} />
                    <span className="text-center">R1</span><span className="text-center">R2</span><span />
                  </>
                )}
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2 min-w-max">
                    {rows.map((row, index) => (
                      <SortableRow
                        key={row.round_candidate_id}
                        row={row}
                        round={round}
                        sectionKeys={sectionKeys}
                        gridTemplate={gridTemplate}
                        position={index + 1}
                        selected={selectedIds.has(row.round_candidate_id)}
                        onToggleSelect={toggleSelect}
                        expanded={expandedId === row.round_candidate_id}
                        onToggleExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
                        onViewResume={viewResume}
                        onNotesChange={updateNotesLocal}
                        onNotesSave={saveNotes}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
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
