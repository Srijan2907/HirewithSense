import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AcceptInviteBody, AuthResponse, BulkCreateInviteBody, CreateInviteBody, InterviewInviteDto, InvitePreview, OkResponse, Username } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { interviewInvites, interviews, jobs, organizations, users, type InterviewInvite } from '../../db/schema.js';
import { hashPassword, randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, gone, notFound } from '../../lib/errors.js';
import { addDays } from '../../lib/util.js';
import { audit } from '../../services/audit.js';
import { interviewInviteMail } from '../../services/email.js';
import { enqueue } from '../../jobs/boss.js';
import { ensureUniqueIdentity, issueSession } from '../auth/service.js';
import { getOrgJob } from '../jobs/service.js';
import { createInterviewFromInvite } from '../interviews/service.js';

const toDto = (inv: InterviewInvite, inviter: string | null): z.infer<typeof InterviewInviteDto> => ({
  id: inv.id,
  jobId: inv.jobId,
  email: inv.email,
  candidateName: inv.candidateName,
  message: inv.message,
  status: inv.status,
  expiresAt: inv.expiresAt.toISOString(),
  acceptedAt: inv.acceptedAt?.toISOString() ?? null,
  interviewId: inv.interviewId,
  invitedBy: inviter ?? 'Unknown',
  createdAt: inv.createdAt.toISOString(),
});

