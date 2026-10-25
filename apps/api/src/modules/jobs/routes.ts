import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CodingProblemDto, CreateCodingProblemBody, CreateJobBody, CreateQuestionBody, JobDto, JobListQuery, OkResponse, QuestionDto, UpdateCodingProblemBody, UpdateJobBody, UpdateQuestionBody, paginated } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { codingProblems, jobs, questions } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { paginate } from '../../lib/util.js';
import { audit } from '../../services/audit.js';
import { defaultPlan, getOrgJob, jobStats, toJobDto, toProblemDto, toQuestionDto, uniqueJobSlug, validatePlan } from './service.js';

const JobParams = z.object({ id: z.uuid() });

export const jobRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireOrg());

  app.get('/', { schema: { tags: ['jobs'], querystring: JobListQuery, response: { 200: paginated(JobDto) } } }, async (req) => {
    const db = getDb();
    const orgId = req.user!.org!.id;
    const where = and(
      eq(jobs.organizationId, orgId),
      req.query.status ? eq(jobs.status, req.query.status) : undefined,
      req.query.q ? or(ilike(jobs.title, `%${req.query.q}%`), ilike(jobs.department, `%${req.query.q}%`)) : undefined,
    );
    const { limit, offset } = paginate(req.query.page, req.query.pageSize);
    const [rows, countRows] = await Promise.all([
      db.select().from(jobs).where(where).orderBy(desc(jobs.updatedAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(jobs).where(where),
    ]);
    const stats = await jobStats(rows.map((r) => r.id));
    return { items: rows.map((j) => toJobDto(j, stats.get(j.id))), total: countRows[0]?.count ?? 0, page: req.query.page, pageSize: req.query.pageSize };
  });

  app.post('/', { schema: { tags: ['jobs'], body: CreateJobBody, response: { 201: JobDto } } }, async (req, reply) => {
    const orgId = req.user!.org!.id;
    const plan = req.body.interviewPlan ?? defaultPlan();
    if (plan.sections.some((s) => s.type === 'coding')) throw badRequest('Create the job first, add coding problems, then add a coding section to the plan.');
    const [j] = await getDb()
      .insert(jobs)
      .values({
        organizationId: orgId,
        title: req.body.title,
        slug: await uniqueJobSlug(orgId, req.body.title),
        department: req.body.department ?? null,
        location: req.body.location ?? null,
        employmentType: req.body.employmentType ?? null,
        seniority: req.body.seniority ?? null,
        description: req.body.description,
        skills: req.body.skills,
        competencies: req.body.competencies,
        interviewPlan: plan,
        minimumScore: req.body.minimumScore,
        biasAuditUrl: req.body.biasAuditUrl ?? null,
        createdBy: req.user!.id,
      })
      .returning();
    audit({ action: 'job.created', targetType: 'job', targetId: j!.id }, req);
    return reply.status(201).send(toJobDto(j!));
  });

  app.get('/:id', { schema: { tags: ['jobs'], params: JobParams, response: { 200: JobDto } } }, async (req) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    const stats = await jobStats([j.id]);
    return toJobDto(j, stats.get(j.id));
  });

  app.patch('/:id', { schema: { tags: ['jobs'], params: JobParams, body: UpdateJobBody, response: { 200: JobDto } } }, async (req) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    const b = req.body;
    const competencies = b.competencies ?? j.competencies;
    const plan = b.interviewPlan ?? j.interviewPlan;
    if (b.interviewPlan || b.competencies || b.status === 'open') await validatePlan(j.id, plan, competencies);
    const [updated] = await getDb()
      .update(jobs)
      .set({
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.department !== undefined ? { department: b.department } : {}),
        ...(b.location !== undefined ? { location: b.location } : {}),
        ...(b.employmentType !== undefined ? { employmentType: b.employmentType } : {}),
        ...(b.seniority !== undefined ? { seniority: b.seniority } : {}),
        ...(b.description !== undefined ? { description: b.description } : {}),
        ...(b.skills !== undefined ? { skills: b.skills } : {}),
        ...(b.competencies !== undefined ? { competencies: b.competencies } : {}),
        ...(b.interviewPlan !== undefined ? { interviewPlan: b.interviewPlan } : {}),
        ...(b.minimumScore !== undefined ? { minimumScore: b.minimumScore } : {}),
        ...(b.biasAuditUrl !== undefined ? { biasAuditUrl: b.biasAuditUrl } : {}),
        ...(b.status !== undefined ? { status: b.status } : {}),
      })
      .where(eq(jobs.id, j.id))
      .returning();
    audit({ action: 'job.updated', targetType: 'job', targetId: j.id, meta: { fields: Object.keys(b) } }, req);
    return toJobDto(updated!);
  });

  app.delete('/:id', { preHandler: app.requireOrg('owner', 'admin'), schema: { tags: ['jobs'], params: JobParams, response: { 200: OkResponse } } }, async (req) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    if (j.status !== 'draft' && j.status !== 'archived') throw badRequest('Only draft or archived jobs can be deleted; archive it first.');
    await getDb().delete(jobs).where(eq(jobs.id, j.id));
    audit({ action: 'job.deleted', targetType: 'job', targetId: j.id }, req);
    return { ok: true as const };
  });

  /* ------------------------------ question bank ------------------------------ */

  app.get('/:id/questions', { schema: { tags: ['jobs'], params: JobParams, response: { 200: z.array(QuestionDto) } } }, async (req) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    const rows = await getDb().select().from(questions).where(eq(questions.jobId, j.id)).orderBy(asc(questions.order), asc(questions.createdAt));
    return rows.map(toQuestionDto);
  });

  app.post('/:id/questions', { schema: { tags: ['jobs'], params: JobParams, body: CreateQuestionBody, response: { 201: QuestionDto } } }, async (req, reply) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    if (req.body.competencyKey && !j.competencies.some((c) => c.key === req.body.competencyKey)) throw badRequest('Unknown competency key');
    const [q] = await getDb().insert(questions).values({ jobId: j.id, ...req.body, competencyKey: req.body.competencyKey ?? null, createdBy: req.user!.id }).returning();
    return reply.status(201).send(toQuestionDto(q!));
  });

  app.patch('/:id/questions/:qid', { schema: { tags: ['jobs'], params: JobParams.extend({ qid: z.uuid() }), body: UpdateQuestionBody, response: { 200: QuestionDto } } }, async (req) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    const [q] = await getDb().update(questions).set(req.body).where(and(eq(questions.id, req.params.qid), eq(questions.jobId, j.id))).returning();
    if (!q) throw notFound('Question');
    return toQuestionDto(q);
  });

  app.delete('/:id/questions/:qid', { schema: { tags: ['jobs'], params: JobParams.extend({ qid: z.uuid() }), response: { 200: OkResponse } } }, async (req) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    await getDb().delete(questions).where(and(eq(questions.id, req.params.qid), eq(questions.jobId, j.id)));
    return { ok: true as const };
  });

  /* ----------------------------- coding problems ----------------------------- */

  app.get('/:id/problems', { schema: { tags: ['jobs'], params: JobParams, response: { 200: z.array(CodingProblemDto) } } }, async (req) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    const rows = await getDb().select().from(codingProblems).where(eq(codingProblems.jobId, j.id)).orderBy(asc(codingProblems.createdAt));
    return rows.map((p) => toProblemDto(p, true));
  });

  app.post('/:id/problems', { schema: { tags: ['jobs'], params: JobParams, body: CreateCodingProblemBody, response: { 201: CodingProblemDto } } }, async (req, reply) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    if (!req.body.testCases.some((t) => t.isSample)) throw badRequest('Mark at least one test case as a sample so candidates can see the expected format');
    const [p] = await getDb().insert(codingProblems).values({ jobId: j.id, ...req.body, createdBy: req.user!.id }).returning();
    audit({ action: 'problem.created', targetType: 'coding_problem', targetId: p!.id }, req);
    return reply.status(201).send(toProblemDto(p!, true));
  });

  app.patch('/:id/problems/:pid', { schema: { tags: ['jobs'], params: JobParams.extend({ pid: z.uuid() }), body: UpdateCodingProblemBody, response: { 200: CodingProblemDto } } }, async (req) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    if (req.body.testCases && !req.body.testCases.some((t) => t.isSample)) throw badRequest('Mark at least one test case as a sample');
    const [p] = await getDb().update(codingProblems).set(req.body).where(and(eq(codingProblems.id, req.params.pid), eq(codingProblems.jobId, j.id))).returning();
    if (!p) throw notFound('Coding problem');
    return toProblemDto(p, true);
  });

  app.delete('/:id/problems/:pid', { schema: { tags: ['jobs'], params: JobParams.extend({ pid: z.uuid() }), response: { 200: OkResponse } } }, async (req) => {
    const j = await getOrgJob(req.user!.org!.id, req.params.id);
    const used = j.interviewPlan.sections.some((s) => s.type === 'coding' && s.problemIds.includes(req.params.pid));
    if (used) throw badRequest('Remove the problem from the interview plan before deleting it');
    await getDb().delete(codingProblems).where(and(eq(codingProblems.id, req.params.pid), eq(codingProblems.jobId, j.id)));
    return { ok: true as const };
  });
};
