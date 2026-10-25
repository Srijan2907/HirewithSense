import fp from 'fastify-plugin';
import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'hws_' });

export const httpDuration = new client.Histogram({
  name: 'hws_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const aiCalls = new client.Counter({
  name: 'hws_ai_calls_total',
  help: 'AI provider calls',
  labelNames: ['task', 'provider', 'outcome'],
  registers: [registry],
});

export const codeRuns = new client.Counter({
  name: 'hws_code_runs_total',
  help: 'Code executions',
  labelNames: ['runner', 'language', 'verdict'],
  registers: [registry],
});

export const jobsProcessed = new client.Counter({
  name: 'hws_jobs_processed_total',
  help: 'Background jobs processed',
  labelNames: ['queue', 'outcome'],
  registers: [registry],
});

export default fp(async (app) => {
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unmatched';
    if (route === '/metrics' || route.startsWith('/health')) return;
    httpDuration.observe({ method: req.method, route, status: String(reply.statusCode) }, (Date.now() - req.startedAt) / 1000);
  });
  app.get('/metrics', { schema: { hide: true } }, async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}, { name: 'metrics' });
