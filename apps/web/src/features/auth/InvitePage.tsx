import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, MessageSquare, Code2, Building2 } from 'lucide-react';
import type { AuthResponse, InvitePreview } from '@hws/shared';
import { Button, Field, Input, PageLoader } from '@/components/ui';
import { adoptSession, get, isApiError, post } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage } from '@/lib/query';
import { fmtDate } from '@/lib/utils';
import { AuthCard } from './AuthCard';

interface AcceptValues {
  name: string;
  username: string;
  password: string;
}

export default function InvitePage() {
  useDocumentTitle('Interview invitation');
  const { token = '' } = useParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => get<InvitePreview>(`/invites/${token}`, { anonymous: true }),
    retry: false,
    meta: { silent: true },
  });
  const form = useForm<AcceptValues>({ defaultValues: { name: preview.data?.candidateName ?? '', username: '', password: '' } });

  async function accept(extra?: AcceptValues) {
    setBusy(true);
    try {
      const data = await post<AuthResponse & { interviewId: string }>('/invites/accept', { token, ...extra }, { anonymous: true });
      adoptSession(data);
      nav(`/app/interviews/${data.interviewId}`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (preview.isPending) return <PageLoader label="Loading invitation…" />;
  if (preview.isError) {
    const err = preview.error;
    const gone = isApiError(err) && err.status === 410;
    return (
      <AuthCard title={gone ? 'Invitation no longer valid' : 'Invitation not found'} description={errorMessage(err)}>
        <Button asChild className="w-full" variant="outline">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }
  const p = preview.data;

  return (
    <AuthCard title={`Interview for ${p.jobTitle}`} description={`${p.organizationName} has invited you to an AI-assisted interview.`}>
      <div className="space-y-5">
        <div className="rounded-md border bg-surface-2 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <Building2 className="size-4 text-muted" /> {p.organizationName}
          </div>
          {p.message ? <blockquote className="mt-3 border-l-2 pl-3 text-muted">{p.message}</blockquote> : null}
          <ul className="mt-3 space-y-1.5">
            {p.sections.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {s.type === 'coding' ? <Code2 className="size-4 text-muted" /> : <MessageSquare className="size-4 text-muted" />}
                  {s.title}
                </span>
                <span className="text-muted">{s.durationMinutes} min</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t pt-3">
            <span className="flex items-center gap-2 text-muted">
              <Clock className="size-4" /> Total
            </span>
            <span className="font-medium">{p.totalMinutes} min</span>
          </div>
          <p className="mt-3 text-xs text-muted">Invitation for {p.email}. Expires {fmtDate(p.expiresAt)}.</p>
        </div>

        {p.accountExists ? (
          <Button className="w-full" loading={busy} onClick={() => accept()}>
            {p.interviewId ? 'Continue to interview' : 'Accept invitation'}
          </Button>
        ) : (
          <form onSubmit={form.handleSubmit((v) => accept(v))} className="space-y-4" noValidate>
            <p className="text-sm text-muted">Create your candidate account to accept.</p>
            <Field label="Full name" htmlFor="name" error={form.formState.errors.name?.message}>
              <Input id="name" autoComplete="name" {...form.register('name', { required: 'Name is required' })} />
            </Field>
            <Field label="Username" htmlFor="username" hint="3–30 characters: letters, numbers, dot, dash, underscore." error={form.formState.errors.username?.message}>
              <Input id="username" autoComplete="username" {...form.register('username', { required: 'Username is required', pattern: { value: /^[a-zA-Z0-9_.-]{3,30}$/, message: 'Invalid username' } })} />
            </Field>
            <Field label="Password" htmlFor="password" hint="At least 10 characters." error={form.formState.errors.password?.message}>
              <Input id="password" type="password" autoComplete="new-password" {...form.register('password', { required: 'Password is required', minLength: { value: 10, message: 'Use at least 10 characters' } })} />
            </Field>
            <Button type="submit" className="w-full" loading={busy}>
              Create account & accept
            </Button>
          </form>
        )}
      </div>
    </AuthCard>
  );
}
