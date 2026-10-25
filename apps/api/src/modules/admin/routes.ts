import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditLogDto, OutboxMailDto, RecruiterDashboard } from '@hws/shared';
import { env, isProd } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { auditLogs, emailOutbox, interviews, jobs, reports, users } from '../../db/schema.js';
import { forbidden } from '../../lib/errors.js';

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/dashboard', { preHandler: app.requireOrg(), schema: { tags: ['admin'], response: { 200: RecruiterDashboard } } }, async (req) => {
    const db = getDb();
    const orgId = req.user!.org!.id;
    const [jobCounts] = await db
      .select({
        open: sql<number>`count(*) filter (where ${jobs.status} = 'open')`.mapWith(Number),
        draft: sql<number>`count(*) filter (where ${jobs.status} = 'draft')`.mapWith(Number),
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(jobs)
      .where(eq(jobs.organizationId, orgId));
    const [ic] = await db
      .select({
        invited: sql<number>`count(*) filter (where ${interviews.status} in ('invited','ready'))`.mapWith(Number),
        inProgress: sql<number>`count(*) filter (where ${interviews.status} = 'in_progress')`.mapWith(Number),
        completed: sql<number>`count(*) filter (where ${interviews.status} in ('completed','expired','submitted'))`.mapWith(Number),
        total: sql<number>`count(*)`.mapWith(Number),
        awaitingReview: sql<number>`count(*) filter (where ${interviews.status} in ('completed','expired') and not exists (select 1 from decisions d where d.interview_id = ${interviews.id}))`.mapWith(Number),
      })
      .from(interviews)
      .where(eq(interviews.organizationId, orgId));
    const [avg] = await db
      .select({ avg: sql<number | null>`avg(${reports.weightedScore})`, n: sql<number>`count(${reports.weightedScore})`.mapWith(Number) })
      .from(reports)
      .innerJoin(interviews, eq(interviews.id, reports.interviewId))
      .where(and(eq(interviews.organizationId, orgId), eq(reports.status, 'ready')));
    const recent = await db
      .select({ id: interviews.id, status: interviews.status, at: interviews.updatedAt, candidateName: users.name, jobTitle: jobs.title, score: reports.weightedScore, rec: reports.recommendation, rs: reports.status })
      .from(interviews)
      .innerJoin(users, eq(users.id, interviews.candidateId))
      .innerJoin(jobs, eq(jobs.id, interviews.jobId))
      .leftJoin(reports, eq(reports.interviewId, interviews.id))
      .where(eq(interviews.organizationId, orgId))
      .orderBy(desc(interviews.updatedAt))
      .limit(8);
    const dist = await db
      .select({ bucket: sql<string>`case when ${reports.weightedScore} >= 80 then '80-100' when ${reports.weightedScore} >= 60 then '60-79' when ${reports.weightedScore} >= 40 then '40-59' else '0-39' end`, count: sql<number>`count(*)`.mapWith(Number) })
      .from(reports)
      .innerJoin(interviews, eq(interviews.id, reports.interviewId))
      .where(and(eq(interviews.organizationId, orgId), eq(reports.status, 'ready')))
      .groupBy(sql`1`);
    const buckets = ['0-39', '40-59', '60-79', '80-100'].map((b) => ({ bucket: b, count: dist.find((d) => d.bucket === b)?.count ?? 0 }));
    const total = ic?.total ?? 0;
    return {
      jobs: { open: jobCounts?.open ?? 0, draft: jobCounts?.draft ?? 0, total: jobCounts?.total ?? 0 },
      interviews: { invited: ic?.invited ?? 0, inProgress: ic?.inProgress ?? 0, awaitingReview: ic?.awaitingReview ?? 0, completed: ic?.completed ?? 0, total },
      averageScore: avg?.avg == null ? null : Math.round(Number(avg.avg) * 10) / 10,
      completionRate: total ? Math.round(((ic?.completed ?? 0) / total) * 1000) / 10 : null,
      recent: recent.map((r) => ({ interviewId: r.id, candidateName: r.candidateName, jobTitle: r.jobTitle, status: r.status, weightedScore: r.rs === 'ready' ? r.score : null, recommendation: r.rs === 'ready' ? r.rec : null, at: r.at.toISOString() })),
      scoreDistribution: buckets,
    };
  });

  app.get('/audit', { preHandler: app.requireOrg('owner', 'admin'), schema: { tags: ['admin'], querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), targetId: z.string().optional() }), response: { 200: z.array(AuditLogDto) } } }, async (req) => {
    const rows = await getDb()
      .select({ a: auditLogs, actorName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(eq(auditLogs.organizationId, req.user!.org!.id), req.query.targetId ? eq(auditLogs.targetId, req.query.targetId) : undefined))
      .orderBy(desc(auditLogs.createdAt))
      .limit(req.query.limit);
    return rows.map(({ a, actorName }) => ({ id: a.id, actor: a.actorId ? { id: a.actorId, name: actorName ?? 'Unknown' } : null, action: a.action, targetType: a.targetType, targetId: a.targetId, meta: a.meta ?? null, ip: a.ip, at: a.createdAt.toISOString() }));
  });

  /** Development mailbox: lets testers open invitation and reset links without SMTP. Disabled in production unless superadmin. */
  app.get('/outbox', { schema: { tags: ['admin'], querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }), response: { 200: z.array(OutboxMailDto) } } }, async (req) => {
    if (isProd() && req.user!.role !== 'superadmin') throw forbidden('The outbox is only available in development');
    if (env().EMAIL_TRANSPORT === 'smtp' && req.user!.role !== 'superadmin') throw forbidden('Outbox is disabled when SMTP is configured');
    const rows = await getDb().select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(req.query.limit);
    return rows.map((m) => ({ id: m.id, to: m.to, subject: m.subject, text: m.text, html: m.html, status: m.status, error: m.error, createdAt: m.createdAt.toISOString() }));
  });

  void gte;
  void inArray;
};