export const inviteRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ------------------------------ public ------------------------------ */
  app.get('/:token', { schema: { tags: ['invites'], security: [], params: z.object({ token: z.string().min(10) }), response: { 200: InvitePreview } } }, async (req) => {
    const [row] = await getDb()
      .select({ inv: interviewInvites, job: jobs, orgName: organizations.name })
      .from(interviewInvites)
      .innerJoin(jobs, eq(jobs.id, interviewInvites.jobId))
      .innerJoin(organizations, eq(organizations.id, interviewInvites.organizationId))
      .where(eq(interviewInvites.tokenHash, sha256(req.params.token)))
      .limit(1);
    if (!row) throw notFound('Invitation');
    if (row.inv.status === 'cancelled') throw gone('This invitation was withdrawn');
    if (row.inv.status === 'pending' && row.inv.expiresAt < new Date()) throw gone('This invitation has expired');
    const [existing] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, row.inv.email)).limit(1);
    return {
      jobTitle: row.job.title,
      organizationName: row.orgName,
      candidateName: row.inv.candidateName,
      email: row.inv.email,
      message: row.inv.message,
      expiresAt: row.inv.expiresAt.toISOString(),
      totalMinutes: row.job.interviewPlan.sections.reduce((s, x) => s + x.durationMinutes, 0),
      sections: row.job.interviewPlan.sections.map((s) => ({ type: s.type, title: s.title, durationMinutes: s.durationMinutes })),
      accountExists: Boolean(existing),
      interviewId: row.inv.interviewId,
    };
  });

  /** Accepting proves control of the invited mailbox, so it also signs the candidate in (magic-link style). */
  app.post('/accept', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['invites'], security: [], body: AcceptInviteBody, response: { 200: AuthResponse.extend({ interviewId: z.uuid() }) } } }, async (req, reply) => {
    const db = getDb();
    const [row] = await db
      .select({ inv: interviewInvites, job: jobs })
      .from(interviewInvites)
      .innerJoin(jobs, eq(jobs.id, interviewInvites.jobId))
      .where(eq(interviewInvites.tokenHash, sha256(req.body.token)))
      .limit(1);
    if (!row) throw notFound('Invitation');
    const inv = row.inv;
    if (inv.status === 'cancelled') throw gone('This invitation was withdrawn');

    let [user] = await db.select().from(users).where(eq(users.email, inv.email)).limit(1);
    if (!user) {
      if (!req.body.name || !req.body.username || !req.body.password) throw badRequest('name, username and password are required to create your account');
      const username = Username.parse(req.body.username);
      await ensureUniqueIdentity(inv.email, username);
      [user] = await db.insert(users).values({ name: req.body.name, username, email: inv.email, passwordHash: await hashPassword(req.body.password), role: 'candidate', emailVerifiedAt: new Date() }).returning();
    } else if (user.deletedAt) {
      throw conflict('This account was deleted');
    } else if (!user.emailVerifiedAt) {
      [user] = await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id)).returning();
    }

    let interviewId = inv.interviewId;
    if (inv.status === 'accepted' && interviewId) {
      const session = await issueSession(user!, req, reply);
      return { ...session, interviewId };
    }
    if (inv.expiresAt < new Date()) throw gone('This invitation has expired');
    if (row.job.status !== 'open') throw conflict('This position is no longer accepting interviews');

    const interview = await createInterviewFromInvite({ jobId: inv.jobId, organizationId: inv.organizationId, candidateId: user!.id, inviteId: inv.id, job: row.job });
    interviewId = interview.id;
    await db.update(interviewInvites).set({ status: 'accepted', acceptedAt: new Date(), interviewId }).where(eq(interviewInvites.id, inv.id));
    audit({ action: 'invite.accepted', targetType: 'interview_invite', targetId: inv.id, organizationId: inv.organizationId, actorId: user!.id }, req);
    const session = await issueSession(user!, req, reply);
    return { ...session, interviewId };
  });

  /* ---------------------------- recruiter ----------------------------- */
  const recruiter: FastifyPluginAsyncZod = async (r) => {
    r.addHook('preHandler', r.requireOrg());

    r.get('/jobs/:jobId', { schema: { tags: ['invites'], params: z.object({ jobId: z.uuid() }), response: { 200: z.array(InterviewInviteDto) } } }, async (req) => {
      const job = await getOrgJob(req.user!.org!.id, req.params.jobId);
      const rows = await getDb().select({ inv: interviewInvites, inviter: users.name }).from(interviewInvites).leftJoin(users, eq(users.id, interviewInvites.invitedBy)).where(eq(interviewInvites.jobId, job.id)).orderBy(desc(interviewInvites.createdAt));
      return rows.map(({ inv, inviter }) => toDto(inv, inviter));
    });

    async function createOne(jobId: string, orgId: string, body: z.infer<typeof CreateInviteBody>, req: FastifyRequest) {
      const job = await getOrgJob(orgId, jobId);
      if (job.status !== 'open') throw badRequest('Open the job before inviting candidates');
      const db = getDb();
      const [dup] = await db.select({ id: interviewInvites.id }).from(interviewInvites).where(and(eq(interviewInvites.jobId, job.id), eq(interviewInvites.email, body.email), eq(interviewInvites.status, 'pending'))).limit(1);
      if (dup) throw conflict(`${body.email} already has a pending invitation for this job`);
      const [existing] = await db
        .select({ id: interviews.id })
        .from(interviews)
        .innerJoin(users, eq(users.id, interviews.candidateId))
        .where(and(eq(interviews.jobId, job.id), eq(users.email, body.email)))
        .limit(1);
      if (existing) throw conflict(`${body.email} already has an interview for this job`);
      const token = randomToken();
      const expiresAt = addDays(new Date(), body.expiresInDays);
      const [inv] = await db
        .insert(interviewInvites)
        .values({ jobId: job.id, organizationId: orgId, email: body.email, candidateName: body.candidateName ?? null, message: body.message ?? null, tokenHash: sha256(token), expiresAt, invitedBy: req.user!.id })
        .returning();
      await enqueue('email.send', {
        mail: interviewInviteMail({ to: body.email, candidateName: body.candidateName ?? null, jobTitle: job.title, orgName: req.user!.org!.name, message: body.message ?? null, token, expiresAt, totalMinutes: job.interviewPlan.sections.reduce((s, x) => s + x.durationMinutes, 0) }),
      });
      audit({ action: 'invite.created', targetType: 'interview_invite', targetId: inv!.id, meta: { email: body.email, jobId: job.id } }, req);
      return toDto(inv!, req.user!.name);
    }

    r.post('/jobs/:jobId', { schema: { tags: ['invites'], params: z.object({ jobId: z.uuid() }), body: CreateInviteBody, response: { 201: InterviewInviteDto } } }, async (req, reply) => {
      return reply.status(201).send(await createOne(req.params.jobId, req.user!.org!.id, req.body, req));
    });

    r.post('/jobs/:jobId/bulk', { schema: { tags: ['invites'], params: z.object({ jobId: z.uuid() }), body: BulkCreateInviteBody, response: { 201: z.object({ created: z.array(InterviewInviteDto), failed: z.array(z.object({ email: z.string(), reason: z.string() })) }) } } }, async (req, reply) => {
      const created = [];
      const failed = [];
      for (const inv of req.body.invites) {
        try {
          created.push(await createOne(req.params.jobId, req.user!.org!.id, inv, req));
        } catch (err) {
          failed.push({ email: inv.email, reason: (err as Error).message });
        }
      }
      return reply.status(201).send({ created, failed });
    });

    r.post('/:id/resend', { schema: { tags: ['invites'], params: z.object({ id: z.uuid() }), response: { 200: InterviewInviteDto } } }, async (req) => {
      const db = getDb();
      const [row] = await db.select({ inv: interviewInvites, job: jobs }).from(interviewInvites).innerJoin(jobs, eq(jobs.id, interviewInvites.jobId)).where(and(eq(interviewInvites.id, req.params.id), eq(interviewInvites.organizationId, req.user!.org!.id))).limit(1);
      if (!row) throw notFound('Invitation');
      if (row.inv.status !== 'pending') throw badRequest('Only pending invitations can be resent');
      const token = randomToken();
      const expiresAt = addDays(new Date(), 14);
      const [inv] = await db.update(interviewInvites).set({ tokenHash: sha256(token), expiresAt }).where(eq(interviewInvites.id, row.inv.id)).returning();
      await enqueue('email.send', { mail: interviewInviteMail({ to: inv!.email, candidateName: inv!.candidateName, jobTitle: row.job.title, orgName: req.user!.org!.name, message: inv!.message, token, expiresAt, totalMinutes: row.job.interviewPlan.sections.reduce((s, x) => s + x.durationMinutes, 0) }) });
      return toDto(inv!, req.user!.name);
    });

    r.delete('/:id', { schema: { tags: ['invites'], params: z.object({ id: z.uuid() }), response: { 200: OkResponse } } }, async (req) => {
      const db = getDb();
      const [inv] = await db.select().from(interviewInvites).where(and(eq(interviewInvites.id, req.params.id), eq(interviewInvites.organizationId, req.user!.org!.id))).limit(1);
      if (!inv) throw notFound('Invitation');
      if (inv.status !== 'pending') throw badRequest('Only pending invitations can be cancelled');
      await db.update(interviewInvites).set({ status: 'cancelled' }).where(eq(interviewInvites.id, inv.id));
      audit({ action: 'invite.cancelled', targetType: 'interview_invite', targetId: inv.id }, req);
      return { ok: true as const };
    });
  };
  await app.register(recruiter);
};
