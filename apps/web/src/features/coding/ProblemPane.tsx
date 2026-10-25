import type { CandidateProblemDto, SubmissionDto } from '@hws/shared';
import { Badge, StatusBadge } from '@/components/ui';
import { Markdown } from '@/components/markdown';
import { cn } from '@/lib/utils';

export function bestFor(problemId: string, submissions: SubmissionDto[]): SubmissionDto | null {
  let best: SubmissionDto | null = null;
  for (const s of submissions) {
    if (s.problemId !== problemId || s.kind !== 'submit') continue;
    if (!best || (s.score ?? -1) > (best.score ?? -1) || (s.status !== 'graded' && !best)) best = s;
  }
  return best;
}

export function ProblemTabs({ problems, activeId, onSelect, submissions }: { problems: CandidateProblemDto[]; activeId: string; onSelect: (id: string) => void; submissions: SubmissionDto[] }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b px-2 pt-2 scrollbar-thin" role="tablist" aria-label="Problems">
      {problems.map((p, i) => {
        const best = bestFor(p.id, submissions);
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(p.id)}
            className={cn('flex shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-sm cursor-pointer', active ? 'bg-surface font-medium' : 'bg-surface-2 text-muted hover:text-fg')}
          >
            <span>
              {i + 1}. {p.title}
            </span>
            {best ? (
              best.status === 'graded' ? (
                <Badge variant={best.score === 100 ? 'success' : (best.score ?? 0) > 0 ? 'warning' : 'danger'}>{best.passed}/{best.total}</Badge>
              ) : (
                <StatusBadge status={best.status} />
              )
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ProblemStatement({ problem }: { problem: CandidateProblemDto }) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{problem.title}</h2>
        <StatusBadge status={problem.difficulty} label={problem.difficulty} />
        {problem.tags.map((t) => (
          <Badge key={t} variant="muted">
            {t}
          </Badge>
        ))}
      </div>
      <div className="text-xs text-muted">
        Time limit {problem.timeLimitMs / 1000}s · Memory {problem.memoryLimitMb} MB · {problem.testCaseCount} test cases ({problem.sampleCount} shown)
      </div>
      <Markdown>{problem.statement}</Markdown>
      {problem.sampleCases.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Sample cases</h3>
          {problem.sampleCases.map((c, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-muted">{c.label ?? `Sample ${i + 1}`} · input</div>
                <pre className="overflow-auto rounded border bg-surface-2 p-2 font-mono text-xs">{c.input || '(empty)'}</pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted">expected output</div>
                <pre className="overflow-auto rounded border bg-surface-2 p-2 font-mono text-xs">{c.expectedOutput || '(empty)'}</pre>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted">Read input from standard input and write the answer to standard output. Output is compared ignoring trailing whitespace.</p>
    </div>
  );
}
