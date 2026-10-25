import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { AiStatusDto } from '@hws/shared';
import { env } from '../../config/env.js';
import { badRequest, unavailable } from '../../lib/errors.js';
import { getAi } from '../../services/ai/provider.js';
import { emailConfigured, emailTransportName } from '../../services/email.js';
import { getRunner } from '../../services/runner/index.js';

export const aiRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  app.addHook('preHandler', app.authenticate);

  app.get('/status', { schema: { tags: ['ai'], response: { 200: AiStatusDto } } }, async () => {
    const [ai, runner] = await Promise.all([getAi(), getRunner()]);
    const languages = await runner.availableLanguages();
    return {
      provider: ai.name,
      model: ai.model,
      configured: ai.configured,
      features: { questions: true, evaluation: true, reports: true, resumeParsing: true, transcription: ai.audio, speech: ai.audio },
      codeRunner: { kind: runner.kind, available: languages.length > 0, languages },
      email: { transport: emailTransportName(), configured: emailConfigured() },
    };
  });

  /** Speech-to-text for recorded answers. Browser speech recognition is used when this is unavailable. */
  app.post('/transcribe', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['ai'], consumes: ['multipart/form-data'], response: { 200: z.object({ text: z.string() }) } } }, async (req) => {
    const ai = await getAi();
    if (!ai.audio) throw unavailable('Server-side transcription is not configured');
    const file = await req.file();
    if (!file) throw badRequest("Attach audio in the 'audio' field");
    const buffer = await file.toBuffer();
    const text = await ai.transcribe(buffer, file.filename || 'audio.webm', file.mimetype);
    return { text };
  });

  /** Text-to-speech for interviewer questions. */
  app.post('/speak', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['ai'], body: z.object({ text: z.string().min(1).max(2000) }), response: { 200: z.any() } } }, async (req, reply) => {
    const ai = await getAi();
    if (!ai.audio) throw unavailable('Server-side speech synthesis is not configured');
    const { audio, mime } = await ai.speak(req.body.text);
    reply.header('content-type', mime);
    reply.header('cache-control', 'private, max-age=3600');
    return reply.send(audio);
  });

  void env;
};
