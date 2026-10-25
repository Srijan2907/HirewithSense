import { eq } from 'drizzle-orm';
import mammoth from 'mammoth';
import type { ResumeDto } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { resumes, type Resume } from '../../db/schema.js';
import { badRequest } from '../../lib/errors.js';
import { parseResumeProfile } from '../../services/ai/tasks.js';

export async function extractText(buffer: Buffer, mime: string): Promise<string> {
  if (mime === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return (result.text ?? '').trim();
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return (result.value ?? '').trim();
  }
  if (mime === 'text/plain') return buffer.toString('utf8').trim();
  throw badRequest('Unsupported resume type. Upload a PDF, DOCX or TXT file.');
}

export const toResumeDto = (r: Resume): ResumeDto => ({
  id: r.id,
  userId: r.userId,
  originalName: r.originalName,
  mimeType: r.mimeType,
  sizeBytes: r.sizeBytes,
  parseStatus: r.parseStatus,
  parseError: r.parseError,
  profile: r.profile ?? null,
  textPreview: r.extractedText ? r.extractedText.slice(0, 600) : null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** Background job body: parse a resume's extracted text into a structured profile. */
export async function parseResumeJob(resumeId: string): Promise<void> {
  const db = getDb();
  const [r] = await db.select().from(resumes).where(eq(resumes.id, resumeId)).limit(1);
  if (!r) return;
  await db.update(resumes).set({ parseStatus: 'parsing', parseError: null }).where(eq(resumes.id, r.id));
  try {
    const profile = await parseResumeProfile(r.extractedText);
    await db.update(resumes).set({ parseStatus: 'parsed', profile }).where(eq(resumes.id, r.id));
  } catch (err) {
    await db.update(resumes).set({ parseStatus: 'failed', parseError: (err as Error).message.slice(0, 500) }).where(eq(resumes.id, r.id));
    throw err;
  }
}
