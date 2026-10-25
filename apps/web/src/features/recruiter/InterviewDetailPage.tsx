import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Mic, RefreshCw, ShieldCheck, Type } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { DECISIONS, DecisionBody, ConsentDto, type AuditLogDto, type CompetencyScore, type DecisionDto, type InterviewDto, type ProctoringEventDto, type ReportDto, type SubmissionDto, type TranscriptEventDto, type TurnDto } from '@hws/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Field, NativeSelect, PageHeader, PageLoader, Progress, ScoreRing, Spinner, StatusBadge, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Textarea, Th, Tooltip, Tr } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { errorMessage, qk } from '@/lib/query';
import { useAuth } from '@/lib/auth-store';
import { useDocumentTitle } from '@/lib/hooks';
import { DECISION_LABEL, RECOMMENDATION_LABEL, STATUS_LABEL, cn, fmtDate, fmtDuration, titleCase } from '@/lib/utils';
import { Alert, planMinutes } from './shared';

interface Detail {
  interview: InterviewDto;
  turns: TurnDto[];
  transcript: TranscriptEventDto[];
  submissions: SubmissionDto[];
  events: ProctoringEventDto[];
  report: ReportDto | null;
  decision: DecisionDto | null;
  consent: z.infer<typeof ConsentDto> | null;
}

const CodeViewer = lazy(() => import('./CodeViewer'));

export default function InterviewDetailPage() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState('report');
  const [focusTurn, setFocusTurn] = useState<string | null>(null);
  const q = useQuery({
    queryKey: qk.detail(id),
    queryFn: () => get<Detail>(`/interviews/${id}/detail`),
    refetchInterval: (query) => {
      const d = query.state.data;
      const st = d?.report?.status ?? d?.interview.reportStatus;
      return d && (st === 'pending' || st === 'generating' || d.interview.status === 'in_progress' || d.interview.status === 'submitted') ? 3000 : false;
    },
  });
  useDocumentTitle(q.data ? `${q.data.interview.candidate.name} · ${q.data.interview.jobTitle}` : 'Interview');
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  if (!d) return <Alert tone="danger">Interview not found.</Alert>;
  const i = d.interview;
  const jumpToTurn = (turnId: string) => {
    setTab('qa');
    setFocusTurn(turnId);
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/recruiter/interviews" className="hover:underline">Interviews</Link>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {i.candidate.name} <StatusBadge status={i.status} label={STATUS_LABEL[i.status]} />
          </span>
        }
        description={
          <span>
            {i.candidate.email} · <Link to={`/recruiter/jobs/${i.jobId}`} className="text-accent hover:underline">{i.jobTitle}</Link> · {planMinutes(i.plan)} min plan
            {i.startedAt ? ` · started ${fmtDate(i.startedAt)}` : ''}
            {i.completedAt ? ` · completed ${fmtDate(i.completedAt)}` : i.submittedAt ? ` · submitted ${fmtDate(i.submittedAt)}` : ''}
          </span>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="report">Report</TabsTrigger>
              <TabsTrigger value="qa">Q&amp;A ({d.turns.length})</TabsTrigger>
              <TabsTrigger value="code">Code ({d.submissions.filter((s) => s.kind === 'submit').length})</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="integrity">Integrity {d.events.length ? <Badge variant="warning" className="ml-1">{d.events.length}</Badge> : null}</TabsTrigger>
              <TabsTrigger value="audit">Consent &amp; audit</TabsTrigger>
            </TabsList>
            <TabsContent value="report"><ReportTab d={d} onJump={jumpToTurn} /></TabsContent>
            <TabsContent value="qa"><QaTab turns={d.turns} focusTurn={focusTurn} /></TabsContent>
            <TabsContent value="code"><CodeTab submissions={d.submissions} /></TabsContent>
            <TabsContent value="transcript"><TranscriptTab events={d.transcript} /></TabsContent>
            <TabsContent value="integrity"><IntegrityTab d={d} /></TabsContent>
            <TabsContent value="audit"><AuditTab d={d} /></TabsContent>
          </Tabs>
        </div>
        <aside className="space-y-4">
          <DecisionCard d={d} />
          <ActionsCard d={d} />
          <SectionsCard i={i} />
        </aside>
      </div>
    </>
  );
}

