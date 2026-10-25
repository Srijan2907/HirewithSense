import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button, Spinner } from '@/components/ui';
import { post } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth-store';
import { useDocumentTitle } from '@/lib/hooks';
import { errorMessage } from '@/lib/query';
import { AuthCard } from './AuthCard';

export default function VerifyEmailPage() {
  useDocumentTitle('Verify email');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const user = useAuth((s) => s.user);
  const [state, setState] = useState<{ status: 'pending' | 'ok' | 'error'; message?: string }>({ status: 'pending' });

  useEffect(() => {
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      setState({ status: 'error', message: 'This verification link is missing or malformed.' });
      return;
    }
    post('/auth/verify-email', { token }, { anonymous: true })
      .then(() => setState({ status: 'ok' }))
      .catch((err) => setState({ status: 'error', message: errorMessage(err) }));
  }, [token]);

  return (
    <AuthCard title="Email verification">
      <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
        {state.status === 'pending' ? (
          <>
            <Spinner className="size-6" />
            <p className="text-sm text-muted">Verifying your email…</p>
          </>
        ) : state.status === 'ok' ? (
          <>
            <CheckCircle2 className="size-10 text-success" />
            <p className="text-sm">Your email address is verified. Thank you!</p>
          </>
        ) : (
          <>
            <XCircle className="size-10 text-danger" />
            <p className="text-sm">{state.message}</p>
          </>
        )}
        <Button asChild className="w-full">
          <Link to={homeFor(user)}>{user ? 'Continue' : 'Go to sign in'}</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
