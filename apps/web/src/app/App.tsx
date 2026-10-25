import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui';
import { queryClient } from '@/lib/query';
import { refreshSession } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { router } from './router';
import { getTheme } from '@/lib/theme';

export function App() {
  const setBooting = useAuth((s) => s.setBooting);
  useEffect(() => {
    refreshSession().finally(() => setBooting(false));
  }, [setBooting]);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster richColors closeButton position="top-right" theme={getTheme()} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