/* --------------------------------- Report -------------------------------- */

function LevelDots({ level }: { level: number | null }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={level ? `Level ${level} of 5` : 'Not assessed'}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={cn('size-2 rounded-full', level && n <= level ? 'bg-accent' : 'bg-border')} />)}
    </span>
  );
}

function ReportTab({ d, onJump }: { d: Detail; onJump: (turnId: string) => void }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canAdmin = user?.role === 'superadmin' || user?.organization?.role === 'owner' || user?.organization?.role === 'admin';
  const regen = useMutation({
    mutationFn: () => post(`/interviews/${d.interview.id}/report/regenerate`),
    onSuccess: () => {
      toast.success('Report regeneration queued');
      qc.invalidateQueries({ queryKey: qk.detail(d.interview.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
    meta: { silent: true },
  });
  const r = d.report;
  const st = r?.status ?? d.interview.reportStatus;
  if (['invited', 'ready', 'in_progress'].includes(d.interview.status)) {
    return <EmptyState icon={Clock} title={d.interview.status === 'in_progress' ? 'Interview in progress' : 'Interview not started'} description="The report is generated once the candidate finishes." />;
  }
  if (!r || st === 'pending' || st === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border py-16 text-muted">
        <Spinner className="size-6" />
        <div className="text-sm">{st === 'generating' ? 'Generating the report from the evidence…' : 'Report queued…'}</div>
        <div className="text-xs">This page refreshes automatically.</div>
      </div>
    );
  }
  if (st === 'failed') {
    return (
      <Alert tone="danger" title="Report generation failed">
        <p className="mb-2">{r.error ?? 'Unknown error'}</p>
        {canAdmin ? <Button size="sm" variant="outline" onClick={() => regen.mutate()} loading={regen.isPending}><RefreshCw /> Regenerate</Button> : null}
      </Alert>
    );
  }
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center">
          <ScoreRing score={r.weightedScore} size={96} />
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={r.recommendation} label={RECOMMENDATION_LABEL[r.recommendation]} className="text-sm" />
              {r.meetsMinimum !== null ? <Badge variant={r.meetsMinimum ? 'success' : 'danger'}>{r.meetsMinimum ? 'Meets' : 'Below'} minimum {r.minimumScore}</Badge> : null}
              <Tooltip content="Share of rubric weight that had enough evidence to be scored. Unassessed competencies are never imputed."><Badge variant="muted">Coverage {Math.round(r.coverage * 100)}%</Badge></Tooltip>
            </div>
            <p className="text-sm leading-relaxed">{r.summary}</p>
            <p className="text-xs text-muted">
              Generated {fmtDate(r.generatedAt)} by {r.provider}{r.model ? ` (${r.model})` : ''} from {r.evidenceStats.answered}/{r.evidenceStats.turns} answered questions and {r.evidenceStats.submissions} graded submission(s).
              {r.provider === 'mock' ? ' Offline mock provider: scores are structural placeholders.' : ''}
            </p>
          </div>
          {canAdmin ? <Button variant="ghost" size="sm" onClick={() => window.confirm('Regenerate the report? The current one will be replaced.') && regen.mutate()} loading={regen.isPending}><RefreshCw /> Regenerate</Button> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Strengths</CardTitle></CardHeader>
          <CardContent>{r.strengths.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{r.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="text-sm text-muted">None recorded.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Things to probe further</CardTitle></CardHeader>
          <CardContent>{r.considerations.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{r.considerations.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="text-sm text-muted">None recorded.</p>}</CardContent>
        </Card>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold">Competencies</h3>
        <div className="space-y-3">
          {r.competencies.map((c) => <CompetencyCard key={c.key} c={c} onJump={onJump} />)}
        </div>
      </div>
    </div>
  );
}

function CompetencyCard({ c, onJump }: { c: CompetencyScore; onJump: (turnId: string) => void }) {
  const [open, setOpen] = useState(true);
  const tone = c.score === null ? 'muted' : c.score >= 75 ? 'success' : c.score >= 55 ? 'warning' : 'danger';
  return (
    <Card>
      <button type="button" className="flex w-full items-center gap-4 p-4 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.label}</span>
            <Badge variant="muted">weight {c.weight}</Badge>
            {c.deterministic ? <Tooltip content="Computed from test results, not by the model"><Badge variant="brand">deterministic</Badge></Tooltip> : null}
            {c.score === null ? <Badge variant="muted">not assessed</Badge> : null}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Progress value={c.score ?? 0} tone={tone} className="max-w-xs" />
            <LevelDots level={c.level} />
            <span className="text-xs text-muted">confidence {Math.round(c.confidence * 100)}%</span>
          </div>
        </div>
        <span className={cn('text-xl font-semibold tabular-nums', c.score === null ? 'text-muted' : tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger')}>{c.score === null ? '—' : Math.round(c.score)}</span>
        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
      </button>
      {open ? (
        <CardContent className="space-y-3 border-t pt-4">
          <p className="text-sm">{c.rationale}</p>
          {c.evidence.length ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted">Evidence</div>
              {c.evidence.map((ev, i) => (
                <blockquote key={i} className="rounded-md border-l-2 border-accent bg-surface-2/60 px-3 py-2 text-sm">
                  <span className="italic">“{ev.quote}”</span>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge variant="muted">{titleCase(ev.source)}</Badge>
                    {ev.turnId ? <button type="button" className="text-accent hover:underline" onClick={() => onJump(ev.turnId!)}>View answer</button> : null}
                    {ev.note ? <span>{ev.note}</span> : null}
                  </div>
                </blockquote>
              ))}
            </div>
          ) : <p className="text-xs text-muted">No quoted evidence.</p>}
        </CardContent>
      ) : null}
    </Card>
  );
}

/* ---------------------------------- Q&A --------------------------------- */

function QaTab({ turns, focusTurn }: { turns: TurnDto[]; focusTurn: string | null }) {
  useEffect(() => {
    if (focusTurn) document.getElementById(`turn-${focusTurn}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusTurn]);
  if (!turns.length) return <EmptyState title="No questions asked yet" />;
  return (
    <div className="space-y-4">
      {turns.map((t, idx) => (
        <Card key={t.id} id={`turn-${t.id}`} className={cn(focusTurn === t.id && 'ring-2 ring-accent')}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>Q{idx + 1}</span>
              <Badge variant="muted">{t.source.replace('_', ' ')}</Badge>
              {t.competencyKey ? <Badge variant="brand">{titleCase(t.competencyKey)}</Badge> : null}
              <span>{fmtDate(t.askedAt, 'HH:mm:ss')}</span>
            </div>
            <CardTitle className="text-sm leading-relaxed">{t.question}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {t.skipped ? (
              <p className="text-sm italic text-muted">Candidate skipped this question.</p>
            ) : t.answer ? (
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                  {t.inputMode === 'voice' ? <Mic className="size-3" /> : <Type className="size-3" />}
                  {t.inputMode ?? 'text'}{t.answerDurationSeconds ? ` · ${fmtDuration(t.answerDurationSeconds)}` : ''}
                </div>
                <p className="whitespace-pre-wrap text-sm">{t.answer}</p>
              </div>
            ) : (
              <p className="text-sm italic text-muted">No answer recorded.</p>
            )}
            {t.evaluation ? (
              <div className="rounded-md border bg-surface-2/50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold tabular-nums">{t.evaluation.score === null ? '—' : `${t.evaluation.score}/10`}</span>
                  {t.evaluation.confidence !== null ? <span className="text-xs text-muted">confidence {Math.round(t.evaluation.confidence * 100)}%</span> : null}
                </div>
                <p className="mt-1">{t.evaluation.feedback}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {t.evaluation.strengths.length ? <div><div className="text-xs font-medium text-success">Strengths</div><ul className="list-disc pl-4 text-xs">{t.evaluation.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div> : null}
                  {t.evaluation.gaps.length ? <div><div className="text-xs font-medium text-warning">Gaps</div><ul className="list-disc pl-4 text-xs">{t.evaluation.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul></div> : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------------- Code -------------------------------- */

function CodeTab({ submissions }: { submissions: SubmissionDto[] }) {
  const [showRuns, setShowRuns] = useState(false);
  const list = submissions.filter((s) => showRuns || s.kind === 'submit');
  if (!submissions.length) return <EmptyState title="No code submissions" description="This interview had no coding section, or the candidate did not submit." />;
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={showRuns} onChange={(e) => setShowRuns(e.target.checked)} /> Include “run sample” attempts ({submissions.filter((s) => s.kind === 'run').length})
      </label>
      {list.map((s) => <SubmissionCard key={s.id} s={s} />)}
    </div>
  );
}

function SubmissionCard({ s }: { s: SubmissionDto }) {
  const [open, setOpen] = useState(s.kind === 'submit');
  return (
    <Card>
      <button type="button" className="flex w-full flex-wrap items-center gap-3 p-4 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Badge variant={s.kind === 'submit' ? 'brand' : 'muted'}>{s.kind}</Badge>
        <span className="font-mono text-xs text-muted">problem {s.problemId.slice(0, 8)}</span>
        <Badge>{s.languageId}</Badge>
        <StatusBadge status={s.status} />
        <span className="text-sm tabular-nums">{s.passed}/{s.total} passed</span>
        {s.score !== null ? <span className="text-sm font-semibold tabular-nums">{Math.round(s.score)}%</span> : null}
        <span className="ml-auto text-xs text-muted">{fmtDate(s.createdAt)}</span>
        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
      </button>
      {open ? (
        <CardContent className="space-y-4 border-t pt-4">
          {s.errorMessage ? <Alert tone="danger">{s.errorMessage}</Alert> : null}
          {s.compileOutput ? <pre className="max-h-40 overflow-auto rounded-md bg-surface-2 p-3 text-xs">{s.compileOutput}</pre> : null}
          <Suspense fallback={<pre className="max-h-96 overflow-auto rounded-md bg-surface-2 p-3 font-mono text-xs">{s.sourceCode}</pre>}>
            <CodeViewer code={s.sourceCode} languageId={s.languageId} />
          </Suspense>
          {s.results.length ? (
            <Table>
              <thead><tr><Th>#</Th><Th>Case</Th><Th>Verdict</Th><Th className="text-right">Time</Th><Th>Details</Th></tr></thead>
              <tbody>
                {s.results.map((r) => <CaseRow key={r.index} r={r} />)}
              </tbody>
            </Table>
          ) : null}
          <p className="text-xs text-muted">Runner: {s.runner ?? '—'}{s.gradedAt ? ` · graded ${fmtDate(s.gradedAt)}` : ''}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function CaseRow({ r }: { r: SubmissionDto['results'][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tr>
        <Td className="text-muted">{r.index + 1}</Td>
        <Td>{r.label ?? (r.isSample ? 'Sample' : 'Hidden')} {r.isSample ? <Badge variant="muted" className="ml-1">sample</Badge> : null}</Td>
        <Td><StatusBadge status={r.verdict} /></Td>
        <Td className="text-right tabular-nums text-muted">{r.timeMs === null ? '—' : `${r.timeMs} ms`}</Td>
        <Td><button type="button" className="text-xs text-accent hover:underline" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button></Td>
      </Tr>
      {open ? (
        <tr className="border-t bg-surface-2/40">
          <td colSpan={5} className="p-3">
            <div className="grid gap-3 md:grid-cols-3">
              {(['input', 'expectedOutput', 'stdout'] as const).map((k) => (
                <div key={k}>
                  <div className="mb-1 text-xs font-medium text-muted">{k === 'input' ? 'Input' : k === 'expectedOutput' ? 'Expected' : 'Actual'}</div>
                  <pre className="max-h-40 overflow-auto rounded border bg-surface p-2 font-mono text-xs whitespace-pre-wrap">{r[k] ?? '—'}</pre>
                </div>
              ))}
              {r.stderr ? <div className="md:col-span-3"><div className="mb-1 text-xs font-medium text-danger">stderr</div><pre className="max-h-40 overflow-auto rounded border bg-surface p-2 font-mono text-xs whitespace-pre-wrap">{r.stderr}</pre></div> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ------------------------------- Transcript ------------------------------ */

function TranscriptTab({ events }: { events: TranscriptEventDto[] }) {
  if (!events.length) return <EmptyState title="No transcript yet" />;
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className={cn('flex gap-3 rounded-md px-3 py-2 text-sm', e.speaker === 'system' ? 'text-muted' : e.speaker === 'interviewer' ? 'bg-surface-2/60' : '')}>
          <span className="w-16 shrink-0 text-xs text-muted tabular-nums">{fmtDate(e.at, 'HH:mm:ss')}</span>
          <span className={cn('w-20 shrink-0 text-xs font-medium', e.speaker === 'interviewer' ? 'text-accent' : e.speaker === 'candidate' ? 'text-fg' : 'text-muted')}>{titleCase(e.speaker)}</span>
          <span className="whitespace-pre-wrap">{e.text}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------- Integrity ------------------------------- */

function IntegrityTab({ d }: { d: Detail }) {
  const ev = d.events;
  const count = (t: string) => ev.filter((e) => e.type === t).length;
  const summary = d.report?.integrity ?? {
    flags: ev.filter((e) => ['focus_lost', 'paste', 'fullscreen_exit', 'tab_hidden', 'devtools_suspected'].includes(e.type)).length,
    focusLost: count('focus_lost'),
    pasteEvents: count('paste'),
    fullscreenExits: count('fullscreen_exit'),
    tabHidden: count('tab_hidden'),
    otherEvents: 0,
    notes: [],
  };
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Integrity signals are informational and not part of the score.">
        They describe interface events recorded with the candidate's consent. Many have innocent explanations (notifications, accessibility tools, second screens). Use them as prompts for a conversation, not as evidence of misconduct.
      </Alert>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border p-4"><div className="text-xs text-muted">Focus lost</div><div className="text-2xl font-semibold tabular-nums">{summary.focusLost}</div></div>
        <div className="rounded-lg border p-4"><div className="text-xs text-muted">Tab hidden</div><div className="text-2xl font-semibold tabular-nums">{summary.tabHidden}</div></div>
        <div className="rounded-lg border p-4"><div className="text-xs text-muted">Paste events</div><div className="text-2xl font-semibold tabular-nums">{summary.pasteEvents}</div></div>
        <div className="rounded-lg border p-4"><div className="text-xs text-muted">Full-screen exits</div><div className="text-2xl font-semibold tabular-nums">{summary.fullscreenExits}</div></div>
      </div>
      {summary.notes.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{summary.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
      <h3 className="text-sm font-semibold">Timeline</h3>
      {ev.length ? (
        <ol className="space-y-1">
          {ev.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-md px-3 py-1.5 text-sm">
              <span className="w-16 shrink-0 text-xs text-muted tabular-nums">{fmtDate(e.at, 'HH:mm:ss')}</span>
              <AlertTriangle className="size-3.5 text-warning" />
              <span>{titleCase(e.type)}</span>
              {e.sectionIndex !== null && e.sectionIndex !== undefined ? <Badge variant="muted">section {e.sectionIndex + 1}</Badge> : null}
              {e.meta ? <span className="text-xs text-muted">{Object.entries(e.meta).map(([k, v]) => `${k}: ${String(v)}`).join(', ')}</span> : null}
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-muted">No interface events were recorded.</p>}
    </div>
  );
}

/* ------------------------------ Consent & audit -------------------------- */

function AuditTab({ d }: { d: Detail }) {
  const user = useAuth((s) => s.user);
  const canAudit = user?.role === 'superadmin' || user?.organization?.role === 'owner' || user?.organization?.role === 'admin';
  const audit = useQuery({ queryKey: [...qk.audit, d.interview.id], queryFn: () => get<AuditLogDto[]>(`/admin/audit?targetId=${d.interview.id}&limit=100`), enabled: canAudit, meta: { silent: true } });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> AI disclosure &amp; consent</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {d.consent ? (
            <dl className="grid gap-2 sm:grid-cols-2">
              <div><dt className="text-xs text-muted">Disclosure version</dt><dd className="font-mono text-xs">{d.consent.disclosureVersion}</dd></div>
              <div><dt className="text-xs text-muted">Consented at</dt><dd>{fmtDate(d.consent.consentedAt)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted">Text hash</dt><dd className="break-all font-mono text-xs">{d.consent.textHash}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted">Accommodation request</dt><dd>{d.consent.accommodationRequest ?? <span className="text-muted">None</span>}</dd></div>
            </dl>
          ) : <p className="text-muted">The candidate has not yet accepted the AI disclosure.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Audit log</CardTitle><CardDescription>Who viewed or changed this interview.</CardDescription></CardHeader>
        <CardContent>
          {!canAudit ? <p className="text-sm text-muted">Only owners and admins can view the audit log.</p> : audit.isLoading ? <PageLoader /> : !audit.data?.length ? <p className="text-sm text-muted">No entries.</p> : (
            <Table>
              <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Details</Th></tr></thead>
              <tbody>
                {audit.data.map((a) => (
                  <Tr key={a.id}>
                    <Td className="whitespace-nowrap text-muted">{fmtDate(a.at)}</Td>
                    <Td>{a.actor?.name ?? <span className="text-muted">system</span>}</Td>
                    <Td><code className="text-xs">{a.action}</code></Td>
                    <Td className="text-xs text-muted">{a.meta ? JSON.stringify(a.meta) : ''}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------- Sidebar -------------------------------- */

type DecisionForm = z.infer<typeof DecisionBody>;

function DecisionCard({ d }: { d: Detail }) {
  const qc = useQueryClient();
  const finished = ['submitted', 'completed', 'expired'].includes(d.interview.status);
  const form = useForm<z.input<typeof DecisionBody>, unknown, DecisionForm>({ resolver: zodResolver(DecisionBody), defaultValues: { decision: d.decision?.decision ?? 'advance', reason: '' } });
  const save = useMutation({
    mutationFn: (v: DecisionForm) => put<DecisionDto>(`/interviews/${d.interview.id}/decision`, v),
    onSuccess: (dec) => {
      toast.success(`Decision recorded: ${DECISION_LABEL[dec.decision]}`);
      form.reset({ decision: dec.decision, reason: '' });
      qc.invalidateQueries({ queryKey: qk.detail(d.interview.id) });
      qc.invalidateQueries({ queryKey: ['interviews'] });
    },
  });
  const chosen = form.watch('decision');
  const rec = d.report?.status === 'ready' ? d.report.recommendation : null;
  const recPositive = rec && rec !== 'insufficient_evidence' ? ['strong_hire', 'hire'].includes(rec) : null;
  const willOverride = recPositive !== null && ['advance', 'hire'].includes(chosen) !== recPositive;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision</CardTitle>
        <CardDescription>A human records every outcome. The AI never decides.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {d.decision ? (
          <div className="rounded-md border bg-surface-2/60 p-3 text-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={d.decision.decision} label={DECISION_LABEL[d.decision.decision]} />
              {d.decision.overridesRecommendation ? <Tooltip content="This decision differs from the AI recommendation"><Badge variant="warning">override</Badge></Tooltip> : null}
            </div>
            <p className="mt-2">{d.decision.reason}</p>
            <p className="mt-1 text-xs text-muted">{d.decision.decidedBy.name} · {fmtDate(d.decision.decidedAt)}</p>
          </div>
        ) : null}
        {finished ? (
          <form className="space-y-3" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <Field label={d.decision ? 'Change decision' : 'Record decision'} htmlFor="dec">
              <NativeSelect id="dec" {...form.register('decision')}>
                {DECISIONS.map((x) => <option key={x} value={x}>{DECISION_LABEL[x]}</option>)}
              </NativeSelect>
            </Field>
            {willOverride ? <Alert tone="warning">This differs from the AI recommendation ({RECOMMENDATION_LABEL[rec!]}). Please explain why in the reason.</Alert> : null}
            <Field label="Reason" error={form.formState.errors.reason?.message} hint="Shared with the audit log; may be shared with the candidate on request." htmlFor="reason">
              <Textarea id="reason" rows={3} placeholder="Why this decision?" {...form.register('reason')} />
            </Field>
            <Button type="submit" className="w-full" loading={save.isPending}>Save decision</Button>
          </form>
        ) : <p className="text-sm text-muted">Decisions can be recorded after the interview finishes.</p>}
      </CardContent>
    </Card>
  );
}

function ActionsCard({ d }: { d: Detail }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canAdmin = user?.role === 'superadmin' || user?.organization?.role === 'owner' || user?.organization?.role === 'admin';
  const act = useMutation({
    mutationFn: (path: string) => post(`/interviews/${d.interview.id}/${path}`),
    onSuccess: () => {
      toast.success('Done');
      qc.invalidateQueries({ queryKey: qk.detail(d.interview.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
    meta: { silent: true },
  });
  const st = d.interview.status;
  if (!canAdmin || !['invited', 'ready', 'in_progress'].includes(st)) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {['invited', 'ready'].includes(st) ? <Button variant="outline" className="w-full" onClick={() => window.confirm('Cancel this interview? The candidate will no longer be able to start it.') && act.mutate('cancel')} loading={act.isPending}>Cancel interview</Button> : null}
        {st === 'in_progress' ? <Button variant="danger" className="w-full" onClick={() => window.confirm('Force-finish this interview now? It will be closed as expired and a report generated from the evidence so far.') && act.mutate('force-finish')} loading={act.isPending}>Force finish</Button> : null}
      </CardContent>
    </Card>
  );
}

function SectionsCard({ i }: { i: InterviewDto }) {
  return (
    <Card>
      <CardHeader><CardTitle>Sections</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-2 text-sm">
          {i.sections.map((s) => (
            <li key={s.index} className="flex items-start gap-2">
              <StatusBadge status={s.status === 'done' ? 'completed' : s.status === 'active' ? 'in_progress' : 'pending'} label={s.status} className="mt-0.5" />
              <div>
                <div className="font-medium">{s.title}</div>
                <div className="text-xs text-muted">{s.durationMinutes} min{s.startedAt ? ` · started ${fmtDate(s.startedAt, 'HH:mm')}` : ''}{s.completedAt ? ` · done ${fmtDate(s.completedAt, 'HH:mm')}` : ''}</div>
              </div>
            </li>
          ))}
        </ol>
        {i.completeBy && ['invited', 'ready'].includes(i.status) ? <p className="mt-3 text-xs text-muted">Complete by {fmtDate(i.completeBy)}</p> : null}
      </CardContent>
    </Card>
  );
}
