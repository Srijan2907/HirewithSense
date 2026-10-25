import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { env, isProd } from '../config/env.js';

export default fp(async (app) => {
  const e = env();
  await app.register(helmet, {
    contentSecurityPolicy: e.SERVE_WEB_DIR
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'", ...(e.PUBLIC_API_URL ? [e.PUBLIC_API_URL] : [])],
            workerSrc: ["'self'", 'blob:'],
            mediaSrc: ["'self'", 'blob:', 'data:'],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  const origins = e.CLIENT_ORIGINS.length ? e.CLIENT_ORIGINS : [e.PUBLIC_WEB_URL];
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origins.includes(origin)) return cb(null, true);
      if (!isProd() && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      cb(new Error('Origin not allowed'), false);
    },
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  await app.register(cookie, { hook: 'onRequest' });

  await app.register(rateLimit, {
    global: true,
    max: e.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    allowList: (req) => e.RATE_LIMIT_ENABLED === 'false' || req.url.startsWith('/health') || req.url === '/metrics',
    keyGenerator: (req) => req.user?.id ?? req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Too many requests. Retry in ${Math.ceil(ctx.ttl / 1000)}s.`,
    }),
  });
}, { name: 'security' });
