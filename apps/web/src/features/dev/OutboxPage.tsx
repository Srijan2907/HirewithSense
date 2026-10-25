import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, RefreshCw } from 'lucide-react';
import type { OutboxMailDto } from '@hws/shared';
import { Button, EmptyState, PageHeader, Skeleton, StatusBadge } from '@/components/ui';
import { get } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { qk } from '@/lib/query';
import { cn, fmtRelative } from '@/lib/utils';

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} className="break-all text-accent underline" target={p.startsWith(window.location.origin) ? undefined : '_blank'} rel="noreferrer">
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export default function OutboxPage() {
  useDocumentTitle('Dev mailbox');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: qk.outbox, queryFn: () => get<OutboxMailDto[]>('/admin/outbox?limit=100'), refetchInterval: 5000 });

  return (
    <div>
      <PageHeader
        title="Development mailbox"
        description="Emails are stored instead of being sent. Open a message to follow its links (invitations, password resets)."
        actions={
          <Button variant="outline" size="sm" onClick={() => q.refetch()} loading={q.isFetching}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      {q.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon={Mail} title="No emails yet" description="Invite a candidate or request a password reset to see messages here." />
      ) : (
        <ul className="divide-y rounded-lg border bg-surface">
          {q.data.map((m) => {
            const open = openId === m.id;
            return (
              <li key={m.id}>
                <button type="button" onClick={() => setOpenId(open ? null : m.id)} aria-expanded={open} className={cn('flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-4 cursor-pointer')}>
                  <span className="w-56 shrink-0 truncate text-sm text-muted">{m.to}</span>
                  <span className="flex-1 truncate text-sm font-medium">{m.subject}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    <StatusBadge status={m.status === 'sent' ? 'completed' : m.status} label={m.status} />
                    {fmtRelative(m.createdAt)}
                  </span>
                </button>
                {open ? (
                  <div className="grid gap-4 border-t bg-surface-2/50 p-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-medium uppercase text-muted">Text</div>
                      <pre className="whitespace-pre-wrap rounded-md border bg-surface p-3 font-sans text-sm leading-relaxed">{linkify(m.text)}</pre>
                      {m.error ? <p className="mt-2 text-xs text-danger">Error: {m.error}</p> : null}
                    </div>
                    {m.html ? (
                      <div>
                        <div className="mb-1 text-xs font-medium uppercase text-muted">HTML preview</div>
                        <iframe title={`Email ${m.subject}`} sandbox="" srcDoc={m.html} className="h-80 w-full rounded-md border bg-white" />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
