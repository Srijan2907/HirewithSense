import { useState } from 'react';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import type { CaseResult, SubmissionDto } from '@hws/shared';
import { Badge, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/utils';

const VERDICT_LABEL: Record<string, string> = {
  passed: 'Passed',
  wrong_answer: 'Wrong answer',
  time_limit: 'Time limit',
  memory_limit: 'Memory limit',
  runtime_error: 'Runtime error',
  compile_error: 'Compile error',
  internal_error: 'Internal error',
};

export function ResultsPane({ submission, pending }: { submission: SubmissionDto | null; pending?: boolean }) {
  if (pending) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted" role="status">
        <span className="size-2 animate-pulse-soft rounded-full bg-accent" /> Running your code…
      </div>
    );
  }
  if (!submission) return <p className="p-4 text-sm text-muted">Run the sample cases or submit to see results here.</p>;
  if (submission.status === 'error') {
    return (
      <div className="p-4 text-sm">
        <Badge variant="danger">Could not run</Badge>
        <p className="mt-2 text-muted">{submission.errorMessage ?? 'The code runner returned an error.'}</p>
      </div>
    );
  }
  if (submission.status === 'queued' || submission.status === 'running') {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted" role="status">
        <span className="size-2 animate-pulse-soft rounded-full bg-accent" /> Grading against all test cases…
      </div>
    );
  }
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">
          {submission.kind === 'run' ? 'Sample run' : 'Submission'} · {submission.passed}/{submission.total} passed
        </span>
        {submission.score !== null ? <Badge variant={submission.score >= 100 ? 'success' : submission.score > 0 ? 'warning' : 'danger'}>Score {Math.round(submission.score)}%</Badge> : null}
        {submission.runner ? <span className="text-xs text-muted">runner: {submission.runner}</span> : null}
      </div>
      {submission.compileOutput ? (
        <pre className="mb-3 max-h-48 overflow-auto rounded-md border bg-surface-2 p-3 text-xs text-danger scrollbar-thin">{submission.compileOutput}</pre>
      ) : null}
      <ul className="divide-y rounded-md border">
        {submission.results.map((r) => (
          <CaseRow key={r.index} result={r} />
        ))}
      </ul>
    </div>
  );
}

function CaseRow({ result: r }: { result: CaseResult }) {
  const [open, setOpen] = useState(r.verdict !== 'passed' && r.isSample);
  const expandable = r.isSample && (r.stdout !== null || r.stderr !== null || r.input !== null);
  return (
    <li>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm', expandable ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default')}
        aria-expanded={expandable ? open : undefined}
      >
        {expandable ? open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" /> : <Lock className="size-3.5 text-muted" aria-label="Hidden test case" />}
        <span className="min-w-0 flex-1 truncate">{r.label ?? (r.isSample ? `Sample ${r.index + 1}` : `Hidden case ${r.index + 1}`)}</span>
        {r.timeMs !== null ? <span className="font-mono text-xs text-muted">{r.timeMs} ms</span> : null}
        <StatusBadge status={r.verdict} label={VERDICT_LABEL[r.verdict] ?? r.verdict} />
      </button>
      {open && expandable ? (
        <div className="grid gap-2 border-t bg-surface-2/50 p-3 text-xs sm:grid-cols-3">
          <Block label="Input" value={r.input} />
          <Block label="Expected output" value={r.expectedOutput} />
          <Block label={r.stderr ? 'Your output / stderr' : 'Your output'} value={[r.stdout, r.stderr].filter(Boolean).join('\n') || ''} tone={r.verdict === 'passed' ? 'ok' : 'bad'} />
        </div>
      ) : null}
    </li>
  );
}

function Block({ label, value, tone }: { label: string; value: string | null; tone?: 'ok' | 'bad' }) {
  if (value === null) return null;
  return (
    <div>
      <div className="mb-1 font-medium text-muted">{label}</div>
      <pre className={cn('max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-surface p-2 font-mono scrollbar-thin', tone === 'bad' && 'border-danger/40', tone === 'ok' && 'border-success/40')}>{value || <span className="text-subtle">(empty)</span>}</pre>
    </div>
  );
}
