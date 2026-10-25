import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getDb } from '../src/db/client.js';
import { registerInlineHandlers } from '../src/jobs/index.js';

export async function createApp(): Promise<FastifyInstance> {
  registerInlineHandlers();
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function truncateAll(): Promise<void> {
  await getDb().execute(sql`
    truncate table audit_logs, email_outbox, decisions, reports, proctoring_events, code_submissions, code_drafts,
      transcript_events, interview_turns, consents, interviews, interview_invites, coding_problems, questions, jobs,
      resumes, auth_tokens, refresh_sessions, org_invites, memberships, organizations, users cascade
  `);
}

export interface Session {
  token: string;
  cookie: string;
  user: { id: string; email: string; role: string; organization: { id: string } | null };
}

function extractCookie(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(';')[0]!).join('; ');
}

export async function registerCandidate(app: FastifyInstance, n = 1, overrides: Record<string, string> = {}): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { name: `Candidate ${n}`, username: `cand${n}${Date.now().toString(36)}`, email: `cand${n}-${Date.now()}@example.com`, password: 'Sup3rSecretPass!', ...overrides },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  return { token: res.json().accessToken, cookie: extractCookie(res.headers['set-cookie']), user: res.json().user };
}

export async function registerRecruiter(app: FastifyInstance, n = 1): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register/recruiter',
    payload: { name: `Recruiter ${n}`, username: `rec${n}${Date.now().toString(36)}`, email: `rec${n}-${Date.now()}@example.com`, password: 'Sup3rSecretPass!', organizationName: `Acme ${n} ${Date.now()}` },
  });
  if (res.statusCode !== 201) throw new Error(`recruiter register failed: ${res.body}`);
  return { token: res.json().accessToken, cookie: extractCookie(res.headers['set-cookie']), user: res.json().user };
}

export const auth = (s: Session) => ({ authorization: `Bearer ${s.token}` });

export async function latestMail(to?: string): Promise<{ to: string; subject: string; text: string } | null> {
  const rows = await getDb().execute(sql`select "to", subject, text from email_outbox ${to ? sql`where "to" = ${to}` : sql``} order by created_at desc limit 1`);
  const r = (rows.rows as any[])[0];
  return r ?? null;
}
