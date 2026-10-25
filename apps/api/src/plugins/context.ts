import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';

declare module 'fastify' {
  interface FastifyRequest {
    clientIp: string;
    startedAt: number;
  }
}

/** Request id propagation, client ip, and structured access logging. */
export default fp(async (app) => {
  app.decorateRequest('clientIp', '');
  app.decorateRequest('startedAt', 0);

  app.addHook('onRequest', async (req, reply) => {
    req.startedAt = Date.now();
    req.clientIp = req.ip;
    reply.header('x-request-id', req.id);
  });

  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/health') || req.url === '/metrics') return;
    req.log.info(
      {
        method: req.method,
        url: req.url.split('?')[0],
        status: reply.statusCode,
        ms: Date.now() - req.startedAt,
        user: req.user?.id,
      },
      'request',
    );
  });
}, { name: 'context' });

export const genReqId = (req: { headers: Record<string, unknown> }) => {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && /^[\w.-]{8,64}$/.test(incoming) ? incoming : randomUUID();
};
