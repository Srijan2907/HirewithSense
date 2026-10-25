import { Navigate, Outlet, useLocation } from 'react-router';
import { PageLoader } from '@/components/ui';
import { homeFor, isRecruiter, useAuth } from '@/lib/auth-store';

export function RequireAuth({ role }: { role?: 'candidate' | 'recruiter' }) {
  const { user, booting } = useAuth();
  const loc = useLocation();
  if (booting) return <PageLoader label="Signing you in…" />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (role === 'recruiter' && !isRecruiter(user)) return <Navigate to={homeFor(user)} replace />;
  if (role === 'candidate' && isRecruiter(user)) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}

export function RedirectIfAuthed() {
  const { user, booting } = useAuth();
  if (booting) return <PageLoader />;
  if (user) return <Navigate to={homeFor(user)} replace />;
  return <Outlet />;
}
