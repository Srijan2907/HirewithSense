import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { isProd } from '../config/env.js';
import { isAppError } from '../lib/errors.js';

export function registerErrorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: `Route ${req.method} ${req.url.split('?')[0]} not found`, requestId: req.id } });
  });

  app.setErrorHandler((error: FastifyError | Error, req, reply) => {
    const requestId = req.id;

    if (isAppError(error)) {
      if (error.statusCode >= 500) req.log.error({ err: error }, error.message);
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details, requestId },
      });
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: error.validation.map((v) => {
            const issue = (v.params as { issue?: { path?: (string | number)[] } } | undefined)?.issue;
            return { path: v.instancePath || issue?.path?.join('.') || '', message: v.message };
          }),
          requestId,
        },
      });
    }

    if (isResponseSerializationError(error)) {
      req.log.error({ err: error, issues: error.cause?.issues }, 'response serialization failed');
      return reply.status(500).send({ error: { code: 'internal_error', message: 'Response did not match schema', requestId } });
    }

    const fe = error as FastifyError;
    const status = typeof fe.statusCode === 'number' ? fe.statusCode : 500;
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'rate_limited', message: fe.message, requestId } });
    }
    if (status === 413 || fe.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'payload_too_large', message: 'Upload exceeds the size limit', requestId } });
    }
    if (status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: fe.code?.toLowerCase() ?? 'bad_request', message: fe.message, requestId } });
    }

    req.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'internal_error', message: isProd() ? 'Internal server error' : error.message, requestId },
    });
  });
}
