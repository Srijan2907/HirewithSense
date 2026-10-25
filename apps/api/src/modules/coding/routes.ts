import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { CandidateProblemDto, DraftDto, LANGUAGES, LanguageInfo, RunCodeBody, SaveDraftBody, SubmissionDto, SubmitCodeBody } from '@hws/shared';
import { getDb } from '../../db/client.js';
import type { AuthUser } from '../../plugins/auth.js';
import { codeDrafts, codeSubmissions, codingProblems, transcriptEvents } from '../../db/schema.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { enqueue } from '../../jobs/boss.js';
import { getRunner, gradeSubmission } from '../../services/runner/index.js';
import { reviewCode } from '../../services/ai/tasks.js';
import { toCandidateProblemDto } from '../jobs/service.js';
import * as isvc from '../interviews/service.js';
import { redactResults, toSubmissionDto } from './service.js';

const Params = z.object({ id: z.uuid() });

export const codingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/languages', { schema: { tags: ['coding'], response: { 200: z.array(LanguageInfo) } } }, async () => {
    const available = new Set(await (await getRunner()).availableLanguages());
    return LANGUAGES.map((l) => ({ id: l.id, label: l.label, monaco: l.monaco, available: available.has(l.id) }));
  });

  const RoomState = z.object({
    sectionIndex: z.number().int(),
    deadline: z.string().nullable(),
    languageIds: z.array(z.string()),
    problems: z.array(CandidateProblemDto),
    drafts: z.array(DraftDto),
    submissions: z.array(SubmissionDto),
    languages: z.array(LanguageInfo),
  });

  async function codingContext(id: string, user: AuthUser) {
    const li = await isvc.loadInterview(id);
    isvc.assertCandidate(li, user);
    const section = isvc.assertWritable(li.interview);
    const plan = li.interview.plan.sections[section.index];
    if (!plan || plan.type !== 'coding') throw conflict('The active section is not a coding section');
    return { li, section, plan };
  }

  app.get('/interviews/:id/coding', { schema: { tags: ['coding'], params: Params, response: { 200: RoomState } } }, async (req) => {
    const { li, section, plan } = await codingContext(req.params.id, req.user!);
    const db = getDb();
    const [problems, drafts, subs, available] = await Promise.all([
      db.select().from(codingProblems).where(inArray(codingProblems.id, plan.problemIds)),
      db.select().from(codeDrafts).where(eq(codeDrafts.interviewId, li.interview.id)),
      db.select().from(codeSubmissions).where(and(eq(codeSubmissions.interviewId, li.interview.id), eq(codeSubmissions.sectionIndex, section.index))).orderBy(desc(codeSubmissions.createdAt)).limit(50),
      getRunner().then((r) => r.availableLanguages()),
    ]);
    const ordered = plan.problemIds.map((pid) => problems.find((p) => p.id === pid)).filter((p): p is NonNullable<typeof p> => Boolean(p));
    const availableSet = new Set(available);
    return {
      sectionIndex: section.index,
      deadline: section.deadline,
      languageIds: plan.languageIds,
      problems: ordered.map(toCandidateProblemDto),
      drafts: drafts.map((d) => ({ problemId: d.problemId, languageId: d.languageId as z.infer<typeof DraftDto>['languageId'], sourceCode: d.sourceCode, updatedAt: d.updatedAt.toISOString() })),
      submissions: subs.map((s) => toSubmissionDto(s, false)),
      languages: LANGUAGES.filter((l) => plan.languageIds.includes(l.id)).map((l) => ({ id: l.id, label: l.label, monaco: l.monaco, available: availableSet.has(l.id) })),
    };
  });

  app.put('/interviews/:id/coding/draft', { schema: { tags: ['coding'], params: Params, body: SaveDraftBody, response: { 200: DraftDto } } }, async (req) => {
    const { li, plan } = await codingContext(req.params.id, req.user!);
    if (!plan.problemIds.includes(req.body.problemId)) throw notFound('Problem');
    const [d] = await getDb()
      .insert(codeDrafts)
      .values({ interviewId: li.interview.id, problemId: req.body.problemId, languageId: req.body.languageId, sourceCode: req.body.sourceCode, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [codeDrafts.interviewId, codeDrafts.problemId], set: { languageId: req.body.languageId, sourceCode: req.body.sourceCode, updatedAt: new Date() } })
      .returning();
    return { problemId: d!.problemId, languageId: d!.languageId as z.infer<typeof DraftDto>['languageId'], sourceCode: d!.sourceCode, updatedAt: d!.updatedAt.toISOString() };
  });

  /** Run sample cases (and an optional custom input) synchronously for quick feedback. */
  app.post('/interviews/:id/coding/run', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['coding'], params: Params, body: RunCodeBody, response: { 200: SubmissionDto } } }, async (req) => {
    const { li, section, plan } = await codingContext(req.params.id, req.user!);
    if (!plan.problemIds.includes(req.body.problemId)) throw notFound('Problem');
    if (!plan.languageIds.includes(req.body.languageId)) throw badRequest('Language not allowed in this section');
    const [problem] = await getDb().select().from(codingProblems).where(eq(codingProblems.id, req.body.problemId)).limit(1);
    if (!problem) throw notFound('Problem');
    const cases = problem.testCases.filter((t) => t.isSample).slice(0, 5);
    if (req.body.customInput !== undefined) cases.push({ input: req.body.customInput, expectedOutput: '', isSample: true, weight: 0, label: 'Custom input' });
    const out = await gradeSubmission({ languageId: req.body.languageId, sourceCode: req.body.sourceCode, cases, timeLimitMs: problem.timeLimitMs, memoryLimitMb: problem.memoryLimitMb, revealAll: true });
    const results = out.results.map((r) => (r.label === 'Custom input' ? { ...r, verdict: r.verdict === 'wrong_answer' ? ('passed' as const) : r.verdict, expectedOutput: null } : r));
    const [s] = await getDb()
      .insert(codeSubmissions)
      .values({ interviewId: li.interview.id, problemId: problem.id, sectionIndex: section.index, languageId: req.body.languageId, sourceCode: req.body.sourceCode, kind: 'run', status: out.status, runner: out.runner, compileOutput: out.compileOutput, errorMessage: out.errorMessage, results, passed: out.passed, total: out.total, score: null, gradedAt: new Date() })
      .returning();
    return toSubmissionDto(s!, true);
  });

  /** Submit for grading against all cases (asynchronous). */
  app.post('/interviews/:id/coding/submit', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['coding'], params: Params, body: SubmitCodeBody, response: { 202: SubmissionDto } } }, async (req, reply) => {
    const { li, section, plan } = await codingContext(req.params.id, req.user!);
    if (!plan.problemIds.includes(req.body.problemId)) throw notFound('Problem');
    if (!plan.languageIds.includes(req.body.languageId)) throw badRequest('Language not allowed in this section');
    const [problem] = await getDb().select().from(codingProblems).where(eq(codingProblems.id, req.body.problemId)).limit(1);
    if (!problem) throw notFound('Problem');
    const [s] = await getDb()
      .insert(codeSubmissions)
      .values({ interviewId: li.interview.id, problemId: problem.id, sectionIndex: section.index, languageId: req.body.languageId, sourceCode: req.body.sourceCode, kind: 'submit', status: 'queued', total: problem.testCases.length })
      .returning();
    await getDb().insert(codeDrafts).values({ interviewId: li.interview.id, problemId: problem.id, languageId: req.body.languageId, sourceCode: req.body.sourceCode }).onConflictDoUpdate({ target: [codeDrafts.interviewId, codeDrafts.problemId], set: { languageId: req.body.languageId, sourceCode: req.body.sourceCode, updatedAt: new Date() } });
    await getDb().insert(transcriptEvents).values({ interviewId: li.interview.id, sectionIndex: section.index, speaker: 'system', text: `Submitted solution for "${problem.title}" (${req.body.languageId}).` });
    await enqueue('submission.grade', { submissionId: s!.id }, { singletonKey: `grade:${s!.id}` });
    const [fresh] = await getDb().select().from(codeSubmissions).where(eq(codeSubmissions.id, s!.id)).limit(1);
    return reply.status(202).send(toSubmissionDto(fresh!, false));
  });

  app.get('/interviews/:id/coding/submissions/:sid', { schema: { tags: ['coding'], params: Params.extend({ sid: z.uuid() }), response: { 200: SubmissionDto } } }, async (req) => {
    const li = await isvc.loadInterview(req.params.id);
    isvc.assertCandidate(li, req.user!);
    const [s] = await getDb().select().from(codeSubmissions).where(and(eq(codeSubmissions.id, req.params.sid), eq(codeSubmissions.interviewId, li.interview.id))).limit(1);
    if (!s) throw notFound('Submission');
    return toSubmissionDto(s, false);
  });

  /** AI follow-up on a graded submission: feedback for the candidate plus questions the interviewer asks next. */
  app.post('/interviews/:id/coding/submissions/:sid/review', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['coding'], params: Params.extend({ sid: z.uuid() }), response: { 200: z.object({ feedback: z.string(), followUpQuestions: z.array(z.string()) }) } } }, async (req) => {
    const li = await isvc.loadInterview(req.params.id);
    isvc.assertCandidate(li, req.user!);
    const [s] = await getDb().select().from(codeSubmissions).where(and(eq(codeSubmissions.id, req.params.sid), eq(codeSubmissions.interviewId, li.interview.id))).limit(1);
    if (!s) throw notFound('Submission');
    if (s.status !== 'graded') throw conflict('Submission is not graded yet');
    const [problem] = await getDb().select().from(codingProblems).where(eq(codingProblems.id, s.problemId)).limit(1);
    const review = await reviewCode({ jobTitle: li.job.title, problemStatement: problem?.statement ?? '', sourceCode: s.sourceCode, languageId: s.languageId, passed: s.passed, total: s.total });
    await getDb().insert(transcriptEvents).values({ interviewId: li.interview.id, sectionIndex: s.sectionIndex, speaker: 'interviewer', text: review.followUpQuestions.join('\n') });
    return review;
  });

  void redactResults;
  void asc;
};
