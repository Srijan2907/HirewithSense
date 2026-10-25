import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search, Users } from 'lucide-react';
import { INTERVIEW_STATUSES, type InterviewSummaryDto } from '@hws/shared';
import { EmptyState, Input, NativeSelect, PageHeader, PageLoader, StatusBadge, Table, Td, Th, Tooltip, Tr } from '@/components/ui';
import { get } from '@/lib/api';
import { qk } from '@/lib/query';
import { useDocumentTitle } from '@/lib/hooks';
import { DECISION_LABEL, RECOMMENDATION_LABEL, STATUS_LABEL, fmtDate } from '@/lib/utils';
import { Pagination, ScoreText } from './shared';

interface Page { items: InterviewSummaryDto[]; total: number; page: number; pageSize: number }

export default function InterviewsPage() {
  useDocumentTitle('Interviews');
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [sort, setSort] = useState<'recent' | 'score'>('recent');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '25', sort });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const jobId = sp.get('jobId');
  if (jobId) params.set('jobId', jobId);
  const query = useQuery({ queryKey: qk.interviews(params.toString()), queryFn: () => get<Page>(`/interviews?${params}`) });

  return (
    <>
      <PageHeader title="Interviews" description="Every candidate interview in your organization." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input placeholder="Search candidate name, email or job" className="pl-8" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search interviews" />
        </div>
        <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-44" aria-label="Status">
          <option value="">All statuses</option>
          {INTERVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'score')} className="sm:w-40" aria-label="Sort">
          <option value="recent">Most recent</option>
          <option value="score">Highest score</option>
        </NativeSelect>
      </div>

      {query.isLoading ? (
        <PageLoader />
      ) : !query.data?.items.length ? (
        <EmptyState icon={Users} title="No interviews found" description="Invite candidates from a job page to start interviews." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>Job</Th>
                <Th>Status</Th>
                <Th className="text-right">Score</Th>
                <Th>Recommendation</Th>
                <Th>Decision</Th>
                <Th className="text-center">Integrity</Th>
                <Th>Completed</Th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((i) => (
                <Tr key={i.id} className="cursor-pointer" onClick={() => nav(`/recruiter/interviews/${i.id}`)}>
                  <Td>
                    <div className="font-medium">{i.candidate.name}</div>
                    <div className="text-xs text-muted">{i.candidate.email}</div>
                  </Td>
                  <Td className="max-w-[14rem] truncate">{i.jobTitle}</Td>
                  <Td><StatusBadge status={i.status} label={STATUS_LABEL[i.status]} /></Td>
                  <Td className="text-right"><ScoreText score={i.weightedScore} /></Td>
                  <Td>{i.recommendation ? <StatusBadge status={i.recommendation} label={RECOMMENDATION_LABEL[i.recommendation] ?? i.recommendation} /> : <span className="text-muted">—</span>}</Td>
                  <Td>{i.decision ? <StatusBadge status={i.decision} label={DECISION_LABEL[i.decision] ?? i.decision} /> : <span className="text-muted">—</span>}</Td>
                  <Td className="text-center">
                    {i.integrityFlags > 0 ? (
                      <Tooltip content="Interface events recorded during the interview. Informational only; not part of the score.">
                        <span className="inline-flex items-center gap-1 text-warning tabular-nums"><AlertTriangle className="size-3.5" /> {i.integrityFlags}</span>
                      </Tooltip>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{fmtDate(i.completedAt)}</Td>
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
