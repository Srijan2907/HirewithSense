import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/client.js';

const Health = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
  time: z.string(),
  checks: z.record(z.string(), z.object({ ok: z.boolean(), ms: z.number().optional(), error: z.string().optional() })),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/health/live', { schema: { tags: ['health'], security: [], response: { 200: z.object({ status: z.literal('ok') }) } } }, async () => ({ status: 'ok' as const }));

  app.get('/health/ready', { schema: { tags: ['health'], security: [], response: { 200: Health, 503: Health } } }, async (_req, reply) => {
    const checks: z.infer<typeof Health>['checks'] = {};
    const t = Date.now();
    try {
      await getDb().execute(sql`select 1`);
      checks.database = { ok: true, ms: Date.now() - t };
    } catch (err) {
      checks.database = { ok: false, error: (err as Error).message };
    }
    const ok = Object.values(checks).every((c) => c.ok);
    const body = { status: ok ? ('ok' as const) : ('degraded' as const), service: 'hirewithsense-api', version: '2.0.0', time: new Date().toISOString(), checks };
    return reply.status(ok ? 200 : 503).send(body);
  });
};
