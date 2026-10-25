import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
  queryCache: new QueryCache({
    onError: (err, query) => {
      if (query.meta?.silent) return;
      if (isApiError(err) && (err.status === 401 || err.status === 403)) return;
      toast.error(errorMessage(err));
    },
  }),
  mutationCache: new MutationCache({
    onError: (err, _v, _c, mutation) => {
      if (mutation.meta?.silent) return;
      toast.error(errorMessage(err));
    },
  }),
});

export function errorMessage(err: unknown): string {
  if (isApiError(err)) {
    if (err.code === 'validation_error' && Array.isArray(err.details)) {
      const first = (err.details as { path: string; message: string }[])[0];
      return first ? `${first.path ? first.path.replace(/^\//, '') + ': ' : ''}${first.message}` : err.message;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

export const qk = {
  me: ['me'] as const,
  resume: ['resume'] as const,
  myInterviews: ['interviews', 'mine'] as const,
  interview: (id: string) => ['interview', id] as const,
  room: (id: string) => ['interview', id, 'room'] as const,
  coding: (id: string) => ['interview', id, 'coding'] as const,
  submission: (id: string, sid: string) => ['interview', id, 'submission', sid] as const,
  disclosure: ['disclosure'] as const,
  jobs: (params?: unknown) => ['jobs', params] as const,
  job: (id: string) => ['job', id] as const,
  questions: (id: string) => ['job', id, 'questions'] as const,
  problems: (id: string) => ['job', id, 'problems'] as const,
  invites: (id: string) => ['job', id, 'invites'] as const,
  rankings: (id: string) => ['job', id, 'rankings'] as const,
  interviews: (params?: unknown) => ['interviews', params] as const,
  detail: (id: string) => ['interview', id, 'detail'] as const,
  dashboard: ['dashboard'] as const,
  org: ['org'] as const,
  members: ['org', 'members'] as const,
  orgInvites: ['org', 'invites'] as const,
  aiStatus: ['ai', 'status'] as const,
  outbox: ['outbox'] as const,
  audit: ['audit'] as const,
  sessions: ['sessions'] as const,
  languages: ['languages'] as const,
};
