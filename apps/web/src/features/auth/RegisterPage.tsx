import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { RegisterCandidateBody, type AuthResponse } from '@hws/shared';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui';
import { adoptSession, post } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage } from '@/lib/query';
import { AuthCard } from './AuthCard';

type Values = z.input<typeof RegisterCandidateBody>;

export default function RegisterPage() {
  useDocumentTitle('Create account');
  const nav = useNavigate();
  const form = useForm<Values>({ resolver: zodResolver(RegisterCandidateBody), defaultValues: { name: '', username: '', email: '', password: '' } });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const data = await post<AuthResponse>('/auth/register', values, { anonymous: true });
      adoptSession(data);
      toast.success('Account created. Check your inbox to verify your email.');
      nav('/app', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <AuthCard
      title="Create your candidate account"
      description="Upload your resume once and take interviews from your browser."
      footer={
        <>
          Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>. Hiring?{' '}
          <Link to="/register/recruiter" className="text-accent hover:underline">Recruiter sign-up</Link>.
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="name" error={e.name?.message}>
          <Input id="name" autoComplete="name" aria-invalid={Boolean(e.name)} {...form.register('name')} />
        </Field>
        <Field label="Username" htmlFor="username" hint="3–30 characters: letters, numbers, dot, dash, underscore." error={e.username?.message}>
          <Input id="username" autoComplete="username" aria-invalid={Boolean(e.username)} {...form.register('username')} />
        </Field>
        <Field label="Email" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(e.email)} {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters." error={e.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={Boolean(e.password)} {...form.register('password')} />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
