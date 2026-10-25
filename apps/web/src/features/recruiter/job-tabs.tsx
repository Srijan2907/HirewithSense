import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Eye, Pencil, Plus, Send, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { CreateCodingProblemBody, CreateInviteBody, CreateQuestionBody, LANGUAGES, QUESTION_DIFFICULTIES, type CodingProblemDto, type InterviewInviteDto, type InterviewSummaryDto, type JobDto, type QuestionDto, type RankingsDto } from '@hws/shared';
import { Badge, Button, Checkbox, Dialog, DialogContent, DialogFooter, EmptyState, Field, Input, NativeSelect, PageLoader, StatusBadge, Switch, Table, Td, Th, Tooltip, Tr, Textarea } from '@/components/ui';
import { Markdown } from '@/components/markdown';
import { api, del, get, patch, post } from '@/lib/api';
import { qk } from '@/lib/query';
import { DECISION_LABEL, RECOMMENDATION_LABEL, STATUS_LABEL, fmtDate, fmtRelative } from '@/lib/utils';
import { Alert, ScoreText, TagInput } from './shared';

/* ------------------------------- Questions ------------------------------ */

type QForm = z.output<typeof CreateQuestionBody>;
type QFormIn = z.input<typeof CreateQuestionBody>;

export function QuestionsTab({ job }: { job: JobDto }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.questions(job.id), queryFn: () => get<QuestionDto[]>(`/jobs/${job.id}/questions`) });
  const [editing, setEditing] = useState<QuestionDto | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (qid: string) => del(`/jobs/${job.id}/questions/${qid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.questions(job.id) }),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Bank questions are asked first, in order. The interviewer then generates follow-ups targeting under-covered competencies.</p>
        <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add question</Button>
      </div>
      {q.isLoading ? <PageLoader /> : !q.data?.length ? (
        <EmptyState title="No bank questions" description="Optional, but recommended: 2–4 structured questions keep interviews comparable across candidates." action={<Button size="sm" onClick={() => setEditing('new')}>Add question</Button>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-12">#</Th>
              <Th>Prompt</Th>
              <Th>Competency</Th>
              <Th>Difficulty</Th>
              <Th>Expected signals</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data.map((x, i) => (
              <Tr key={x.id}>
                <Td className="text-muted">{x.order || i + 1}</Td>
                <Td className="max-w-md whitespace-normal">{x.prompt}</Td>
                <Td>{x.competencyKey ? <Badge variant="brand">{job.competencies.find((c) => c.key === x.competencyKey)?.label ?? x.competencyKey}</Badge> : <span className="text-muted">—</span>}</Td>
                <Td><Badge>{x.difficulty}</Badge></Td>
                <Td className="max-w-xs"><div className="flex flex-wrap gap-1">{x.expectedSignals.map((s) => <Badge key={s} variant="muted">{s}</Badge>)}</div></Td>
                <Td className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(x)}><Pencil /></Button>
                  <Button variant="ghost" size="icon" aria-label="Delete" className="text-danger" onClick={() => window.confirm('Delete this question?') && remove.mutate(x.id)}><Trash2 /></Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing ? <QuestionDialog job={job} question={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function QuestionDialog({ job, question, onClose }: { job: JobDto; question: QuestionDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<QFormIn, unknown, QForm>({
    resolver: zodResolver(CreateQuestionBody),
    defaultValues: question
      ? { prompt: question.prompt, competencyKey: question.competencyKey, difficulty: question.difficulty, expectedSignals: question.expectedSignals, followUpHints: question.followUpHints, order: question.order }
      : { prompt: '', competencyKey: null, difficulty: 'medium', expectedSignals: [], followUpHints: [], order: 0 },
  });
  const save = useMutation({
    mutationFn: (v: QForm) => (question ? patch(`/jobs/${job.id}/questions/${question.id}`, v) : post(`/jobs/${job.id}/questions`, v)),
    onSuccess: () => {
      toast.success(question ? 'Question updated' : 'Question added');
      qc.invalidateQueries({ queryKey: qk.questions(job.id) });
      onClose();
    },
  });
  const e = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={question ? 'Edit question' : 'Add question'} description="Structured questions asked to every candidate for this job.">
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="Prompt" error={e.prompt?.message} htmlFor="q-prompt">
            <Textarea id="q-prompt" rows={4} {...form.register('prompt')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Competency" htmlFor="q-comp">
              <NativeSelect id="q-comp" {...form.register('competencyKey', { setValueAs: (v) => (v === '' ? null : v) })}>
                <option value="">Any</option>
                {job.competencies.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Difficulty" htmlFor="q-diff">
              <NativeSelect id="q-diff" {...form.register('difficulty')}>
                {QUESTION_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Order" error={e.order?.message} htmlFor="q-order">
              <Input id="q-order" type="number" min={0} {...form.register('order', { valueAsNumber: true })} />
            </Field>
          </div>
          <Field label="Expected signals" hint="What a strong answer mentions; used by the evaluator" htmlFor="q-sig">
            <Controller control={form.control} name="expectedSignals" render={({ field }) => <TagInput id="q-sig" value={field.value ?? []} onChange={field.onChange} placeholder="root cause, trade-offs, …" max={10} />} />
          </Field>
          <Field label="Follow-up hints" hint="Directions for generated follow-ups" htmlFor="q-fu">
            <Controller control={form.control} name="followUpHints" render={({ field }) => <TagInput id="q-fu" value={field.value ?? []} onChange={field.onChange} placeholder="Ask what they'd change today" max={5} />} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{question ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- Coding problems --------------------------- */

type PForm = z.output<typeof CreateCodingProblemBody>;
type PFormIn = z.input<typeof CreateCodingProblemBody>;

export function ProblemsTab({ job }: { job: JobDto }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.problems(job.id), queryFn: () => get<CodingProblemDto[]>(`/jobs/${job.id}/problems`) });
  const [editing, setEditing] = useState<CodingProblemDto | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (pid: string) => del(`/jobs/${job.id}/problems/${pid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.problems(job.id) }),
  });
  const usedIds = new Set(job.interviewPlan.sections.flatMap((s) => (s.type === 'coding' ? s.problemIds : [])));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">Problems run against test cases in an isolated sandbox. Sample cases are shown to candidates; hidden cases never leave the server.</p>
        <Button size="sm" onClick={() => setEditing('new')}><Plus /> New problem</Button>
      </div>
      {q.isLoading ? <PageLoader /> : !q.data?.length ? (
        <EmptyState title="No coding problems" description="Add at least one problem, then add a coding section to the interview plan." action={<Button size="sm" onClick={() => setEditing('new')}>New problem</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {q.data.map((p) => (
            <div key={p.id} className="rounded-lg border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{p.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge>{p.difficulty}</Badge>
                    {usedIds.has(p.id) ? <Badge variant="brand">In plan</Badge> : null}
                    {p.tags.map((t) => <Badge key={t} variant="muted">{t}</Badge>)}
                  </div>
                </div>
                <div className="flex">
                  <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(p)}><Pencil /></Button>
                  <Button variant="ghost" size="icon" aria-label="Delete" className="text-danger" disabled={usedIds.has(p.id)} onClick={() => window.confirm('Delete this problem?') && remove.mutate(p.id)}><Trash2 /></Button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted">
                <div>{p.testCaseCount} cases · {p.sampleCount} sample</div>
                <div>{p.timeLimitMs} ms · {p.memoryLimitMb} MB</div>
                <div className="truncate">{p.languageIds.join(', ')}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing ? <ProblemDialog job={job} problem={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ProblemDialog({ job, problem, onClose }: { job: JobDto; problem: CodingProblemDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState(false);
  const form = useForm<PFormIn, unknown, PForm>({
    resolver: zodResolver(CreateCodingProblemBody),
    defaultValues: problem
      ? { title: problem.title, statement: problem.statement, difficulty: problem.difficulty, languageIds: problem.languageIds, starterCode: problem.starterCode, timeLimitMs: problem.timeLimitMs, memoryLimitMb: problem.memoryLimitMb, tags: problem.tags, testCases: problem.testCases ?? [] }
      : { title: '', statement: '', difficulty: 'medium', languageIds: ['javascript', 'python'], starterCode: {}, timeLimitMs: 3000, memoryLimitMb: 256, tags: [], testCases: [{ input: '', expectedOutput: '', isSample: true, weight: 1, label: 'Example' }] },
  });
  const cases = useFieldArray({ control: form.control, name: 'testCases' });
  const langs = form.watch('languageIds');
  const statement = form.watch('statement');
  const save = useMutation({
    mutationFn: (v: PForm) => (problem ? patch(`/jobs/${job.id}/problems/${problem.id}`, v) : post(`/jobs/${job.id}/problems`, v)),
    onSuccess: () => {
      toast.success(problem ? 'Problem updated' : 'Problem created');
      qc.invalidateQueries({ queryKey: qk.problems(job.id) });
      onClose();
    },
  });
  const e = form.formState.errors;
  const caseErrs = e.testCases as unknown as Array<Record<string, { message?: string }> | undefined> | undefined;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={problem ? 'Edit coding problem' : 'New coding problem'} className="max-w-3xl">
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v), () => toast.error('Please fix the highlighted fields'))}>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label="Title" error={e.title?.message} htmlFor="p-title"><Input id="p-title" {...form.register('title')} /></Field>
            <Field label="Difficulty" htmlFor="p-diff">
              <NativeSelect id="p-diff" {...form.register('difficulty')}>{QUESTION_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}</NativeSelect>
            </Field>
          </div>
          <Field label={<span className="flex items-center justify-between">Statement (Markdown) <button type="button" className="text-xs text-accent hover:underline" onClick={() => setPreview((p) => !p)}><Eye className="mr-1 inline size-3" />{preview ? 'Edit' : 'Preview'}</button></span> as unknown as string} error={e.statement?.message} htmlFor="p-stmt">
            {preview ? <div className="min-h-[8rem] rounded-md border p-3"><Markdown>{statement || '_Nothing yet_'}</Markdown></div> : <Textarea id="p-stmt" rows={8} className="font-mono text-xs" {...form.register('statement')} />}
          </Field>
          <Field label="Languages" error={(e.languageIds as { message?: string } | undefined)?.message}>
            <Controller control={form.control} name="languageIds" render={({ field }) => (
              <div className="flex flex-wrap gap-3">
                {LANGUAGES.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={(field.value ?? []).includes(l.id)} onCheckedChange={(c) => field.onChange(c ? [...(field.value ?? []), l.id] : (field.value ?? []).filter((x) => x !== l.id))} /> {l.label}
                  </label>
                ))}
              </div>
            )} />
          </Field>
          <div>
            <div className="mb-1.5 text-sm font-medium">Starter code (optional, per language)</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(langs ?? []).map((l) => (
                <Field key={l} label={LANGUAGES.find((x) => x.id === l)?.label ?? l}>
                  <Textarea rows={4} className="font-mono text-xs" {...form.register(`starterCode.${l}` as const)} />
                </Field>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Time limit (ms)" error={e.timeLimitMs?.message}><Input type="number" min={500} max={20000} {...form.register('timeLimitMs', { valueAsNumber: true })} /></Field>
            <Field label="Memory (MB)" error={e.memoryLimitMb?.message}><Input type="number" min={32} max={1024} {...form.register('memoryLimitMb', { valueAsNumber: true })} /></Field>
            <Field label="Tags"><Controller control={form.control} name="tags" render={({ field }) => <TagInput value={field.value ?? []} onChange={field.onChange} placeholder="arrays, …" max={10} />} /></Field>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-sm font-medium">Test cases</div>
              <Button type="button" variant="outline" size="sm" onClick={() => cases.append({ input: '', expectedOutput: '', isSample: false, weight: 1, label: `Case ${cases.fields.length + 1}` })} disabled={cases.fields.length >= 50}><Plus /> Add case</Button>
            </div>
            {(e.testCases as { message?: string } | undefined)?.message || (e.testCases as { root?: { message?: string } } | undefined)?.root?.message ? <Alert tone="danger" className="mb-2">{(e.testCases as { message?: string }).message ?? (e.testCases as { root?: { message?: string } }).root?.message}</Alert> : null}
            <div className="space-y-2">
              {cases.fields.map((c, i) => (
                <div key={c.id} className="rounded-md border p-3">
                  <div className="mb-2 grid gap-2 sm:grid-cols-[1fr_6rem_auto_auto]">
                    <Input placeholder="Label" {...form.register(`testCases.${i}.label`)} aria-label="Case label" />
                    <Input type="number" min={0} step="0.5" placeholder="Weight" {...form.register(`testCases.${i}.weight`, { valueAsNumber: true })} aria-label="Weight" />
                    <label className="flex items-center gap-2 text-sm">
                      <Controller control={form.control} name={`testCases.${i}.isSample`} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} /> Sample (visible)
                    </label>
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove case" onClick={() => cases.remove(i)} disabled={cases.fields.length <= 1}><Trash2 /></Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Input (stdin)" error={caseErrs?.[i]?.input?.message}><Textarea rows={3} className="font-mono text-xs" {...form.register(`testCases.${i}.input`)} /></Field>
                    <Field label="Expected output" error={caseErrs?.[i]?.expectedOutput?.message}><Textarea rows={3} className="font-mono text-xs" {...form.register(`testCases.${i}.expectedOutput`)} /></Field>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Trailing whitespace is ignored when comparing output. Mark at least one case as a sample.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{problem ? 'Save' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Candidates ------------------------------ */

export function CandidatesTab({ job, openInvite, onInviteHandled }: { job: JobDto; openInvite: boolean; onInviteHandled: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const invites = useQuery({ queryKey: qk.invites(job.id), queryFn: () => get<InterviewInviteDto[]>(`/invites/jobs/${job.id}`) });
  const interviews = useQuery({ queryKey: qk.interviews(`jobId=${job.id}`), queryFn: () => get<{ items: InterviewSummaryDto[]; total: number }>(`/interviews?jobId=${job.id}&pageSize=100`) });
  const [dialog, setDialog] = useState(false);
  useEffect(() => {
    if (openInvite) {
      setDialog(true);
      onInviteHandled();
    }
  }, [openInvite, onInviteHandled]);
  const resend = useMutation({ mutationFn: (id: string) => post(`/invites/${id}/resend`), onSuccess: () => { toast.success('Invitation resent'); qc.invalidateQueries({ queryKey: qk.invites(job.id) }); } });
  const cancel = useMutation({ mutationFn: (id: string) => del(`/invites/${id}`), onSuccess: () => { toast.success('Invitation cancelled'); qc.invalidateQueries({ queryKey: qk.invites(job.id) }); } });
  const pending = (invites.data ?? []).filter((i) => i.status === 'pending');
  const others = (invites.data ?? []).filter((i) => i.status !== 'pending' && i.status !== 'accepted');
  return (
    <div className="space-y-6">
      {job.status !== 'open' ? <Alert tone="warning">Open the job to invite candidates.</Alert> : null}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Pending invitations ({pending.length})</h3>
        <Button size="sm" onClick={() => setDialog(true)} disabled={job.status !== 'open'}><UserPlus /> Invite candidates</Button>
      </div>
      {invites.isLoading ? <PageLoader /> : pending.length === 0 && others.length === 0 ? (
        <EmptyState title="No invitations yet" description="Invite candidates by email. They get a link to accept and run the interview in their browser." />
      ) : (
        <Table>
          <thead>
            <tr><Th>Email</Th><Th>Name</Th><Th>Status</Th><Th>Invited by</Th><Th>Expires</Th><Th /></tr>
          </thead>
          <tbody>
            {[...pending, ...others].map((i) => (
              <Tr key={i.id}>
                <Td>{i.email}</Td>
                <Td className="text-muted">{i.candidateName ?? '—'}</Td>
                <Td><StatusBadge status={i.status} label={STATUS_LABEL[i.status]} /></Td>
                <Td className="text-muted">{i.invitedBy}</Td>
                <Td className="text-muted whitespace-nowrap">{fmtRelative(i.expiresAt)}</Td>
                <Td className="text-right whitespace-nowrap">
                  {i.status === 'pending' ? (
                    <>
                      <Tooltip content="Resend with a fresh link"><Button variant="ghost" size="icon" aria-label="Resend" onClick={() => resend.mutate(i.id)}><Send /></Button></Tooltip>
                      <Button variant="ghost" size="icon" aria-label="Cancel invitation" className="text-danger" onClick={() => window.confirm(`Cancel the invitation for ${i.email}?`) && cancel.mutate(i.id)}><Trash2 /></Button>
                    </>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      <h3 className="text-sm font-semibold">Interviews ({interviews.data?.total ?? 0})</h3>
      {interviews.isLoading ? <PageLoader /> : !interviews.data?.items.length ? (
        <p className="text-sm text-muted">No candidate has accepted an invitation yet.</p>
      ) : (
        <Table>
          <thead>
            <tr><Th>Candidate</Th><Th>Status</Th><Th className="text-right">Score</Th><Th>Recommendation</Th><Th>Decision</Th><Th>Complete by</Th><Th>Completed</Th></tr>
          </thead>
          <tbody>
            {interviews.data.items.map((i) => (
              <Tr key={i.id} className="cursor-pointer" onClick={() => nav(`/recruiter/interviews/${i.id}`)}>
                <Td><div className="font-medium">{i.candidate.name}</div><div className="text-xs text-muted">{i.candidate.email}</div></Td>
                <Td><StatusBadge status={i.status} label={STATUS_LABEL[i.status]} /></Td>
                <Td className="text-right"><ScoreText score={i.weightedScore} /></Td>
                <Td>{i.recommendation ? <StatusBadge status={i.recommendation} label={RECOMMENDATION_LABEL[i.recommendation]} /> : <span className="text-muted">—</span>}</Td>
                <Td>{i.decision ? <StatusBadge status={i.decision} label={DECISION_LABEL[i.decision]} /> : <span className="text-muted">—</span>}</Td>
                <Td className="text-muted whitespace-nowrap">{fmtDate(i.completeBy, 'd MMM yyyy')}</Td>
                <Td className="text-muted whitespace-nowrap">{fmtDate(i.completedAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {dialog ? <InviteDialog job={job} onClose={() => setDialog(false)} /> : null}
    </div>
  );
}

type InviteForm = z.output<typeof CreateInviteBody>;
type InviteFormIn = z.input<typeof CreateInviteBody>;

function InviteDialog({ job, onClose }: { job: JobDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState<{ created: InterviewInviteDto[]; failed: { email: string; reason: string }[] } | null>(null);
  const form = useForm<InviteFormIn, unknown, InviteForm>({ resolver: zodResolver(CreateInviteBody), defaultValues: { email: '', candidateName: '', message: '', expiresInDays: 14 } });
  const single = useMutation({
    mutationFn: (v: InviteForm) => post<InterviewInviteDto>(`/invites/jobs/${job.id}`, { ...v, candidateName: v.candidateName || undefined, message: v.message || undefined }),
    onSuccess: (inv) => {
      toast.success(`Invitation sent to ${inv.email}`);
      qc.invalidateQueries({ queryKey: qk.invites(job.id) });
      onClose();
    },
  });
  const bulk = useMutation({
    mutationFn: () => {
      const invites = bulkText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [email, ...rest] = l.split(/[,;\t]/).map((p) => p.trim());
          return { email: email ?? '', candidateName: rest.join(' ') || undefined, expiresInDays: 14 };
        });
      return post<{ created: InterviewInviteDto[]; failed: { email: string; reason: string }[] }>(`/invites/jobs/${job.id}/bulk`, { invites });
    },
    onSuccess: (r) => {
      setBulkResult(r);
      qc.invalidateQueries({ queryKey: qk.invites(job.id) });
      if (r.created.length) toast.success(`${r.created.length} invitation(s) sent`);
    },
  });
  const e = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Invite candidates" description={`Candidates receive an email link to accept and complete the ${job.title} interview.`}>
        <div className="mb-4 inline-flex rounded-md bg-surface-2 p-1 text-sm">
          <button type="button" className={`rounded-sm px-3 py-1 ${mode === 'single' ? 'bg-surface shadow-xs' : 'text-muted'}`} onClick={() => setMode('single')}>One candidate</button>
          <button type="button" className={`rounded-sm px-3 py-1 ${mode === 'bulk' ? 'bg-surface shadow-xs' : 'text-muted'}`} onClick={() => setMode('bulk')}>Bulk paste</button>
        </div>
        {mode === 'single' ? (
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => single.mutate(v))}>
            <Field label="Email" error={e.email?.message} htmlFor="inv-email"><Input id="inv-email" type="email" autoFocus {...form.register('email')} /></Field>
            <Field label="Candidate name (optional)" htmlFor="inv-name"><Input id="inv-name" {...form.register('candidateName')} /></Field>
            <Field label="Personal message (optional)" htmlFor="inv-msg"><Textarea id="inv-msg" rows={3} {...form.register('message')} /></Field>
            <Field label="Link valid for (days)" error={e.expiresInDays?.message} htmlFor="inv-exp"><Input id="inv-exp" type="number" min={1} max={60} className="w-28" {...form.register('expiresInDays', { valueAsNumber: true })} /></Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" loading={single.isPending}><Send /> Send invitation</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <Field label="One candidate per line" hint="Format: email, name (name optional)" htmlFor="bulk">
              <Textarea id="bulk" rows={8} className="font-mono text-xs" placeholder={'alice@example.com, Alice Example\nbob@example.com'} value={bulkText} onChange={(ev) => setBulkText(ev.target.value)} />
            </Field>
            {bulkResult ? (
              <div className="space-y-2 text-sm">
                <Alert tone="success">{bulkResult.created.length} invitation(s) created.</Alert>
                {bulkResult.failed.length ? (
                  <Alert tone="warning" title={`${bulkResult.failed.length} failed`}>
                    <ul className="list-disc pl-4">{bulkResult.failed.map((f) => <li key={f.email}>{f.email}: {f.reason}</li>)}</ul>
                  </Alert>
                ) : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>{bulkResult ? 'Close' : 'Cancel'}</Button>
              <Button type="button" onClick={() => bulk.mutate()} loading={bulk.isPending} disabled={!bulkText.trim()}><Send /> Send all</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- Rankings ------------------------------ */

type SortKey = 'score' | 'name' | 'completed' | 'coding';

export function RankingsTab({ job }: { job: JobDto }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: qk.rankings(job.id), queryFn: () => get<RankingsDto>(`/jobs/${job.id}/rankings`) });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 });
  const [exporting, setExporting] = useState(false);
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }));
  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api<Response>(`/jobs/${job.id}/rankings.csv`, { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rankings-${job.slug}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  };
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  if (!d) return null;
  const rows = [...d.rows].sort((a, b) => {
    const v = (r: RankingsDto['rows'][number]) => (sort.key === 'score' ? r.weightedScore ?? -1 : sort.key === 'coding' ? r.codingScore ?? -1 : sort.key === 'completed' ? (r.completedAt ? Date.parse(r.completedAt) : 0) : r.candidate.name.toLowerCase());
    const av = v(a);
    const bv = v(b);
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
  });
  const SortTh = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <Th className={className}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => toggle(k)}>
        {children} {sort.key === k ? <span aria-hidden>{sort.dir === -1 ? '↓' : '↑'}</span> : null}
      </button>
    </Th>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Weighted scores over assessed competencies. Minimum score for this job: <strong>{d.job.minimumScore}</strong>. Integrity signals are shown separately and never affect the score.</p>
        <Button variant="outline" size="sm" onClick={exportCsv} loading={exporting}><Download /> Export CSV</Button>
      </div>
      {!rows.length ? (
        <EmptyState title="No finished interviews yet" description="Rankings appear once candidates complete their interviews and reports are generated." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-10">#</Th>
              <SortTh k="name">Candidate</SortTh>
              <Th>Status</Th>
              <SortTh k="score" className="text-right">Score</SortTh>
              <Th className="text-right">Coverage</Th>
              <Th>Recommendation</Th>
              <Th className="text-center">Min</Th>
              {d.job.competencies.map((c) => (
                <Th key={c.key} className="text-right"><Tooltip content={`${c.label} (weight ${c.weight})`}><span>{c.label.length > 12 ? c.label.slice(0, 11) + '…' : c.label}</span></Tooltip></Th>
              ))}
              <Th className="text-center">Integrity</Th>
              <Th>Decision</Th>
              <SortTh k="completed">Completed</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Tr key={r.interviewId} className="cursor-pointer" onClick={() => nav(`/recruiter/interviews/${r.interviewId}`)}>
                <Td className="text-muted tabular-nums">{i + 1}</Td>
                <Td><div className="font-medium">{r.candidate.name}</div><div className="text-xs text-muted">{r.candidate.email}</div></Td>
                <Td><StatusBadge status={r.status} label={STATUS_LABEL[r.status]} /></Td>
                <Td className="text-right"><ScoreText score={r.weightedScore} className="text-base" /></Td>
                <Td className="text-right text-muted tabular-nums">{r.coverage === null ? '—' : `${Math.round(r.coverage * 100)}%`}</Td>
                <Td>{r.recommendation ? <StatusBadge status={r.recommendation} label={RECOMMENDATION_LABEL[r.recommendation]} /> : <span className="text-muted">pending</span>}</Td>
                <Td className="text-center">{r.meetsMinimum === null ? <span className="text-muted">—</span> : r.meetsMinimum ? <span className="text-success">✓</span> : <span className="text-danger">✗</span>}</Td>
                {d.job.competencies.map((c) => <Td key={c.key} className="text-right tabular-nums"><ScoreText score={r.competencyScores[c.key]} /></Td>)}
                <Td className="text-center">
                  {r.integrityFlags > 0 ? (
                    <Tooltip content="Interface events (focus loss, paste, full-screen exit). Informational; separate from the score."><span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-3.5" />{r.integrityFlags}</span></Tooltip>
                  ) : <span className="text-muted">0</span>}
                </Td>
                <Td>{r.decision ? <StatusBadge status={r.decision} label={DECISION_LABEL[r.decision]} /> : <span className="text-muted">—</span>}</Td>
                <Td className="text-muted whitespace-nowrap">{fmtDate(r.completedAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-xs text-muted">
        Rankings are an aid, not a decision. Review each report and record a decision from the <Link to={`/recruiter/interviews?jobId=${job.id}`} className="text-accent hover:underline">interview list</Link>.
      </p>
    </div>
  );
}
