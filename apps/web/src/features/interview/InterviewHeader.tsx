import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Clock, WifiOff } from 'lucide-react';
import type { InterviewDto } from '@hws/shared';
import { Button, Dialog, DialogContent, DialogFooter } from '@/components/ui';
import { ThemeToggle } from '@/app/layouts';
import { useCountdown } from '@/lib/hooks';
import { cn, fmtDuration } from '@/lib/utils';

interface Props {
  interview: InterviewDto;
  /** Overrides the active section's deadline (e.g. from the coding state). */
  deadline?: string | null;
  onTimeUp?: () => void;
  onEndSection: () => Promise<void> | void;
  ending?: boolean;
}

export function InterviewHeader({ interview, deadline, onTimeUp, onEndSection, ending }: Props) {
  const idx = interview.currentSection ?? 0;
  const section = interview.sections[idx];
  const total = interview.sections.length;
  const isLast = idx >= total - 1;
  const remaining = useCountdown(deadline ?? section?.deadline ?? null, interview.serverTime);
  const [compact, setCompact] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [fired, setFired] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (remaining === 0 && !fired) {
      setFired(true);
      onTimeUp?.();
    }
  }, [remaining, fired, onTimeUp]);

  const urgent = remaining !== null && remaining <= 120;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-surface px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden font-semibold tracking-tight sm:inline">
          HireWith<span className="text-accent">Sense</span>
        </span>
        <span className="hidden h-5 w-px bg-border sm:block" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{interview.jobTitle}</div>
          <div className="truncate text-xs text-muted">
            Section {idx + 1} of {total} · {section?.title ?? ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 sm:gap-2">
        {!online ? (
          <span className="flex items-center gap-1 rounded-md bg-danger/10 px-2 py-1 text-xs font-medium text-danger" role="status">
            <WifiOff className="size-3.5" /> Offline
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setCompact((c) => !c)}
          className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-sm tabular-nums transition-colors', urgent ? 'border-danger/40 bg-danger/10 text-danger' : 'bg-surface-2 text-fg')}
          aria-live={urgent ? 'polite' : 'off'}
          aria-label={compact ? 'Show time remaining' : 'Hide time remaining'}
          title={compact ? 'Show timer' : 'Collapse timer'}
        >
          <Clock className="size-4" />
          {compact ? <span className="sr-only">{remaining === null ? '' : fmtDuration(remaining)}</span> : <span>{remaining === null ? '--:--' : fmtDuration(remaining)}</span>}
          {compact ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronUp className="size-3.5 text-muted" />}
        </button>
        <ThemeToggle />
        <Button variant="outline" size="sm" onClick={() => setConfirm(true)} disabled={ending}>
          {isLast ? 'Finish interview' : 'End section'}
        </Button>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          title={isLast ? 'Finish the interview?' : 'End this section?'}
          description={isLast ? 'You will not be able to return. Unanswered questions and unsubmitted code will not be assessed.' : 'You will move on to the next section and cannot come back to this one.'}
        >
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Stay
            </Button>
            <Button
              variant="danger"
              loading={ending}
              onClick={async () => {
                await onEndSection();
                setConfirm(false);
              }}
            >
              {isLast ? 'Finish interview' : 'End section'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

/** Where to go after a section transition. */
export function routeAfterSection(interview: InterviewDto): string {
  const id = interview.id;
  if (interview.status !== 'in_progress' || interview.currentSection === null) return `/app/interviews/${id}/done`;
  const next = interview.plan.sections[interview.currentSection];
  return next?.type === 'coding' ? `/app/interviews/${id}/coding` : `/app/interviews/${id}/room`;
}
