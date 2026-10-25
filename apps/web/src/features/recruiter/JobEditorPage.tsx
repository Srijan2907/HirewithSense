import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Controller, useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { CreateJobBody, DEFAULT_COMPETENCIES, LANGUAGES, type CodingProblemDto, type JobDto } from '@hws/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Field, Input, NativeSelect, PageHeader, PageLoader, Switch, Textarea } from '@/components/ui';
import { get, isApiError, patch, post } from '@/lib/api';
import { errorMessage, qk, queryClient } from '@/lib/query';
import { useDocumentTitle } from '@/lib/hooks';
import { Alert, TagInput } from './shared';

/** Editor form shape: same as CreateJobBody but with the plan always present (edit mode may add coding sections). */
const FormSchema = CreateJobBody.extend({
  interviewPlan: CreateJobBody.shape.interviewPlan.unwrap(),
});
type FormValues = z.input<typeof FormSchema>;
type FormOut = z.output<typeof FormSchema>;

const slugKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);

const defaults: FormValues = {
  title: '',
  department: null,
  location: null,
  employmentType: null,
  seniority: null,
  description: '',
  skills: [],
  competencies: DEFAULT_COMPETENCIES,
  interviewPlan: { sections: [{ type: 'conversation', title: 'Conversation', durationMinutes: 25, questionCount: 6, allowGeneratedQuestions: true }], graceSeconds: 15, completionWindowDays: 7 },
  minimumScore: 65,
  biasAuditUrl: null,
};

export default function JobEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  useDocumentTitle(editing ? 'Edit job' : 'New job');
  const nav = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const job = useQuery({ queryKey: qk.job(id!), queryFn: () => get<JobDto>(`/jobs/${id}`), enabled: editing });
  const problems = useQuery({ queryKey: qk.problems(id!), queryFn: () => get<CodingProblemDto[]>(`/jobs/${id}/problems`), enabled: editing });

  const form = useForm<FormValues, unknown, FormOut>({ resolver: zodResolver(FormSchema), defaultValues: defaults, mode: 'onBlur' });
  useEffect(() => {
    if (job.data) {
      const j = job.data;
      form.reset({
        title: j.title,
        department: j.department,
        location: j.location,
        employmentType: j.employmentType as FormValues['employmentType'],
        seniority: j.seniority as FormValues['seniority'],
        description: j.description,
        skills: j.skills,
        competencies: j.competencies,
        interviewPlan: j.interviewPlan,
        minimumScore: j.minimumScore,
        biasAuditUrl: j.biasAuditUrl,
      });
    }
  }, [job.data, form]);

  const save = useMutation({
    mutationFn: async (v: FormOut) => {
      if (editing) return patch<JobDto>(`/jobs/${id}`, v);
      const { interviewPlan, ...rest } = v;
      return post<JobDto>('/jobs', { ...rest, interviewPlan });
    },
    onSuccess: (j) => {
      toast.success(editing ? 'Job updated' : 'Job created');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: qk.job(j.id) });
      nav(`/recruiter/jobs/${j.id}`);
    },
    onError: (err) => {
      const msg = errorMessage(err);
      setServerError(isApiError(err) ? `${msg}${err.details && Array.isArray(err.details) ? ' — ' + (err.details as { path: string; message: string }[]).map((d) => `${d.path}: ${d.message}`).join('; ') : ''}` : msg);
      toast.error(msg);
    },
    meta: { silent: true },
  });

  if (editing && job.isLoading) return <PageLoader />;

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/recruiter/jobs" className="hover:underline">Jobs</Link>}
        title={editing ? `Edit: ${job.data?.title ?? ''}` : 'New job'}
        description={editing ? 'Changes do not affect interviews already in progress; each interview keeps a snapshot of the plan.' : 'Describe the role, define the rubric, then shape the interview.'}
      />
      <form className="space-y-6" onSubmit={form.handleSubmit((v) => { setServerError(null); save.mutate(v); }, () => toast.error('Please fix the highlighted fields'))}>
        {serverError ? <Alert tone="danger" title="The server rejected the job">{serverError}</Alert> : null}
        <Details form={form} />
        <Competencies form={form} />
        <Plan form={form} editing={editing} problems={problems.data ?? []} />
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => nav(editing ? `/recruiter/jobs/${id}` : '/recruiter/jobs')}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Create job'}</Button>
        </div>
      </form>
    </>
  );
}

