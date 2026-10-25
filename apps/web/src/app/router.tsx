import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, useRouteError } from 'react-router';
import { Button, PageLoader } from '@/components/ui';
import { RedirectIfAuthed, RequireAuth } from './guards';
import { AppShell, FocusLayout, PublicLayout } from './layouts';

const lazyPage = (loader: () => Promise<{ default: React.ComponentType }>) => {
  const C = lazy(loader);
  return (
    <Suspense fallback={<PageLoader />}>
      <C />
    </Suspense>
  );
};

function RootError() {
  const err = useRouteError() as Error & { status?: number };
  return (
    <PublicLayout>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-semibold">{err?.status === 404 ? 'Page not found' : 'Something went wrong'}</h1>
        <p className="max-w-md text-sm text-muted">{err?.status === 404 ? 'The page you are looking for does not exist.' : err?.message ?? 'An unexpected error occurred.'}</p>
        <Button onClick={() => (window.location.href = '/')}>Go home</Button>
      </div>
    </PublicLayout>
  );
}

export const router = createBrowserRouter([
  {
    errorElement: <RootError />,
    children: [
      { path: '/', element: lazyPage(() => import('@/features/public/LandingPage')) },
      {
        element: (
          <PublicLayout>
            <Outlet />
          </PublicLayout>
        ),
        children: [
          {
            element: <RedirectIfAuthed />,
            children: [
              { path: '/login', element: lazyPage(() => import('@/features/auth/LoginPage')) },
              { path: '/register', element: lazyPage(() => import('@/features/auth/RegisterPage')) },
              { path: '/register/recruiter', element: lazyPage(() => import('@/features/auth/RegisterRecruiterPage')) },
              { path: '/forgot-password', element: lazyPage(() => import('@/features/auth/ForgotPasswordPage')) },
            ],
          },
          { path: '/reset-password', element: lazyPage(() => import('@/features/auth/ResetPasswordPage')) },
          { path: '/verify-email', element: lazyPage(() => import('@/features/auth/VerifyEmailPage')) },
          { path: '/invite/:token', element: lazyPage(() => import('@/features/auth/InvitePage')) },
          { path: '/join/:token', element: lazyPage(() => import('@/features/auth/JoinOrgPage')) },
        ],
      },
      {
        element: <RequireAuth role="candidate" />,
        children: [
          {
            element: <AppShell variant="candidate" />,
            children: [
              { path: '/app', element: lazyPage(() => import('@/features/candidate/CandidateDashboard')) },
              { path: '/app/profile', element: lazyPage(() => import('@/features/candidate/ProfilePage')) },
              { path: '/app/interviews/:id', element: lazyPage(() => import('@/features/candidate/InterviewLobbyPage')) },
              { path: '/app/interviews/:id/done', element: lazyPage(() => import('@/features/candidate/InterviewDonePage')) },
            ],
          },
          {
            element: <FocusLayout />,
            children: [
              { path: '/app/interviews/:id/room', element: lazyPage(() => import('@/features/interview/InterviewRoomPage')) },
              { path: '/app/interviews/:id/coding', element: lazyPage(() => import('@/features/coding/CodingRoomPage')) },
            ],
          },
        ],
      },
      {
        element: <RequireAuth role="recruiter" />,
        children: [
          {
            element: <AppShell variant="recruiter" />,
            children: [
              { path: '/recruiter', element: lazyPage(() => import('@/features/recruiter/DashboardPage')) },
              { path: '/recruiter/jobs', element: lazyPage(() => import('@/features/recruiter/JobsPage')) },
              { path: '/recruiter/jobs/new', element: lazyPage(() => import('@/features/recruiter/JobEditorPage')) },
              { path: '/recruiter/jobs/:id', element: lazyPage(() => import('@/features/recruiter/JobDetailPage')) },
              { path: '/recruiter/jobs/:id/edit', element: lazyPage(() => import('@/features/recruiter/JobEditorPage')) },
              { path: '/recruiter/interviews', element: lazyPage(() => import('@/features/recruiter/InterviewsPage')) },
              { path: '/recruiter/interviews/:id', element: lazyPage(() => import('@/features/recruiter/InterviewDetailPage')) },
              { path: '/recruiter/settings', element: lazyPage(() => import('@/features/recruiter/SettingsPage')) },
              { path: '/recruiter/integrations', element: lazyPage(() => import('@/features/recruiter/IntegrationsPage')) },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [{ element: <AppShell variant="recruiter" />, children: [{ path: '/dev/outbox', element: lazyPage(() => import('@/features/dev/OutboxPage')) }] }],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
