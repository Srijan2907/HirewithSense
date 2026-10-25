import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, UserCheck } from 'lucide-react';
import type { InterviewDto } from '@hws/shared';
import { Button, Card, CardContent, PageLoader, StatusBadge } from '@/components/ui';
import { get } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { STATUS_LABEL, fmtDate } from '@/lib/utils';

export default function InterviewDonePage() {
  useDocumentTitle('Interview complete');
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: qk.interview(id), queryFn: () => get<InterviewDto>(`/interviews/${id}`) });
  if (q.isPending) return <PageLoader />;
  if (q.isError || !q.data) return <p className="text-sm text-muted">Interview not found.</p>;
  const i = q.data;
  const expired = i.status === 'expired';
  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <Card>
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            {expired ? <Clock className="size-7" /> : <CheckCircle2 className="size-7" />}
          </div>
          <h1 className="text-2xl font-semibold">{expired ? 'Time ran out, but your work was saved' : 'Thank you — your interview is complete'}</h1>
          <p className="mt-2 text-muted">
            {i.jobTitle} at {i.organizationName}
          </p>
          <div className="mt-3 flex justify-center">
            <StatusBadge status={i.status} label={STATUS_LABEL[i.status]} />
          </div>
          <div className="mt-8 space-y-4 text-left text-sm">
            <div className="flex gap-3 rounded-md border bg-surface-2 p-4">
              <UserCheck className="mt-0.5 size-5 shrink-0 text-accent" />
              <div>
                <div className="font-medium">What happens next</div>
                <p className="mt-1 text-muted">
                  A recruiter at {i.organizationName} will review the transcript, your code and the AI-generated report. No decision is made automatically — a person
                  reads your interview and decides how to proceed. They will contact you directly about next steps.
                </p>
              </div>
            </div>
            <p className="text-muted">
              Submitted {fmtDate(i.submittedAt ?? i.completedAt)}. You can request a copy of your data, an explanation of the evaluation, or deletion of your
              interview by contacting the employer.
            </p>
          </div>
          <Button asChild className="mt-8">
            <Link to="/app">Back to my interviews</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
