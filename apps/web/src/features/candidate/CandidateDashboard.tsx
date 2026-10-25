import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock, FileText, Inbox } from 'lucide-react';
import type { InterviewSummaryDto, ResumeDto } from '@hws/shared';
import { Button, Card, CardContent, EmptyState, PageHeader, Skeleton, StatusBadge } from '@/components/ui';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { useDocumentTitle } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { STATUS_LABEL, fmtDate, fmtRelative } from '@/lib/utils';

const ACTIVE = new Set(['invited', 'ready', 'in_progress']);

function InterviewCard({ i }: { i: InterviewSummaryDto }) {
  const active = ACTIVE.has(i.status);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">{i.jobTitle}</h3>
            <StatusBadge status={i.status} label={STATUS_LABEL[i.status]} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> About {i.totalMinutes} minutes
            </span>
            {active && i.completeBy ? <span>Complete by {fmtDate(i.completeBy)}</span> : null}
            {!active && i.completedAt ? <span>Finished {fmtRelative(i.completedAt)}</span> : null}
          </div>
        </div>
        <Button asChild variant={active ? 'default' : 'outline'} className="shrink-0">
          <Link to={`/app/interviews/${i.id}${active ? '' : '/done'}`}>
            {i.status === 'in_progress' ? 'Resume' : active ? 'Open' : 'View'} <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function CandidateDashboard() {
  useDocumentTitle('My interviews');
  const user = useAuth((s) => s.user);
  const interviews = useQuery({ queryKey: qk.myInterviews, queryFn: () => get<InterviewSummaryDto[]>('/interviews/mine') });
  const resume = useQuery({ queryKey: qk.resume, queryFn: () => get<ResumeDto | null>('/resumes/me') });

  const upcoming = (interviews.data ?? []).filter((i) => ACTIVE.has(i.status));
  const past = (interviews.data ?? []).filter((i) => !ACTIVE.has(i.status));

  return (
    <div>
      <PageHeader title={`Hello, ${user?.name.split(' ')[0] ?? 'there'}`} description="Your interviews and resume in one place." />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Ready to start or in progress</h2>
            {interviews.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            ) : upcoming.length ? (
              <div className="space-y-3">{upcoming.map((i) => <InterviewCard key={i.id} i={i} />)}</div>
            ) : (
              <EmptyState icon={Inbox} title="No pending interviews" description="When an employer invites you, the interview appears here. Accept invitations from the link in your email." />
            )}
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Completed</h2>
            {interviews.isPending ? (
              <Skeleton className="h-20" />
            ) : past.length ? (
              <div className="space-y-3">{past.map((i) => <InterviewCard key={i.id} i={i} />)}</div>
            ) : (
              <p className="text-sm text-muted">Nothing completed yet.</p>
            )}
          </section>
        </div>
        <aside>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 font-semibold">
                <FileText className="size-4 text-accent" /> Resume
              </div>
              {resume.isPending ? (
                <Skeleton className="mt-3 h-12" />
              ) : resume.data ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="truncate" title={resume.data.originalName}>
                    {resume.data.originalName}
                  </div>
                  <div className="flex items-center gap-2 text-muted">
                    <StatusBadge status={resume.data.parseStatus} />
                    <span>{fmtRelative(resume.data.updatedAt)}</span>
                  </div>
                  {resume.data.profile?.skills.length ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {resume.data.profile.skills.slice(0, 8).map((s) => (
                        <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">Upload your resume so the interviewer can ask about your real experience.</p>
              )}
              <Button asChild variant="outline" size="sm" className="mt-4 w-full">
                <Link to="/app/profile">{resume.data ? 'Manage resume' : 'Upload resume'}</Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