type F = UseFormReturn<FormValues, unknown, FormOut>;

function Details({ form }: { form: F }) {
  const e = form.formState.errors;
  const nullable = { setValueAs: (v: string) => (v === '' ? null : v) };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Role details</CardTitle>
        <CardDescription>What candidates see in the invitation and lobby, and what the interviewer is grounded in.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" error={e.title?.message} className="sm:col-span-2" htmlFor="title">
          <Input id="title" placeholder="Backend Engineer" {...form.register('title')} />
        </Field>
        <Field label="Department" error={e.department?.message} htmlFor="dept">
          <Input id="dept" placeholder="Engineering" {...form.register('department', nullable)} />
        </Field>
        <Field label="Location" error={e.location?.message} htmlFor="loc">
          <Input id="loc" placeholder="Remote" {...form.register('location', nullable)} />
        </Field>
        <Field label="Employment type" htmlFor="emp">
          <NativeSelect id="emp" {...form.register('employmentType', nullable)}>
            <option value="">Not specified</option>
            <option value="full_time">Full time</option>
            <option value="part_time">Part time</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
          </NativeSelect>
        </Field>
        <Field label="Seniority" htmlFor="sen">
          <NativeSelect id="sen" {...form.register('seniority', nullable)}>
            <option value="">Not specified</option>
            {['intern', 'junior', 'mid', 'senior', 'staff', 'lead'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Description" error={e.description?.message} hint="Markdown supported. Include responsibilities and must-have skills; the AI interviewer uses this to ground questions." className="sm:col-span-2" htmlFor="desc">
          <Textarea id="desc" rows={8} {...form.register('description')} />
        </Field>
        <Field label="Skills" error={e.skills?.message as string | undefined} hint="Press Enter after each skill" className="sm:col-span-2" htmlFor="skills">
          <Controller control={form.control} name="skills" render={({ field }) => <TagInput id="skills" value={field.value ?? []} onChange={field.onChange} placeholder="Node.js, PostgreSQL, …" />} />
        </Field>
        <Field label="Minimum score" error={e.minimumScore?.message} hint="Weighted score (0–100) a candidate must reach to be recommended" htmlFor="min">
          <div className="flex items-center gap-3">
            <input id="min" type="range" min={0} max={100} className="flex-1 accent-[var(--accent)]" {...form.register('minimumScore', { valueAsNumber: true })} />
            <Input type="number" min={0} max={100} className="w-20" {...form.register('minimumScore', { valueAsNumber: true })} aria-label="Minimum score" />
          </div>
        </Field>
        <Field label="Bias audit summary URL" error={e.biasAuditUrl?.message} hint="Optional. Public link to the latest bias audit (required for NYC Local Law 144 postings)." htmlFor="bias">
          <Input id="bias" placeholder="https://" {...form.register('biasAuditUrl', nullable)} />
        </Field>
      </CardContent>
    </Card>
  );
}

function Competencies({ form }: { form: F }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'competencies' });
  const values = useWatch({ control: form.control, name: 'competencies' }) ?? [];
  const total = ((values ?? []) as NonNullable<FormValues['competencies']>).reduce((s, c) => s + (Number(c?.weight) || 0), 0);
  const ok = Math.abs(total - 100) < 0.01;
  const err = form.formState.errors.competencies;
  const rootMsg = (err as { root?: { message?: string }; message?: string } | undefined)?.root?.message ?? (err as { message?: string } | undefined)?.message;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Competencies (rubric)</CardTitle>
          <CardDescription>Each competency is scored 0–100 with quoted evidence. Weights must total 100. The <code className="text-xs">coding_correctness</code> key is computed from test results, not by the model.</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => form.setValue('competencies', DEFAULT_COMPETENCIES, { shouldDirty: true })}>Default rubric</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.map((f, i) => {
          const rowErr = Array.isArray(err) ? err[i] : undefined;
          return (
            <div key={f.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_6rem_auto]">
              <Field label="Label" error={rowErr?.label?.message}>
                <Input
                  {...form.register(`competencies.${i}.label`, {
                    onChange: (e) => {
                      const current = form.getValues(`competencies.${i}.key`);
                      if (!current || current === slugKey(f.label ?? '') || !form.getFieldState(`competencies.${i}.key`).isDirty) form.setValue(`competencies.${i}.key`, slugKey(e.target.value));
                    },
                  })}
                />
              </Field>
              <Field label="Key" error={rowErr?.key?.message} hint="snake_case identifier">
                <Input className="font-mono text-xs" {...form.register(`competencies.${i}.key`)} />
              </Field>
              <Field label="Weight" error={rowErr?.weight?.message}>
                <Input type="number" min={0} max={100} {...form.register(`competencies.${i}.weight`, { valueAsNumber: true })} />
              </Field>
              <div className="flex items-end">
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove competency" disabled={fields.length <= 1}>
                  <Trash2 />
                </Button>
              </div>
              <Field label="Description" error={rowErr?.description?.message} className="sm:col-span-4">
                <Textarea rows={2} placeholder="What does strong performance look like?" {...form.register(`competencies.${i}.description`)} />
              </Field>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => append({ key: '', label: '', description: '', weight: 0 })} disabled={fields.length >= 10}>
            <Plus /> Add competency
          </Button>
          <div className={ok ? 'text-sm text-success' : 'text-sm font-medium text-danger'}>
            Total weight: {total} / 100 {ok ? '✓' : '— must equal 100'}
          </div>
        </div>
        {rootMsg ? <Alert tone="danger">{rootMsg}</Alert> : null}
      </CardContent>
    </Card>
  );
}

