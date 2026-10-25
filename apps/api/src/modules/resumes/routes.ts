import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { OkResponse, ResumeDto } from '@hws/shared';
import { env } from '../../config/env.js';
import { getDb } from '../../db/client.js';
import { resumes } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { audit } from '../../services/audit.js';
import { getStorage } from '../../services/storage.js';
import { enqueue } from '../../jobs/boss.js';
import { extractText, toResumeDto } from './service.js';

const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
};

export const resumeRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(multipart, { limits: { fileSize: env().MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 2 } });
  app.addHook('preHandler', app.authenticate);

  app.post('/', { schema: { tags: ['resumes'], consumes: ['multipart/form-data'], response: { 201: ResumeDto } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest("Attach a file in the 'resume' field");
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw badRequest(`File exceeds ${env().MAX_UPLOAD_MB} MB`);

    const { fileTypeFromBuffer } = await import('file-type');
    const sniffed = await fileTypeFromBuffer(buffer);
    let mime = sniffed?.mime ?? (file.mimetype === 'text/plain' ? 'text/plain' : file.mimetype);
    if (sniffed?.mime === 'application/zip' && file.filename.toLowerCase().endsWith('.docx')) mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!ALLOWED[mime]) throw badRequest('Only PDF, DOCX and TXT resumes are accepted');

    let text: string;
    try {
      text = await extractText(buffer, mime);
    } catch (err) {
      throw badRequest(`Could not read the file: ${(err as Error).message}`);
    }
    if (text.length < 40) throw badRequest('No readable text found. Scanned PDFs need OCR before upload.');

    const stored = await getStorage().put(buffer, { prefix: `resumes/${req.user!.id}`, ext: ALLOWED[mime]!, contentType: mime });
    const [r] = await getDb()
      .insert(resumes)
      .values({ userId: req.user!.id, originalName: file.filename.slice(0, 200), mimeType: mime, sizeBytes: stored.sizeBytes, storageKey: stored.key, extractedText: text.slice(0, 60_000), parseStatus: 'pending' })
      .returning();
    await enqueue('resume.parse', { resumeId: r!.id }, { singletonKey: `resume:${r!.id}` });
    audit({ action: 'resume.uploaded', targetType: 'resume', targetId: r!.id }, req);
    const [fresh] = await getDb().select().from(resumes).where(eq(resumes.id, r!.id)).limit(1);
    return reply.status(201).send(toResumeDto(fresh!));
  });

  app.get('/me', { schema: { tags: ['resumes'], response: { 200: ResumeDto.nullable() } } }, async (req) => {
    const [r] = await getDb().select().from(resumes).where(eq(resumes.userId, req.user!.id)).orderBy(desc(resumes.createdAt)).limit(1);
    return r ? toResumeDto(r) : null;
  });

  app.get('/', { schema: { tags: ['resumes'], response: { 200: z.array(ResumeDto) } } }, async (req) => {
    const rows = await getDb().select().from(resumes).where(eq(resumes.userId, req.user!.id)).orderBy(desc(resumes.createdAt));
    return rows.map(toResumeDto);
  });

  app.post('/:id/reparse', { schema: { tags: ['resumes'], params: z.object({ id: z.uuid() }), response: { 200: ResumeDto } } }, async (req) => {
    const [r] = await getDb().select().from(resumes).where(and(eq(resumes.id, req.params.id), eq(resumes.userId, req.user!.id))).limit(1);
    if (!r) throw notFound('Resume');
    await getDb().update(resumes).set({ parseStatus: 'pending', parseError: null }).where(eq(resumes.id, r.id));
    await enqueue('resume.parse', { resumeId: r.id }, { singletonKey: `resume:${r.id}:${Date.now()}` });
    const [fresh] = await getDb().select().from(resumes).where(eq(resumes.id, r.id)).limit(1);
    return toResumeDto(fresh!);
  });

  app.delete('/:id', { schema: { tags: ['resumes'], params: z.object({ id: z.uuid() }), response: { 200: OkResponse } } }, async (req) => {
    const [r] = await getDb().select().from(resumes).where(and(eq(resumes.id, req.params.id), eq(resumes.userId, req.user!.id))).limit(1);
    if (!r) throw notFound('Resume');
    await getStorage().delete(r.storageKey).catch(() => {});
    await getDb().delete(resumes).where(eq(resumes.id, r.id));
    return { ok: true as const };
  });
};
