import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Badge, Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { InterviewPlan } from '@hws/shared';

export function planSummary(plan: InterviewPlan | undefined | null): string {
  if (!plan?.sections?.length) return 'No sections';
  return plan.sections.map((s) => `${s.title || (s.type === 'coding' ? 'Coding' : 'Conversation')} ${s.durationMinutes}m`).join(' · ');
}

export function planMinutes(plan: InterviewPlan | undefined | null): number {
  return plan?.sections?.reduce((s, x) => s + x.durationMinutes, 0) ?? 0;
}

/** Simple tag input: Enter or comma adds, backspace on empty removes last. */
export function TagInput({ value, onChange, placeholder, id, max = 50 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string; max?: number }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p);
    onChange(next);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-surface px-2 py-1.5 focus-within:ring-2 focus-within:ring-accent">
      {value.map((t) => (
        <Badge key={t} variant="default" className="gap-1 pr-1">
          {t}
          <button type="button" className="rounded-full p-0.5 hover:bg-border" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => draft && add(draft)}
        placeholder={value.length ? '' : placeholder}
        className="h-6 min-w-[8rem] flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children?: React.ReactNode; className?: string }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100',
    warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
    danger: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-md border px-3 py-2 text-sm', styles, className)}>
      {title ? <div className="font-medium">{title}</div> : null}
      {children ? <div className={title ? 'mt-0.5' : ''}>{children}</div> : null}
    </div>
  );
}

export function ScoreText({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score === null || score === undefined) return <span className={cn('text-muted', className)}>—</span>;
  const tone = score >= 75 ? 'text-success' : score >= 55 ? 'text-warning' : 'text-danger';
  return <span className={cn('font-semibold tabular-nums', tone, className)}>{Math.round(score)}</span>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <button className="rounded-md border px-3 py-1 hover:bg-surface-2 disabled:opacity-50" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="rounded-md border px-3 py-1 hover:bg-surface-2 disabled:opacity-50" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function useConfirm() {
  return (message: string) => window.confirm(message);
}
