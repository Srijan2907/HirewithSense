import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { env, isProd, isTest } from './config/env.js';
import contextPlugin, { genReqId } from './plugins/context.js';
import securityPlugin from './plugins/security.js';
import authPlugin from './plugins/auth.js';
import swaggerPlugin from './plugins/swagger.js';
import metricsPlugin from './plugins/metrics.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { healthRoutes } from './modules/health/routes.js';
import { apiRoutes } from './modules/index.js';

export type App = FastifyInstance;

export async function buildApp(): Promise<App> {
  const e = env();
  const app = Fastify({
    logger: isTest()
      ? false
      : {
          level: e.LOG_LEVEL,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          ...(isProd()
            ? {}
            : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
        },
    disableRequestLogging: true,
    genReqId,
    trustProxy: e.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(contextPlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(metricsPlugin);
  if (!isTest()) await app.register(swaggerPlugin);

  await app.register(healthRoutes);
  await app.register(apiRoutes, { prefix: '/api/v1' });

  if (e.SERVE_WEB_DIR) {
    const root = path.resolve(e.SERVE_WEB_DIR);
    await app.register(fastifyStatic, { root, prefix: '/', wildcard: false, decorateReply: true });
    app.get('/*', { schema: { hide: true } }, (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/docs')) {
        return reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
