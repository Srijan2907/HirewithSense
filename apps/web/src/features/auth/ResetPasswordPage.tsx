import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ResetPasswordBody } from '@hws/shared';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage } from '@/lib/query';
import { AuthCard } from './AuthCard';

type Values = z.input<typeof ResetPasswordBody>;

export default function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') ?? '';
  const [confirm, setConfirm] = useState('');
  const form = useForm<Values>({ resolver: zodResolver(ResetPasswordBody), defaultValues: { token, password: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    if (values.password !== confirm) {
      form.setError('password', { message: 'Passwords do not match' });
      return;
    }
    try {
      await post('/auth/reset-password', values, { anonymous: true });
      toast.success('Password updated. Please sign in.');
      nav('/login', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return (
      <AuthCard title="Invalid reset link" description="This link is missing or malformed.">
        <Button asChild className="w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="Your other sessions will be signed out.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <input type="hidden" {...form.register('token')} />
        <Field label="New password" htmlFor="password" hint="At least 10 characters." error={form.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={Boolean(form.formState.errors.password)} {...form.register('password')} />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm">
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
