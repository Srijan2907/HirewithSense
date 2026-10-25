import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { LoginBody, type LoginBody as LoginValues } from '@hws/shared';
import { Button, Field, Input } from '@/components/ui';
import { login } from '@/lib/api';
import { homeFor } from '@/lib/auth-store';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage } from '@/lib/query';
import { AuthCard } from './AuthCard';

export default function LoginPage() {
  useDocumentTitle('Sign in');
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const form = useForm<LoginValues>({ resolver: zodResolver(LoginBody), defaultValues: { email: '', password: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const data = await login(values.email, values.password);
      nav(loc.state?.from ?? homeFor(data.user), { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your HireWithSense account."
      footer={
        <>
          New here? <Link to="/register" className="text-accent hover:underline">Create a candidate account</Link> or{' '}
          <Link to="/register/recruiter" className="text-accent hover:underline">sign up as a recruiter</Link>.
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register('password')} />
        </Field>
        <div className="flex items-center justify-between text-sm">
          <Link to="/forgot-password" className="text-accent hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
