import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { CandidateProfile, OkResponse, PublicUser, UpdateProfileBody } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { interviews, resumes, users } from '../../db/schema.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../services/audit.js';
import { getStorage } from '../../services/storage.js';
import { revokeAll, toPublicUser } from '../auth/service.js';

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/me', { schema: { tags: ['users'], response: { 200: PublicUser.extend({ profile: CandidateProfile }) } } }, async (req) => {
    const [u] = await getDb().select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!u) throw notFound('User');
    return { ...(await toPublicUser(u)), profile: { headline: u.headline, location: u.location, timezone: u.timezone } };
  });

  app.patch('/me', { schema: { tags: ['users'], body: UpdateProfileBody, response: { 200: PublicUser.extend({ profile: CandidateProfile }) } } }, async (req) => {
    const db = getDb();
    const b = req.body;
    if (b.username) {
      const [taken] = await db.select({ id: users.id }).from(users).where(and(eq(users.username, b.username), ne(users.id, req.user!.id))).limit(1);
      if (taken) throw conflict('This username is taken');
    }
    const [u] = await db
      .update(users)
      .set({
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.username !== undefined ? { username: b.username } : {}),
        ...(b.headline !== undefined ? { headline: b.headline } : {}),
        ...(b.location !== undefined ? { location: b.location } : {}),
        ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
      })
      .where(eq(users.id, req.user!.id))
      .returning();
    return { ...(await toPublicUser(u!)), profile: { headline: u!.headline, location: u!.location, timezone: u!.timezone } };
  });

  /**
   * Candidate data deletion (GDPR / Illinois AIVIA style). Interview rows are kept as anonymised
   * tombstones for the employer's audit needs; transcripts, answers, code, reports and files go.
   */
  app.post('/me/delete', { schema: { tags: ['users'], body: z.object({ confirmEmail: z.string() }), response: { 200: OkResponse } } }, async (req) => {
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!u) throw notFound('User');
    if (u.email !== req.body.confirmEmail.trim().toLowerCase()) throw conflict('Email confirmation does not match');
    const storage = getStorage();
    const files = await db.select({ key: resumes.storageKey }).from(resumes).where(eq(resumes.userId, u.id));
    await Promise.all(files.map((f) => storage.delete(f.key).catch(() => {})));
    await db.transaction(async (tx) => {
      await tx.delete(resumes).where(eq(resumes.userId, u.id));
      const { interviewTurns, transcriptEvents, codeSubmissions, codeDrafts, proctoringEvents, reports } = await import('../../db/schema.js');
      const mine = await tx.select({ id: interviews.id }).from(interviews).where(eq(interviews.candidateId, u.id));
      for (const i of mine) {
        await tx.delete(interviewTurns).where(eq(interviewTurns.interviewId, i.id));
        await tx.delete(transcriptEvents).where(eq(transcriptEvents.interviewId, i.id));
        await tx.delete(codeSubmissions).where(eq(codeSubmissions.interviewId, i.id));
        await tx.delete(codeDrafts).where(eq(codeDrafts.interviewId, i.id));
        await tx.delete(proctoringEvents).where(eq(proctoringEvents.interviewId, i.id));
        await tx.delete(reports).where(eq(reports.interviewId, i.id));
      }
      const anon = `deleted-${u.id.slice(0, 8)}`;
      await tx
        .update(users)
        .set({ name: 'Deleted candidate', username: anon, email: `${anon}@deleted.invalid`, passwordHash: 'deleted', headline: null, location: null, timezone: null, deletedAt: new Date() })
        .where(eq(users.id, u.id));
    });
    await revokeAll(u.id);
    audit({ action: 'user.deleted', targetType: 'user', targetId: u.id, actorId: u.id }, req);
    return { ok: true as const };
  });
};
