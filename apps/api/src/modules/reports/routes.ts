import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { DecisionBody, DecisionDto, RankingsDto, ReportDto } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { decisions, interviews, proctoringEvents, reports, users } from '../../db/schema.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../services/audit.js';
import { enqueue } from '../../jobs/boss.js';
import { getOrgJob } from '../jobs/service.js';
import { assertRecruiter, loadInterview } from '../interviews/service.js';
import { toDecisionDto, toReportDto } from './service.js';

const Params = z.object({ id: z.uuid() });

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireOrg());

  app.get('/interviews/:id/report', { schema: { tags: ['reports'], params: Params, response: { 200: ReportDto } } }, async (req) => {
    const li = await loadInterview(req.params.id);
    assertRecruiter(li, req.user!);
    const [r] = await getDb().select().from(reports).where(eq(reports.interviewId, li.interview.id)).limit(1);
    if (!r) throw notFound('Report');
    audit({ action: 'report.viewed', targetType: 'interview', targetId: li.interview.id }, req);
    return toReportDto(r);
  });

  app.post('/interviews/:id/report/regenerate', { preHandler: app.requireOrg('owner', 'admin'), schema: { tags: ['reports'], params: Params, response: { 202: z.object({ status: z.string() }) } } }, async (req, reply) => {
    const li = await loadInterview(req.params.id);
    assertRecruiter(li, req.user!);
    if (!['submitted', 'completed', 'expired'].includes(li.interview.status)) throw conflict('The interview has not finished');
    await getDb().insert(reports).values({ interviewId: li.interview.id, status: 'pending', minimumScore: li.job.minimumScore }).onConflictDoUpdate({ target: reports.interviewId, set: { status: 'pending', error: null } });
    await getDb().update(interviews).set({ reportStatus: 'pending' }).where(eq(interviews.id, li.interview.id));
    await enqueue('report.generate', { interviewId: li.interview.id }, { singletonKey: `report:${li.interview.id}:${Date.now()}` });
    audit({ action: 'report.regenerate_requested', targetType: 'interview', targetId: li.interview.id }, req);
    return reply.status(202).send({ status: 'pending' });
  });

  app.put('/interviews/:id/decision', { schema: { tags: ['reports'], params: Params, body: DecisionBody, response: { 200: DecisionDto } } }, async (req) => {
    const li = await loadInterview(req.params.id);
    assertRecruiter(li, req.user!);
    if (!['submitted', 'completed', 'expired'].includes(li.interview.status)) throw conflict('Decisions can only be recorded after the interview finishes');
    const [r] = await getDb().select().from(reports).where(eq(reports.interviewId, li.interview.id)).limit(1);
    const positive = ['advance', 'hire'].includes(req.body.decision);
    // Only a definite recommendation can be overridden; 'insufficient_evidence' expresses no verdict.
    const recPositive = r && r.recommendation !== 'insufficient_evidence' ? ['strong_hire', 'hire'].includes(r.recommendation) : null;
    const overrides = recPositive === null ? false : positive !== recPositive;
    const [d] = await getDb()
      .insert(decisions)
      .values({ interviewId: li.interview.id, decision: req.body.decision, reason: req.body.reason, overridesRecommendation: overrides, decidedBy: req.user!.id, decidedAt: new Date() })
      .onConflictDoUpdate({ target: decisions.interviewId, set: { decision: req.body.decision, reason: req.body.reason, overridesRecommendation: overrides, decidedBy: req.user!.id, decidedAt: new Date() } })
      .returning();
    audit({ action: 'decision.recorded', targetType: 'interview', targetId: li.interview.id, meta: { decision: req.body.decision, overrides } }, req);
    return toDecisionDto(d!, req.user!.name);
  });

  async function rankings(orgId: string, jobId: string) {
    const job = await getOrgJob(orgId, jobId);
    const db = getDb();
    const rows = await db
      .select({ i: interviews, cId: users.id, cName: users.name, cEmail: users.email, r: reports, d: decisions.decision })
      .from(interviews)
      .innerJoin(users, eq(users.id, interviews.candidateId))
      .leftJoin(reports, eq(reports.interviewId, interviews.id))
      .leftJoin(decisions, eq(decisions.interviewId, interviews.id))
      .where(and(eq(interviews.jobId, job.id), inArray(interviews.status, ['submitted', 'completed', 'expired'])))
      .orderBy(desc(reports.weightedScore));
    const ids = rows.map((r) => r.i.id);
    const flagRows = ids.length ? await db.select({ interviewId: proctoringEvents.interviewId, type: proctoringEvents.type }).from(proctoringEvents).where(inArray(proctoringEvents.interviewId, ids)) : [];
    const flags = new Map<string, number>();
    for (const f of flagRows) if (['focus_lost', 'paste', 'fullscreen_exit', 'tab_hidden', 'devtools_suspected'].includes(f.type)) flags.set(f.interviewId, (flags.get(f.interviewId) ?? 0) + 1);
    const result = {
      job: { id: job.id, title: job.title, minimumScore: job.minimumScore, competencies: job.competencies.map((c) => ({ key: c.key, label: c.label, weight: c.weight })) },
      rows: rows
        .map((row) => {
          const ready = row.r?.status === 'ready';
          const comp: Record<string, number | null> = {};
          for (const c of job.competencies) comp[c.key] = ready ? (row.r!.competencies.find((x) => x.key === c.key)?.score ?? null) : null;
          return {
            interviewId: row.i.id,
            candidate: { id: row.cId, name: row.cName, email: row.cEmail },
            status: row.i.status,
            weightedScore: ready ? row.r!.weightedScore : null,
            coverage: ready ? row.r!.coverage : null,
            recommendation: ready ? row.r!.recommendation : null,
            meetsMinimum: ready ? row.r!.meetsMinimum : null,
            competencyScores: comp,
            codingScore: ready ? (row.r!.competencies.find((x) => x.key === 'coding_correctness')?.score ?? null) : null,
            integrityFlags: flags.get(row.i.id) ?? 0,
            decision: row.d ?? null,
            completedAt: (row.i.completedAt ?? row.i.submittedAt)?.toISOString() ?? null,
          };
        })
        .sort((a, b) => (b.weightedScore ?? -1) - (a.weightedScore ?? -1)),
    };
    return result;
  }

  app.get('/jobs/:id/rankings', { schema: { tags: ['reports'], params: Params, response: { 200: RankingsDto } } }, async (req) => rankings(req.user!.org!.id, req.params.id));

  app.get('/jobs/:id/rankings.csv', { schema: { tags: ['reports'], params: Params, produces: ['text/csv'], response: { 200: z.any() } } }, async (req, reply) => {
    const r = await rankings(req.user!.org!.id, req.params.id);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['interview_id', 'candidate', 'email', 'status', 'weighted_score', 'coverage', 'recommendation', 'meets_minimum', ...r.job.competencies.map((c) => c.key), 'integrity_flags', 'decision', 'completed_at'];
    const lines = [head.join(',')];
    for (const row of r.rows) {
      lines.push([row.interviewId, row.candidate.name, row.candidate.email, row.status, row.weightedScore, row.coverage, row.recommendation, row.meetsMinimum, ...r.job.competencies.map((c) => row.competencyScores[c.key]), row.integrityFlags, row.decision, row.completedAt].map(esc).join(','));
    }
    audit({ action: 'rankings.exported', targetType: 'job', targetId: r.job.id }, req);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="rankings-${r.job.id}.csv"`);
    return reply.send(lines.join('\n'));
  });
};
