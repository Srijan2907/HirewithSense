import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ForgotPasswordBody } from '@hws/shared';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage } from '@/lib/query';
import { AuthCard } from './AuthCard';

type Values = z.input<typeof ForgotPasswordBody>;

export default function ForgotPasswordPage() {
  useDocumentTitle('Forgot password');
  const [sent, setSent] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(ForgotPasswordBody), defaultValues: { email: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await post('/auth/forgot-password', values, { anonymous: true });
      setSent(true);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we will send a one-time reset link."
      footer={
        <Link to="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-md bg-surface-2 p-4 text-sm" role="status" aria-live="polite">
          If an account exists for that email, reset instructions have been sent. The link expires in 30 minutes.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(form.formState.errors.email)} {...form.register('email')} />
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
