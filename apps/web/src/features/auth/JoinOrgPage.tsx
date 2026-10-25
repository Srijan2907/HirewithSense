import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AuthResponse, OrgInvitePreview } from '@hws/shared';
import { z } from 'zod';
import { Button, Field, Input, PageLoader } from '@/components/ui';
import { adoptSession, get, post } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage, queryClient } from '@/lib/query';
import { fmtDate } from '@/lib/utils';
import { AuthCard } from './AuthCard';

type Preview = z.infer<typeof OrgInvitePreview>;
interface Values {
  name: string;
  username: string;
  password: string;
}

export default function JoinOrgPage() {
  useDocumentTitle('Join organization');
  const { token = '' } = useParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const preview = useQuery({ queryKey: ['org-invite', token], queryFn: () => get<Preview>(`/orgs/join/${token}`, { anonymous: true }), retry: false, meta: { silent: true } });
  const form = useForm<Values>({ defaultValues: { name: '', username: '', password: '' } });

  async function join(extra?: Values) {
    setBusy(true);
    try {
      const data = await post<AuthResponse>('/orgs/join', { token, ...extra }, { anonymous: true });
      adoptSession(data);
      queryClient.clear();
      toast.success(`You joined ${data.user.organization?.name ?? 'the organization'}.`);
      nav('/recruiter', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (preview.isPending) return <PageLoader label="Loading invitation…" />;
  if (preview.isError) {
    return (
      <AuthCard title="Invitation not found" description={errorMessage(preview.error)}>
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthCard>
    );
  }
  const p = preview.data;
  return (
    <AuthCard title={`Join ${p.organizationName}`} description={`You were invited as ${p.role} for ${p.email}. Expires ${fmtDate(p.expiresAt)}.`}>
      {p.accountExists ? (
        <Button className="w-full" loading={busy} onClick={() => join()}>
          Join organization
        </Button>
      ) : (
        <form onSubmit={form.handleSubmit((v) => join(v))} className="space-y-4" noValidate>
          <p className="text-sm text-muted">Create your recruiter account to join.</p>
          <Field label="Full name" htmlFor="name" error={form.formState.errors.name?.message}>
            <Input id="name" autoComplete="name" {...form.register('name', { required: 'Name is required' })} />
          </Field>
          <Field label="Username" htmlFor="username" error={form.formState.errors.username?.message}>
            <Input id="username" autoComplete="username" {...form.register('username', { required: 'Username is required', pattern: { value: /^[a-zA-Z0-9_.-]{3,30}$/, message: 'Invalid username' } })} />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 10 characters." error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...form.register('password', { required: 'Password is required', minLength: { value: 10, message: 'Use at least 10 characters' } })} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            Create account & join
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
