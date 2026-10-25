import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Plus, Search } from 'lucide-react';
import { JOB_STATUSES, type JobDto } from '@hws/shared';
import { Button, EmptyState, Input, NativeSelect, PageHeader, PageLoader, StatusBadge, Table, Td, Th, Tr } from '@/components/ui';
import { get } from '@/lib/api';
import { qk } from '@/lib/query';
import { useDocumentTitle } from '@/lib/hooks';
import { STATUS_LABEL, fmtRelative } from '@/lib/utils';
import { Pagination, ScoreText, planSummary } from './shared';

interface Page { items: JobDto[]; total: number; page: number; pageSize: number }

export default function JobsPage() {
  useDocumentTitle('Jobs');
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const query = useQuery({ queryKey: qk.jobs(params.toString()), queryFn: () => get<Page>(`/jobs?${params}`) });

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Roles your organization is interviewing for."
        actions={
          <Button asChild>
            <Link to="/recruiter/jobs/new">
              <Plus /> New job
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input placeholder="Search by title or department" className="pl-8" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search jobs" />
        </div>
        <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-44" aria-label="Filter by status">
          <option value="">All statuses</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </NativeSelect>
      </div>

      {query.isLoading ? (
        <PageLoader />
      ) : !query.data?.items.length ? (
        <EmptyState icon={Briefcase} title={q || status ? 'No jobs match' : 'No jobs yet'} description={q || status ? 'Try a different search or filter.' : 'Create your first job to configure a rubric, questions and coding problems.'} action={!q && !status ? <Button asChild><Link to="/recruiter/jobs/new">Create a job</Link></Button> : undefined} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Status</Th>
                <Th>Interview plan</Th>
                <Th className="text-right">Invited</Th>
                <Th className="text-right">In progress</Th>
                <Th className="text-right">Completed</Th>
                <Th className="text-right">Avg score</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((j) => (
                <Tr key={j.id} className="cursor-pointer" onClick={() => nav(`/recruiter/jobs/${j.id}`)}>
                  <Td>
                    <div className="font-medium">{j.title}</div>
                    <div className="text-xs text-muted">{[j.department, j.location].filter(Boolean).join(' · ') || '—'}</div>
                  </Td>
                  <Td><StatusBadge status={j.status} label={STATUS_LABEL[j.status]} /></Td>
                  <Td className="text-muted">{planSummary(j.interviewPlan)}</Td>
                  <Td className="text-right tabular-nums">{j.stats?.invited ?? 0}</Td>
                  <Td className="text-right tabular-nums">{j.stats?.inProgress ?? 0}</Td>
                  <Td className="text-right tabular-nums">{j.stats?.completed ?? 0}</Td>
                  <Td className="text-right"><ScoreText score={j.stats?.averageScore} /></Td>
                  <Td className="text-muted whitespace-nowrap">{fmtRelative(j.updatedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
