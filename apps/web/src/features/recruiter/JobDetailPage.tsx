import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronDown, Lock, Pencil, PlayCircle, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { JobDto } from '@hws/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, PageHeader, PageLoader, Stat, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { Markdown } from '@/components/markdown';
import { get, patch } from '@/lib/api';
import { errorMessage, qk } from '@/lib/query';
import { useDocumentTitle } from '@/lib/hooks';
import { STATUS_LABEL, fmtDate, titleCase } from '@/lib/utils';
import { CandidatesTab, ProblemsTab, QuestionsTab, RankingsTab } from './job-tabs';
import { Alert, planMinutes } from './shared';

export default function JobDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'overview';
  const [openInvite, setOpenInvite] = useState(false);
  const q = useQuery({ queryKey: qk.job(id), queryFn: () => get<JobDto>(`/jobs/${id}`) });
  useDocumentTitle(q.data?.title ?? 'Job');
  const setStatus = useMutation({
    mutationFn: (status: JobDto['status']) => patch<JobDto>(`/jobs/${id}`, { status }),
    onSuccess: (j) => {
      toast.success(`Job is now ${(STATUS_LABEL[j.status] ?? j.status).toLowerCase()}`);
      qc.invalidateQueries({ queryKey: qk.job(id) });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
    meta: { silent: true },
  });
  const onInviteHandled = useCallback(() => setOpenInvite(false), []);
  if (q.isLoading) return <PageLoader />;
  const job = q.data;
  if (!job) return <Alert tone="danger">Job not found.</Alert>;
  const change = (status: JobDto['status'], confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    setStatus.mutate(status);
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/recruiter/jobs" className="hover:underline">Jobs</Link>}
        title={
          <span className="flex items-center gap-3">
            {job.title} <StatusBadge status={job.status} label={STATUS_LABEL[job.status]} />
          </span>
        }
        description={[job.department, job.location, job.seniority ? titleCase(job.seniority) : null, job.employmentType ? titleCase(job.employmentType) : null].filter(Boolean).join(' · ') || 'No details'}
        actions={
          <>
            <Button variant="outline" onClick={() => nav(`/recruiter/jobs/${id}/edit`)}><Pencil /> Edit</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" loading={setStatus.isPending}>Status <ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {job.status !== 'open' ? <DropdownMenuItem onSelect={() => change('open')}><PlayCircle /> Open for interviews</DropdownMenuItem> : null}
                {job.status === 'open' ? <DropdownMenuItem onSelect={() => change('closed', 'Close this job? Pending invitations can no longer be accepted.')}><Lock /> Close</DropdownMenuItem> : null}
                {job.status !== 'archived' ? <DropdownMenuItem onSelect={() => change('archived', 'Archive this job? It will be hidden from active lists.')}><Archive /> Archive</DropdownMenuItem> : null}
                {job.status === 'archived' || job.status === 'closed' ? <DropdownMenuItem onSelect={() => change('draft')}>Back to draft</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => { setSp({ tab: 'candidates' }); setOpenInvite(true); }} disabled={job.status !== 'open'}><UserPlus /> Invite candidates</Button>
          </>
        }
      />
      {job.status === 'draft' ? <Alert tone="info" className="mb-4">This job is a draft. Add questions and coding problems, then open it to start inviting candidates.</Alert> : null}

      <Tabs value={tab} onValueChange={(v) => setSp({ tab: v })}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="problems">Coding problems</TabsTrigger>
          <TabsTrigger value="candidates">Candidates</TabsTrigger>
          <TabsTrigger value="rankings">Rankings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview job={job} /></TabsContent>
        <TabsContent value="questions"><QuestionsTab job={job} /></TabsContent>
        <TabsContent value="problems"><ProblemsTab job={job} /></TabsContent>
        <TabsContent value="candidates"><CandidatesTab job={job} openInvite={openInvite} onInviteHandled={onInviteHandled} /></TabsContent>
        <TabsContent value="rankings"><RankingsTab job={job} /></TabsContent>
      </Tabs>
    </>
  );
}

function Overview({ job }: { job: JobDto }) {
  const s = job.stats;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {s ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Invited" value={s.invited} />
            <Stat label="In progress" value={s.inProgress} />
            <Stat label="Completed" value={s.completed} />
            <Stat label="Avg score" value={s.averageScore ?? '—'} hint={`min ${job.minimumScore}`} />
          </div>
        ) : null}
        <Card>
          <CardHeader><CardTitle>Description</CardTitle></CardHeader>
          <CardContent><Markdown>{job.description}</Markdown></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Skills</CardTitle></CardHeader>
          <CardContent>
            {job.skills.length ? <div className="flex flex-wrap gap-1.5">{job.skills.map((sk) => <Badge key={sk} variant="brand">{sk}</Badge>)}</div> : <p className="text-sm text-muted">No skills listed.</p>}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Rubric</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {job.competencies.map((c) => (
              <div key={c.key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c.label}</span>
                  <span className="tabular-nums text-muted">{c.weight}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${c.weight}%` }} /></div>
                {c.description ? <p className="mt-1 text-xs text-muted">{c.description}</p> : null}
              </div>
            ))}
            <p className="pt-1 text-xs text-muted">Minimum weighted score: <strong>{job.minimumScore}</strong></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Interview plan · {planMinutes(job.interviewPlan)} min</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {job.interviewPlan.sections.map((sec, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium">{i + 1}</span>
                  <div>
                    <div className="font-medium">{sec.title} <span className="text-muted">· {sec.durationMinutes} min</span></div>
                    <div className="text-xs text-muted">
                      {sec.type === 'conversation' ? `${sec.questionCount} questions${sec.allowGeneratedQuestions ? ', AI follow-ups allowed' : ', bank only'}` : `${sec.problemIds.length} problem(s) · ${sec.languageIds.join(', ')}`}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted">Grace {job.interviewPlan.graceSeconds}s · complete within {job.interviewPlan.completionWindowDays} days of accepting</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Compliance</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted">Bias audit</span>{job.biasAuditUrl ? <a className="text-accent hover:underline" href={job.biasAuditUrl} target="_blank" rel="noreferrer">View summary</a> : <span className="text-muted">Not provided</span>}</div>
            <div className="flex justify-between"><span className="text-muted">Created</span><span>{fmtDate(job.createdAt, 'd MMM yyyy')}</span></div>
            <div className="flex justify-between"><span className="text-muted">Updated</span><span>{fmtDate(job.updatedAt, 'd MMM yyyy')}</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
