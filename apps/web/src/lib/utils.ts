import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function fmtDate(iso: string | null | undefined, pattern = 'd MMM yyyy, HH:mm'): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return isValid(d) ? format(d, pattern) : '—';
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return isValid(d) ? formatDistanceToNow(d, { addSuffix: true }) : '—';
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function scoreTone(score: number | null | undefined): 'success' | 'warning' | 'danger' | 'muted' {
  if (score === null || score === undefined) return 'muted';
  if (score >= 75) return 'success';
  if (score >= 55) return 'warning';
  return 'danger';
}

export const STATUS_LABEL: Record<string, string> = {
  invited: 'Invited',
  ready: 'Ready to start',
  in_progress: 'In progress',
  submitted: 'Submitted',
  completed: 'Completed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  archived: 'Archived',
  pending: 'Pending',
  accepted: 'Accepted',
};

export const RECOMMENDATION_LABEL: Record<string, string> = {
  strong_hire: 'Strong match',
  hire: 'Match',
  borderline: 'Borderline',
  no_hire: 'Below bar',
  insufficient_evidence: 'Insufficient evidence',
};

export const DECISION_LABEL: Record<string, string> = { advance: 'Advance', hold: 'On hold', reject: 'Rejected', hire: 'Hire' };
