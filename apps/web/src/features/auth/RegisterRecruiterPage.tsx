import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { RegisterRecruiterBody, type AuthResponse } from '@hws/shared';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui';
import { adoptSession, post } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage } from '@/lib/query';
import { AuthCard } from './AuthCard';

type Values = z.input<typeof RegisterRecruiterBody>;

export default function RegisterRecruiterPage() {
  useDocumentTitle('Recruiter sign-up');
  const nav = useNavigate();
  const form = useForm<Values>({ resolver: zodResolver(RegisterRecruiterBody), defaultValues: { name: '', username: '', email: '', password: '', organizationName: '' } });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const data = await post<AuthResponse>('/auth/register/recruiter', values, { anonymous: true });
      adoptSession(data);
      toast.success(`Welcome! ${data.user.organization?.name ?? 'Your organization'} is ready.`);
      nav('/recruiter', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <AuthCard
      title="Set up your hiring workspace"
      description="Create an organization, define roles and rubrics, and invite candidates."
      footer={
        <>
          Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>. Candidate?{' '}
          <Link to="/register" className="text-accent hover:underline">Create a candidate account</Link>.
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Organization name" htmlFor="organizationName" error={e.organizationName?.message}>
          <Input id="organizationName" autoComplete="organization" aria-invalid={Boolean(e.organizationName)} {...form.register('organizationName')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="name" error={e.name?.message}>
            <Input id="name" autoComplete="name" aria-invalid={Boolean(e.name)} {...form.register('name')} />
          </Field>
          <Field label="Username" htmlFor="username" error={e.username?.message}>
            <Input id="username" autoComplete="username" aria-invalid={Boolean(e.username)} {...form.register('username')} />
          </Field>
        </div>
        <Field label="Work email" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(e.email)} {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters." error={e.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={Boolean(e.password)} {...form.register('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create workspace
        </Button>
      </form>
    </AuthCard>
  );
}
