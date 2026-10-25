import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { getDb } from '../db/client.js';
import { interviews, interviewInvites, organizations, resumes, codeSubmissions, interviewTurns, transcriptEvents, proctoringEvents, reports } from '../db/schema.js';
import { QUEUES, getBoss, recordJob, setJobLogger, stopBoss, type QueueName } from './boss.js';
import { getHandler, registerHandler } from './workers.js';
import { gradeSubmissionJob } from '../modules/coding/service.js';
import { generateReportJob } from '../modules/reports/service.js';
import { finishInterview, loadInterview } from '../modules/interviews/service.js';
import { getStorage } from '../services/storage.js';

/** Sweep: close interviews whose time ran out; expire invitations and unopened interviews past their window. */
export async function expireInterviewsJob(log: { info: (o: unknown, m?: string) => void }): Promise<void> {
  const db = getDb();
  const now = new Date();
  const overdue = await db.select({ id: interviews.id }).from(interviews).where(and(eq(interviews.status, 'in_progress'), lt(interviews.overallDeadline, new Date(now.getTime() - 120_000)))).limit(100);
  for (const row of overdue) {
    const li = await loadInterview(row.id);
    const s = li.interview.sections.find((x) => x.status === 'active');
    const sectionOver = s?.deadline ? new Date(s.deadline).getTime() + li.interview.plan.graceSeconds * 1000 + 60_000 < now.getTime() : true;
    if (sectionOver) await finishInterview(li, 'expired', null);
  }
  const unopened = await db.update(interviews).set({ status: 'expired' }).where(and(inArray(interviews.status, ['invited', 'ready']), lt(interviews.completeBy, now))).returning({ id: interviews.id });
  const invites = await db.update(interviewInvites).set({ status: 'expired' }).where(and(eq(interviewInvites.status, 'pending'), lt(interviewInvites.expiresAt, now))).returning({ id: interviewInvites.id });
  if (overdue.length || unopened.length || invites.length) log.info({ closed: overdue.length, unopened: unopened.length, invites: invites.length }, 'expiry sweep');
}

/** Purge interview content older than each organization's retention period; keep anonymised tombstones. */
export async function retentionPurgeJob(log: { info: (o: unknown, m?: string) => void }): Promise<void> {
  const db = getDb();
  const orgs = await db.select({ id: organizations.id, days: organizations.retentionDays }).from(organizations);
  let purged = 0;
  for (const org of orgs) {
    const cutoff = new Date(Date.now() - org.days * 86_400_000);
    const old = await db.select({ id: interviews.id, candidateId: interviews.candidateId }).from(interviews).where(and(eq(interviews.organizationId, org.id), lt(interviews.createdAt, cutoff), inArray(interviews.status, ['completed', 'expired', 'cancelled']))).limit(200);
    for (const i of old) {
      await db.transaction(async (tx) => {
        await tx.delete(interviewTurns).where(eq(interviewTurns.interviewId, i.id));
        await tx.delete(transcriptEvents).where(eq(transcriptEvents.interviewId, i.id));
        await tx.delete(codeSubmissions).where(eq(codeSubmissions.interviewId, i.id));
        await tx.delete(proctoringEvents).where(eq(proctoringEvents.interviewId, i.id));
        await tx.update(reports).set({ summary: '[purged by retention policy]', strengths: [], considerations: [], competencies: [], integrity: null }).where(eq(reports.interviewId, i.id));
      });
      purged++;
    }
  }
  // Orphaned resume files for deleted users.
  const orphans = await db.execute(sql`select r.id, r.storage_key from resumes r join users u on u.id = r.user_id where u.deleted_at is not null limit 100`);
  for (const row of orphans.rows as { id: string; storage_key: string }[]) {
    await getStorage().delete(row.storage_key).catch(() => {});
    await db.delete(resumes).where(eq(resumes.id, row.id));
  }
  if (purged) log.info({ purged }, 'retention purge');
}

export async function startJobs(app: FastifyInstance): Promise<void> {
  setJobLogger(app.log);
  registerHandler('submission.grade', async (d: { submissionId: string }) => gradeSubmissionJob(d.submissionId));
  registerHandler('report.generate', async (d: { interviewId: string }) => generateReportJob(d.interviewId));
  registerHandler('interview.expire', async () => expireInterviewsJob(app.log));
  registerHandler('retention.purge', async () => retentionPurgeJob(app.log));

  const boss = await getBoss();
  const concurrency: Partial<Record<QueueName, number>> = { 'submission.grade': env().RUNNER_MAX_CONCURRENCY, 'report.generate': 2, 'email.send': 4, 'resume.parse': 2 };
  for (const name of Object.values(QUEUES)) {
    const handler = getHandler(name);
    if (!handler) continue;
    await boss.work(name, { batchSize: 1, pollingIntervalSeconds: 1, localConcurrency: concurrency[name] ?? 1 }, async (jobs) => {
      for (const job of jobs) {
        try {
          await handler(job.data, app.log);
          recordJob(name, 'ok');
        } catch (err) {
          recordJob(name, 'error');
          app.log.error({ err, queue: name, jobId: job.id }, 'job failed');
          throw err;
        }
      }
    });
  }
  await boss.schedule(QUEUES.interviewExpire, '* * * * *', {}, { singletonKey: 'interview.expire' });
  await boss.schedule(QUEUES.retentionPurge, '0 3 * * *', {}, { singletonKey: 'retention.purge' });
  app.log.info({ queues: Object.values(QUEUES) }, 'background jobs started');
}

export async function stopJobs(): Promise<void> {
  await stopBoss();
}

/** Register handlers without pg-boss (tests run jobs inline through `enqueue`). */
export function registerInlineHandlers(): void {
  registerHandler('submission.grade', async (d: { submissionId: string }) => gradeSubmissionJob(d.submissionId));
  registerHandler('report.generate', async (d: { interviewId: string }) => generateReportJob(d.interviewId));
  registerHandler('interview.expire', async () => expireInterviewsJob(console));
  registerHandler('retention.purge', async () => retentionPurgeJob(console));
}