function Plan({ form, editing, problems }: { form: F; editing: boolean; problems: CodingProblemDto[] }) {
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: 'interviewPlan.sections' });
  const sections = useWatch({ control: form.control, name: 'interviewPlan.sections' }) ?? [];
  const total = sections.reduce((s, x) => s + (Number(x?.durationMinutes) || 0), 0);
  const competencies = useWatch({ control: form.control, name: 'competencies' }) ?? [];
  const codingWeight = competencies.find((c) => c?.key === 'coding_correctness')?.weight ?? 0;
  const hasCoding = sections.some((s) => s?.type === 'coding');
  const planErr = form.formState.errors.interviewPlan;
  const sectionErrs = planErr?.sections as unknown as Array<Record<string, { message?: string }> | undefined> | undefined;
  const addCoding = () =>
    append({ type: 'coding', title: 'Coding', durationMinutes: 40, problemIds: problems.length ? [problems[0]!.id] : [], languageIds: ['javascript', 'python'] } as FormValues['interviewPlan']['sections'][number]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Interview plan</CardTitle>
        <CardDescription>Ordered sections the candidate goes through. Each section has its own timer; total {total} min.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {codingWeight > 0 && !hasCoding ? <Alert tone="warning">Coding correctness has weight {codingWeight} but there is no coding section. Add one or set the weight to 0 before opening the job.</Alert> : null}
        {!editing ? <Alert tone="info">Coding sections can be added after creating the job: create it, add coding problems in the “Coding problems” tab, then edit the plan.</Alert> : null}
        {fields.map((f, i) => {
          const s = sections[i];
          const se = sectionErrs?.[i];
          return (
            <div key={f.id} className="rounded-md border p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  Section {i + 1} · {s?.type === 'coding' ? 'Coding' : 'Conversation'}
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, i + 1)}><ArrowDown /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove section" disabled={fields.length <= 1} onClick={() => remove(i)}><Trash2 /></Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Title" error={se?.title?.message}>
                  <Input {...form.register(`interviewPlan.sections.${i}.title`)} />
                </Field>
                <Field label="Duration (min)" error={se?.durationMinutes?.message}>
                  <Input type="number" min={5} max={180} {...form.register(`interviewPlan.sections.${i}.durationMinutes`, { valueAsNumber: true })} />
                </Field>
                {s?.type === 'conversation' ? (
                  <>
                    <Field label="Questions" error={se?.questionCount?.message} hint="Bank questions first, then generated">
                      <Input type="number" min={1} max={20} {...form.register(`interviewPlan.sections.${i}.questionCount` as const, { valueAsNumber: true })} />
                    </Field>
                    <div className="flex items-center gap-2 sm:col-span-3">
                      <Controller control={form.control} name={`interviewPlan.sections.${i}.allowGeneratedQuestions` as const} render={({ field }) => <Switch id={`gen-${i}`} checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
                      <label htmlFor={`gen-${i}`} className="text-sm">Allow the interviewer to generate follow-up questions beyond the question bank</label>
                    </div>
                  </>
                ) : (
                  <>
                    <Field label="Problems" error={(se?.problemIds as { message?: string } | undefined)?.message} className="sm:col-span-3" hint={problems.length ? 'Pick one or more coding problems from this job' : 'No coding problems yet — add them in the job’s Coding problems tab'}>
                      <Controller
                        control={form.control}
                        name={`interviewPlan.sections.${i}.problemIds` as const}
                        render={({ field }) => (
                          <div className="flex flex-wrap gap-3">
                            {problems.map((p) => {
                              const checked = (field.value as string[] | undefined)?.includes(p.id) ?? false;
                              return (
                                <label key={p.id} className="flex items-center gap-2 text-sm">
                                  <Checkbox checked={checked} onCheckedChange={(c) => field.onChange(c ? [...((field.value as string[]) ?? []), p.id] : ((field.value as string[]) ?? []).filter((x) => x !== p.id))} />
                                  {p.title} <span className="text-xs text-muted">({p.difficulty})</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      />
                    </Field>
                    <Field label="Languages" error={(se?.languageIds as { message?: string } | undefined)?.message} className="sm:col-span-3">
                      <Controller
                        control={form.control}
                        name={`interviewPlan.sections.${i}.languageIds` as const}
                        render={({ field }) => (
                          <div className="flex flex-wrap gap-3">
                            {LANGUAGES.map((l) => {
                              const val = (field.value as string[] | undefined) ?? [];
                              return (
                                <label key={l.id} className="flex items-center gap-2 text-sm">
                                  <Checkbox checked={val.includes(l.id)} onCheckedChange={(c) => field.onChange(c ? [...val, l.id] : val.filter((x) => x !== l.id))} />
                                  {l.label}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      />
                    </Field>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={fields.length >= 4} onClick={() => append({ type: 'conversation', title: 'Conversation', durationMinutes: 20, questionCount: 5, allowGeneratedQuestions: true })}>
            <Plus /> Conversation section
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={fields.length >= 4 || !editing} onClick={addCoding}>
            <Plus /> Coding section
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Grace seconds" hint="Writes accepted this long after a section deadline (network slack)" error={planErr?.graceSeconds?.message}>
            <Input type="number" min={0} max={120} {...form.register('interviewPlan.graceSeconds', { valueAsNumber: true })} />
          </Field>
          <Field label="Completion window (days)" hint="Days the candidate has after accepting an invitation" error={planErr?.completionWindowDays?.message}>
            <Input type="number" min={1} max={60} {...form.register('interviewPlan.completionWindowDays', { valueAsNumber: true })} />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

export { useMemo };
