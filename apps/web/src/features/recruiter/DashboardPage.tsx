import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Briefcase, UserPlus } from 'lucide-react';
import type { RecruiterDashboard } from '@hws/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, PageLoader, Stat, StatusBadge } from '@/components/ui';
import { get } from '@/lib/api';
import { qk } from '@/lib/query';
import { useAuth } from '@/lib/auth-store';
import { useDocumentTitle } from '@/lib/hooks';
import { RECOMMENDATION_LABEL, STATUS_LABEL, fmtRelative } from '@/lib/utils';
import { ScoreText } from './shared';

export default function DashboardPage() {
  useDocumentTitle('Dashboard');
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: qk.dashboard, queryFn: () => get<RecruiterDashboard>('/admin/dashboard') });
  if (q.isLoading) return <PageLoader />;
  const d = q.data;
  if (!d) return <EmptyState title="Dashboard unavailable" description="Could not load organization metrics." />;
  const maxBucket = Math.max(1, ...d.scoreDistribution.map((b) => b.count));

  return (
    <>
      <PageHeader
        eyebrow={user?.organization?.name}
        title={`Welcome back, ${user?.name.split(' ')[0] ?? 'there'}`}
        description="Pipeline overview across all jobs in your organization."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/recruiter/jobs">
                <UserPlus /> Invite candidates
              </Link>
            </Button>
            <Button asChild>
              <Link to="/recruiter/jobs/new">
                <Briefcase /> New job
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open jobs" value={d.jobs.open} hint={`${d.jobs.draft} draft · ${d.jobs.total} total`} />
        <Stat label="Invited" value={d.interviews.invited} hint="Not yet started" />
        <Stat label="In progress" value={d.interviews.inProgress} hint="Live right now" tone={d.interviews.inProgress ? 'warning' : undefined} />
        <Stat label="Awaiting review" value={d.interviews.awaitingReview} hint="Finished, no decision yet" tone={d.interviews.awaitingReview ? 'warning' : undefined} />
        <Stat label="Completed" value={d.interviews.completed} hint={`${d.interviews.total} interviews total`} />
        <Stat label="Average score" value={d.averageScore === null ? '—' : d.averageScore} hint="Weighted, across ready reports" />
        <Stat label="Completion rate" value={d.completionRate === null ? '—' : `${d.completionRate}%`} hint="Finished ÷ invited" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Latest interview updates</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/recruiter/interviews">
                View all <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {d.recent.length === 0 ? (
              <EmptyState title="No interviews yet" description="Create a job and invite candidates to see activity here." action={<Button asChild size="sm"><Link to="/recruiter/jobs/new">Create a job</Link></Button>} />
            ) : (
              <ul className="divide-y">
                {d.recent.map((r) => (
                  <li key={r.interviewId}>
                    <Link to={`/recruiter/interviews/${r.interviewId}`} className="flex items-center gap-3 py-3 hover:bg-surface-2/60 -mx-2 px-2 rounded-md">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{r.candidateName}</div>
                        <div className="truncate text-xs text-muted">{r.jobTitle}</div>
                      </div>
                      <div className="hidden text-xs text-muted sm:block">{r.recommendation ? RECOMMENDATION_LABEL[r.recommendation] ?? r.recommendation : null}</div>
                      <ScoreText score={r.weightedScore} />
                      <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} />
                      <span className="w-24 text-right text-xs text-muted">{fmtRelative(r.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Score distribution</CardTitle>
            <CardDescription>Weighted scores of ready reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {d.scoreDistribution.map((b) => (
                <div key={b.bucket}>
                  <div className="mb-1 flex justify-between text-xs text-muted">
                    <span>{b.bucket}</span>
                    <span className="tabular-nums">{b.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-2">
                    <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${(b.count / maxBucket) * 100}%` }} />
                  </div>
                </div>
              ))}
              {d.scoreDistribution.every((b) => b.count === 0) ? <p className="text-xs text-muted">No scored interviews yet.</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
