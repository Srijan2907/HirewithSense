import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { AI_DISCLOSURE_VERSION } from '@hws/shared';
import { getDb } from '../src/db/client.js';
import { interviews, organizations, interviewTurns } from '../src/db/schema.js';
import { expireInterviewsJob, retentionPurgeJob } from '../src/jobs/index.js';
import { auth, createApp, latestMail, registerRecruiter, truncateAll, type Session } from './helpers.js';

let app: FastifyInstance;
let recruiter: Session;
let jobId: string;

beforeAll(async () => {
  app = await createApp();
  await truncateAll();
  recruiter = await registerRecruiter(app, 30);
  const job = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs',
    headers: auth(recruiter),
    payload: {
      title: 'Sweep role',
      description: 'A role used to test the expiry sweep and retention purge.',
      competencies: [
        { key: 'technical_knowledge', label: 'Tech', weight: 60 },
        { key: 'communication', label: 'Comms', weight: 40 },
      ],
      interviewPlan: { sections: [{ type: 'conversation', title: 'Chat', durationMinutes: 5, questionCount: 2, allowGeneratedQuestions: true }], graceSeconds: 0, completionWindowDays: 1 },
    },
  });
  if (job.statusCode !== 201) throw new Error(`job create failed: ${job.body}`);
  jobId = job.json().id;
  const open = await app.inject({ method: 'PATCH', url: `/api/v1/jobs/${jobId}`, headers: auth(recruiter), payload: { status: 'open' } });
  if (open.statusCode !== 200) throw new Error(`job open failed: ${open.body}`);
});
afterAll(async () => app.close());

async function inviteAndStart(email: string): Promise<{ candidate: Session; interviewId: string }> {
  const inv = await app.inject({ method: 'POST', url: `/api/v1/invites/jobs/${jobId}`, headers: auth(recruiter), payload: { email } });
  if (inv.statusCode !== 201) throw new Error(`invite failed: ${inv.body}`);
  const mail = await latestMail(email);
  const token = mail!.text.match(/invite\/([a-f0-9]{64})/)![1]!;
  const accept = await app.inject({ method: 'POST', url: '/api/v1/invites/accept', payload: { token, name: 'Sweep Cand', username: `sweep${Date.now().toString(36)}`, password: 'SweepPass12345!' } });
  const candidate: Session = { token: accept.json().accessToken, cookie: '', user: accept.json().user };
  const interviewId = accept.json().interviewId as string;
  await app.inject({ method: 'POST', url: `/api/v1/interviews/${interviewId}/consent`, headers: auth(candidate), payload: { disclosureVersion: AI_DISCLOSURE_VERSION, accepted: true } });
  await app.inject({ method: 'POST', url: `/api/v1/interviews/${interviewId}/start`, headers: auth(candidate) });
  return { candidate, interviewId };
}

describe('deadlines and background sweeps', () => {
  it('rejects writes after the section deadline and the sweep closes the interview with a report', async () => {
    const { candidate, interviewId } = await inviteAndStart('late@example.com');
    const q = await app.inject({ method: 'POST', url: `/api/v1/interviews/${interviewId}/next-question`, headers: auth(candidate) });
    const turn = q.body.split('\n\n').map((l) => l.replace(/^data: /, '')).filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'question').turn;

    // Travel time: push every deadline into the past.
    const past = new Date(Date.now() - 10 * 60_000);
    const [row] = await getDb().select().from(interviews).where(eq(interviews.id, interviewId));
    await getDb()
      .update(interviews)
      .set({ overallDeadline: past, sections: row!.sections.map((s) => ({ ...s, deadline: past.toISOString() })) })
      .where(eq(interviews.id, interviewId));

    const late = await app.inject({ method: 'POST', url: `/api/v1/interviews/${interviewId}/answers`, headers: auth(candidate), payload: { turnId: turn.id, answer: 'Too late to count.', inputMode: 'text' } });
    expect(late.statusCode).toBe(410);

    await expireInterviewsJob({ info: () => {} });
    const after = await app.inject({ method: 'GET', url: `/api/v1/interviews/${interviewId}`, headers: auth(candidate) });
    expect(after.json().status).toBe('completed');
    const detail = await app.inject({ method: 'GET', url: `/api/v1/interviews/${interviewId}/detail`, headers: auth(recruiter) });
    expect(detail.json().report.recommendation).toBe('insufficient_evidence');
    expect(detail.json().transcript.some((t: any) => /Time limit reached/.test(t.text))).toBe(true);
  });

  it('expires unopened interviews and pending invites past their window', async () => {
    await app.inject({ method: 'POST', url: `/api/v1/invites/jobs/${jobId}`, headers: auth(recruiter), payload: { email: 'never@example.com', expiresInDays: 1 } });
    await getDb().execute(sql`update interview_invites set expires_at = now() - interval '1 day' where email = 'never@example.com'`);
    await expireInterviewsJob({ info: () => {} });
    const invites = await app.inject({ method: 'GET', url: `/api/v1/invites/jobs/${jobId}`, headers: auth(recruiter) });
    expect(invites.json().find((i: any) => i.email === 'never@example.com').status).toBe('expired');
  });

  it('purges interview content past the organization retention period', async () => {
    const { interviewId } = await inviteAndStart('purge@example.com');
    const [org] = await getDb().select().from(organizations).limit(1);
    await getDb().update(organizations).set({ retentionDays: 30 }).where(eq(organizations.id, org!.id));
    await getDb().update(interviews).set({ status: 'completed', createdAt: new Date(Date.now() - 60 * 86_400_000) }).where(eq(interviews.id, interviewId));
    await retentionPurgeJob({ info: () => {} });
    const turns = await getDb().select().from(interviewTurns).where(eq(interviewTurns.interviewId, interviewId));
    expect(turns).toHaveLength(0);
    const detail = await app.inject({ method: 'GET', url: `/api/v1/interviews/${interviewId}/detail`, headers: auth(recruiter) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().turns).toHaveLength(0);
  });
});
