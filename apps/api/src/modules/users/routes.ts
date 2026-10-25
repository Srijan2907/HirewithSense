import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { CandidateProfile, OkResponse, PublicUser, UpdateProfileBody } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { auditLogs, codeSubmissions, consents, decisions, interviewTurns, interviews, jobs, organizations, proctoringEvents, reports, resumes, transcriptEvents, users } from '../../db/schema.js';
import { asc } from 'drizzle-orm';
import { conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../services/audit.js';
import { getStorage } from '../../services/storage.js';
import { revokeAll, toPublicUser } from '../auth/service.js';

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/me', { schema: { tags: ['users'], response: { 200: PublicUser.extend({ profile: CandidateProfile }) } } }, async (req) => {
    const [u] = await getDb().select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!u) throw notFound('User');
    return { ...(await toPublicUser(u)), profile: { headline: u.headline, location: u.location, timezone: u.timezone } };
  });

  app.patch('/me', { schema: { tags: ['users'], body: UpdateProfileBody, response: { 200: PublicUser.extend({ profile: CandidateProfile }) } } }, async (req) => {
    const db = getDb();
    const b = req.body;
    if (b.username) {
      const [taken] = await db.select({ id: users.id }).from(users).where(and(eq(users.username, b.username), ne(users.id, req.user!.id))).limit(1);
      if (taken) throw conflict('This username is taken');
    }
    const [u] = await db
      .update(users)
      .set({
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.username !== undefined ? { username: b.username } : {}),
        ...(b.headline !== undefined ? { headline: b.headline } : {}),
        ...(b.location !== undefined ? { location: b.location } : {}),
        ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
      })
      .where(eq(users.id, req.user!.id))
      .returning();
    return { ...(await toPublicUser(u!)), profile: { headline: u!.headline, location: u!.location, timezone: u!.timezone } };
  });

  /**
   * Self-service data access (GDPR Art. 15 style): everything the platform holds about the signed-in
   * candidate as one JSON document. Includes evaluations and reports, since profiling output about a
   * person is their personal data too. Recruiters are directed to the organization views instead.
   */
  app.get('/me/export', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['users'], response: { 200: z.any() } } }, async (req, reply) => {
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!u) throw notFound('User');
    const myResumes = await db.select().from(resumes).where(eq(resumes.userId, u.id)).orderBy(asc(resumes.createdAt));
    const myInterviews = await db
      .select({ i: interviews, jobTitle: jobs.title, orgName: organizations.name })
      .from(interviews)
      .innerJoin(jobs, eq(jobs.id, interviews.jobId))
      .innerJoin(organizations, eq(organizations.id, interviews.organizationId))
      .where(eq(interviews.candidateId, u.id))
      .orderBy(asc(interviews.createdAt));
    const interviewsOut = [];
    for (const { i, jobTitle, orgName } of myInterviews) {
      const [turns, transcript, submissions, events, consentRows, [report], [decision]] = await Promise.all([
        db.select().from(interviewTurns).where(eq(interviewTurns.interviewId, i.id)).orderBy(asc(interviewTurns.sectionIndex), asc(interviewTurns.order)),
        db.select().from(transcriptEvents).where(eq(transcriptEvents.interviewId, i.id)).orderBy(asc(transcriptEvents.at)),
        db.select().from(codeSubmissions).where(eq(codeSubmissions.interviewId, i.id)).orderBy(asc(codeSubmissions.createdAt)),
        db.select().from(proctoringEvents).where(eq(proctoringEvents.interviewId, i.id)).orderBy(asc(proctoringEvents.at)),
        db.select().from(consents).where(eq(consents.interviewId, i.id)),
        db.select().from(reports).where(eq(reports.interviewId, i.id)).limit(1),
        db.select().from(decisions).where(eq(decisions.interviewId, i.id)).limit(1),
      ]);
      interviewsOut.push({
        id: i.id,
        job: jobTitle,
        organization: orgName,
        status: i.status,
        plan: i.plan,
        sections: i.sections,
        consentedAt: i.consentedAt,
        startedAt: i.startedAt,
        submittedAt: i.submittedAt,
        completedAt: i.completedAt,
        consents: consentRows.map((c) => ({ disclosureVersion: c.disclosureVersion, textHash: c.textHash, accommodationRequest: c.accommodationRequest, consentedAt: c.consentedAt })),
        questionsAndAnswers: turns.map((t) => ({ sectionIndex: t.sectionIndex, order: t.order, question: t.question, competencyKey: t.competencyKey, source: t.source, askedAt: t.askedAt, answer: t.answer, answeredAt: t.answeredAt, inputMode: t.inputMode, skipped: t.skipped, evaluation: t.evaluation })),
        transcript: transcript.map((e) => ({ at: e.at, speaker: e.speaker, text: e.text })),
        codeSubmissions: submissions.map((s) => ({ id: s.id, problemId: s.problemId, languageId: s.languageId, kind: s.kind, status: s.status, sourceCode: s.sourceCode, passed: s.passed, total: s.total, score: s.score, compileOutput: s.compileOutput, createdAt: s.createdAt, gradedAt: s.gradedAt })),
        interfaceEvents: events.map((e) => ({ type: e.type, at: e.at, sectionIndex: e.sectionIndex })),
        report: report && report.status === 'ready'
          ? { summary: report.summary, strengths: report.strengths, considerations: report.considerations, competencies: report.competencies, weightedScore: report.weightedScore, coverage: report.coverage, recommendation: report.recommendation, provider: report.provider, model: report.model, generatedAt: report.generatedAt }
          : null,
        decision: decision ? { decision: decision.decision, reason: decision.reason, decidedAt: decision.decidedAt } : null,
      });
    }
    const myAudit = await db.select().from(auditLogs).where(eq(auditLogs.targetId, u.id)).orderBy(asc(auditLogs.createdAt)).limit(500);
    audit({ action: 'user.data_exported', targetType: 'user', targetId: u.id, actorId: u.id }, req);
    const bundle = {
      exportedAt: new Date().toISOString(),
      format: 'hirewithsense.candidate-export.v1',
      account: { id: u.id, name: u.name, username: u.username, email: u.email, headline: u.headline, location: u.location, timezone: u.timezone, emailVerifiedAt: u.emailVerifiedAt, createdAt: u.createdAt },
      resumes: myResumes.map((r) => ({ id: r.id, originalName: r.originalName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, uploadedAt: r.createdAt, parseStatus: r.parseStatus, profile: r.profile, extractedText: r.extractedText })),
      interviews: interviewsOut,
      accountEvents: myAudit.map((a) => ({ action: a.action, at: a.createdAt, ip: a.ip })),
    };
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="hirewithsense-export-${u.id.slice(0, 8)}.json"`);
    return reply.send(JSON.stringify(bundle, null, 2));
  });

  /**
   * Candidate data deletion (GDPR / Illinois AIVIA style). Interview rows are kept as anonymised
   * tombstones for the employer's audit needs; transcripts, answers, code, reports and files go.
   */
  app.post('/me/delete', { schema: { tags: ['users'], body: z.object({ confirmEmail: z.string() }), response: { 200: OkResponse } } }, async (req) => {
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!u) throw notFound('User');
    if (u.email !== req.body.confirmEmail.trim().toLowerCase()) throw conflict('Email confirmation does not match');
    const storage = getStorage();
    const files = await db.select({ key: resumes.storageKey }).from(resumes).where(eq(resumes.userId, u.id));
    await Promise.all(files.map((f) => storage.delete(f.key).catch(() => {})));
    await db.transaction(async (tx) => {
      await tx.delete(resumes).where(eq(resumes.userId, u.id));
      const { interviewTurns, transcriptEvents, codeSubmissions, codeDrafts, proctoringEvents, reports } = await import('../../db/schema.js');
      const mine = await tx.select({ id: interviews.id }).from(interviews).where(eq(interviews.candidateId, u.id));
      for (const i of mine) {
        await tx.delete(interviewTurns).where(eq(interviewTurns.interviewId, i.id));
        await tx.delete(transcriptEvents).where(eq(transcriptEvents.interviewId, i.id));
        await tx.delete(codeSubmissions).where(eq(codeSubmissions.interviewId, i.id));
        await tx.delete(codeDrafts).where(eq(codeDrafts.interviewId, i.id));
        await tx.delete(proctoringEvents).where(eq(proctoringEvents.interviewId, i.id));
        await tx.delete(reports).where(eq(reports.interviewId, i.id));
      }
      const anon = `deleted-${u.id.slice(0, 8)}`;
      await tx
        .update(users)
        .set({ name: 'Deleted candidate', username: anon, email: `${anon}@deleted.invalid`, passwordHash: 'deleted', headline: null, location: null, timezone: null, deletedAt: new Date() })
        .where(eq(users.id, u.id));
    });
    await revokeAll(u.id);
    audit({ action: 'user.deleted', targetType: 'user', targetId: u.id, actorId: u.id }, req);
    return { ok: true as const };
  });
};
