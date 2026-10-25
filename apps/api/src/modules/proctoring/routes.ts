import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ProctoringBatchBody } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { proctoringEvents } from '../../db/schema.js';
import { assertCandidate, loadInterview } from '../interviews/service.js';

export const proctoringRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  /** Batched interface telemetry from the interview client. Accepted only while the interview is in progress. */
  app.post('/interviews/:id/events', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { tags: ['proctoring'], params: z.object({ id: z.uuid() }), body: ProctoringBatchBody, response: { 202: z.object({ accepted: z.number().int() }) } } }, async (req, reply) => {
    const li = await loadInterview(req.params.id);
    assertCandidate(li, req.user!);
    if (li.interview.status !== 'in_progress') return reply.status(202).send({ accepted: 0 });
    const now = Date.now();
    const rows = req.body.events
      .filter((e) => Math.abs(now - new Date(e.at).getTime()) < 6 * 3600_000)
      .map((e) => ({ interviewId: li.interview.id, type: e.type, at: new Date(e.at), sectionIndex: e.sectionIndex ?? li.interview.currentSection, meta: e.meta ?? null }));
    if (rows.length) await getDb().insert(proctoringEvents).values(rows);
    return reply.status(202).send({ accepted: rows.length });
  });
};
