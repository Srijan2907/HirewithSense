import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AI_DISCLOSURE_TEXT,
  AI_DISCLOSURE_VERSION,
  AnswerBody,
  AppendTranscriptBody,
  CandidateTurnDto,
  ConsentBody,
  ConsentDto,
  DecisionDto,
  InterviewDto,
  InterviewListQuery,
  InterviewRoomState,
  InterviewSummaryDto,
  OkResponse,
  ProctoringEventDto,
  ReportDto,
  SkipTurnBody,
  SubmissionDto,
  TranscriptEventDto,
  TurnDto,
  paginated,
} from '@hws/shared';
import { getDb } from '../../db/client.js';
import { codeSubmissions, consents, decisions, interviewTurns, proctoringEvents, reports, transcriptEvents, users } from '../../db/schema.js';
import { conflict, forbidden } from '../../lib/errors.js';
import { audit } from '../../services/audit.js';
import * as svc from './service.js';
import { toSubmissionDto } from '../coding/service.js';
import { toReportDto, toDecisionDto } from '../reports/service.js';

const Params = z.object({ id: z.uuid() });

export const interviewRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/disclosure', { schema: { tags: ['interviews'], response: { 200: z.object({ version: z.string(), text: z.string() }) } } }, async () => ({ version: AI_DISCLOSURE_VERSION, text: AI_DISCLOSURE_TEXT }));

  /* ------------------------------- candidate ------------------------------- */

  app.get('/mine', { schema: { tags: ['interviews'], response: { 200: z.array(InterviewSummaryDto) } } }, async (req) => {
    const r = await svc.listInterviews({ candidateId: req.user!.id, sort: 'recent', page: 1, pageSize: 100 });
    return r.items.map((i) => ({ ...i, weightedScore: null, recommendation: null, decision: null, integrityFlags: 0 }));
  });

  app.get('/:id', { schema: { tags: ['interviews'], params: Params, response: { 200: InterviewDto } } }, async (req) => {
    const li = await svc.loadInterview(req.params.id);
    if (req.user!.role === 'candidate') svc.assertCandidate(li, req.user!);
    else svc.assertRecruiter(li, req.user!);
    return svc.toInterviewDto(li);
  });

  app.get('/:id/room', { schema: { tags: ['interviews'], params: Params, response: { 200: InterviewRoomState } } }, async (req) => {
    const li = await svc.loadInterview(req.params.id);
    svc.assertCandidate(li, req.user!);
    const turns = await getDb().select().from(interviewTurns).where(eq(interviewTurns.interviewId, li.interview.id)).orderBy(asc(interviewTurns.sectionIndex), asc(interviewTurns.order));
    const cur = li.interview.currentSection;
    const plan = cur !== null ? li.interview.plan.sections[cur] : undefined;
    const remaining = plan?.type === 'conversation' ? plan.questionCount - turns.filter((t) => t.sectionIndex === cur).length : null;
    return { interview: svc.toInterviewDto(li), turns: turns.map(svc.toCandidateTurnDto), remainingQuestions: remaining };
  });

  app.post('/:id/consent', { schema: { tags: ['interviews'], params: Params, body: ConsentBody, response: { 200: ConsentDto } } }, async (req) => {
    const li = await svc.loadInterview(req.params.id);
    svc.assertCandidate(li, req.user!);
    return svc.recordConsent(li, req.user!, req.body, req);
  });

  app.post('/:id/start', { schema: { tags: ['interviews'], params: Params, response: { 200: InterviewDto } } }, async (req) => {
    const li = await svc.loadInterview(req.params.id);
    svc.assertCandidate(li, req.user!);
    const updated = await svc.startInterview(li, req);
    return svc.toInterviewDto({ ...li, interview: updated });
  });

  /** Server-sent events: streams the interviewer's next question token by token, then the saved turn. */
  app.post('/:id/next-question', { schema: { tags: ['interviews'], params: Params, produces: ['text/event-stream'], response: { 200: z.any() } } }, async (req, reply) => {
    const li = await svc.loadInterview(req.params.id);
    svc.assertCandidate(li, req.user!);
    const result = await svc.nextQuestion(li);

    reply.hijack();
    const headers = { ...reply.getHeaders(), 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } as Record<string, string | number | string[]>;
    delete headers['content-length'];
    reply.raw.writeHead(200, headers);
    const send = (ev: unknown) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);

    try {
      if (result.kind === 'section_complete') {
        send({ type: 'section_complete', sectionIndex: li.interview.currentSection });
      } else if (result.existing) {
        send({ type: 'question', turn: svc.toCandidateTurnDto(result.existing), remaining: result.remaining });
      } else if (result.stream && result.finalize) {
        let text = '';
        try {
          for await (const token of result.stream) {
            text += token;
            send({ type: 'token', text: token });
          }
        } catch (err) {
          req.log.warn({ err }, 'question stream failed; falling back');
          if (!text.trim()) text = `Tell me about the experience on your resume that is most relevant to the ${li.job.title} role, and what you personally contributed.`;
        }
        const turn = await result.finalize(text);
        send({ type: 'question', turn: svc.toCandidateTurnDto(turn), remaining: result.remaining });
      }
    } catch (err) {
      send({ type: 'error', message: (err as Error).message });
    } finally {
      reply.raw.end();
    }
    return reply;
  });

  app.post('/:id/answers', { schema: { tags: ['interviews'], params: Params, body: AnswerBody, response: { 200: CandidateTurnDto } } }, async (req) => {
    const li = await svc.loadInterview(req.params.id);
    svc.assertCandidate(li, req.user!);
    return svc.toCandidateTurnDto(await svc.answerTurn(li, req.body, req));
  });

  app.post('/:id/skip', { schema: { tags: ['interviews'], params: Params, body: SkipTurnBody, response: { 200: CandidateTurnDto } } }, async (req) => {
    const li = await svc.loadInterview(req.params.id);
    svc.assertCandidate(li, req.user!);
    return svc.toCandidateTurnDto(await svc.skipTurn(li, req.body.turnId));
  });

  app.post('/:id/transcript', { schema: { tags: ['interviews'], params: Params, body: AppendTranscriptBody, response: { 201: TranscriptEventDto } } }, async (req, reply) => {
    const li = await svc.loadInterview(req.params.id);
    svc.assertCandidate(li, req.user!);
    const section = svc.assertWritable(li.interview);
    const [ev] = await getDb().insert(transcriptEvents).values({ interviewId: li.interview.id, sectionIndex: section.index, speaker: 'candidate', text: req.body.text, turnId: req.body.turnId ?? null, at: req.body.at ? new Date(req.body.at) : new Date() }).returning();
    return reply.status(201).send(svc.toTranscriptDto(ev!));
  });

  app.post('/:id/sections/:index/complete', { schema: { tags: ['interviews'], params: Params.extend({ index: z.coerce.number().int().min(0) }), response: { 200: InterviewDto } } }, async (req) => {
    const li = await svc.loadInterview(req.params.id);
    svc.assertCandidate(li, req.user!);
    const updated = await svc.completeSection(li, req.params.index, req);
    return svc.toInterviewDto({ ...li, interview: updated });
  });

  app.post('/:id/finish', { schema: { tags: ['interviews'], params: Params, response: { 200: InterviewDto } } }, async (req) => {
    const li = await svc.loadInterview(req.params.id);
    svc.assertCandidate(li, req.user!);
    const updated = await svc.finishInterview(li, 'completed', req);
    return svc.toInterviewDto({ ...li, interview: updated });
  });

  /* ------------------------------- recruiter ------------------------------- */

  const recruiter: FastifyPluginAsyncZod = async (r) => {
    r.addHook('preHandler', r.requireOrg());

    r.get('/', { schema: { tags: ['interviews'], querystring: InterviewListQuery, response: { 200: paginated(InterviewSummaryDto) } } }, async (req) => {
      return svc.listInterviews({ orgId: req.user!.org!.id, jobId: req.query.jobId, status: req.query.status, q: req.query.q, sort: req.query.sort, page: req.query.page, pageSize: req.query.pageSize });
    });

    const Detail = z.object({
      interview: InterviewDto,
      turns: z.array(TurnDto),
      transcript: z.array(TranscriptEventDto),
      submissions: z.array(SubmissionDto),
      events: z.array(ProctoringEventDto),
      report: ReportDto.nullable(),
      decision: DecisionDto.nullable(),
      consent: ConsentDto.nullable(),
    });

    r.get('/:id/detail', { schema: { tags: ['interviews'], params: Params, response: { 200: Detail } } }, async (req) => {
      const li = await svc.loadInterview(req.params.id);
      svc.assertRecruiter(li, req.user!);
      const db = getDb();
      const id = li.interview.id;
      const [turns, transcript, subs, events, [report], [decisionRow], [consent]] = await Promise.all([
        db.select().from(interviewTurns).where(eq(interviewTurns.interviewId, id)).orderBy(asc(interviewTurns.sectionIndex), asc(interviewTurns.order)),
        db.select().from(transcriptEvents).where(eq(transcriptEvents.interviewId, id)).orderBy(asc(transcriptEvents.at)),
        db.select().from(codeSubmissions).where(eq(codeSubmissions.interviewId, id)).orderBy(asc(codeSubmissions.createdAt)),
        db.select().from(proctoringEvents).where(eq(proctoringEvents.interviewId, id)).orderBy(asc(proctoringEvents.at)),
        db.select().from(reports).where(eq(reports.interviewId, id)).limit(1),
        db.select({ d: decisions, name: users.name }).from(decisions).leftJoin(users, eq(users.id, decisions.decidedBy)).where(eq(decisions.interviewId, id)).limit(1),
        db.select().from(consents).where(eq(consents.interviewId, id)).limit(1),
      ]);
      audit({ action: 'interview.viewed', targetType: 'interview', targetId: id }, req);
      return {
        interview: svc.toInterviewDto(li),
        turns: turns.map(svc.toTurnDto),
        transcript: transcript.map(svc.toTranscriptDto),
        submissions: subs.map((s) => toSubmissionDto(s, true)),
        events: events.map((e) => ({ id: e.id, type: e.type as any, at: e.at.toISOString(), sectionIndex: e.sectionIndex, meta: e.meta ?? undefined, receivedAt: e.receivedAt.toISOString() })),
        report: report ? toReportDto(report) : null,
        decision: decisionRow ? toDecisionDto(decisionRow.d, decisionRow.name ?? 'Unknown') : null,
        consent: consent ? { disclosureVersion: consent.disclosureVersion, textHash: consent.textHash, consentedAt: consent.consentedAt.toISOString(), accommodationRequest: consent.accommodationRequest } : null,
      };
    });

    r.post('/:id/cancel', { preHandler: r.requireOrg('owner', 'admin'), schema: { tags: ['interviews'], params: Params, response: { 200: OkResponse } } }, async (req) => {
      const li = await svc.loadInterview(req.params.id);
      svc.assertRecruiter(li, req.user!);
      if (!['invited', 'ready'].includes(li.interview.status)) throw conflict('Only interviews that have not started can be cancelled');
      const { interviews } = await import('../../db/schema.js');
      await getDb().update(interviews).set({ status: 'cancelled' }).where(eq(interviews.id, li.interview.id));
      audit({ action: 'interview.cancelled', targetType: 'interview', targetId: li.interview.id }, req);
      return { ok: true as const };
    });

    r.post('/:id/force-finish', { preHandler: r.requireOrg('owner', 'admin'), schema: { tags: ['interviews'], params: Params, response: { 200: InterviewDto } } }, async (req) => {
      const li = await svc.loadInterview(req.params.id);
      svc.assertRecruiter(li, req.user!);
      if (li.interview.status !== 'in_progress') throw conflict('Interview is not in progress');
      const updated = await svc.finishInterview(li, 'expired', req);
      return svc.toInterviewDto({ ...li, interview: updated });
    });
  };
  await app.register(recruiter);

  void forbidden;
};
