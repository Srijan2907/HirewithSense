import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { AcceptOrgInviteBody, AuthResponse, CreateOrgInviteBody, MemberDto, OkResponse, OrgInviteDto, OrgInvitePreview, OrganizationDto, UpdateMemberBody, UpdateOrganizationBody, Username } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { memberships, orgInvites, organizations, users } from '../../db/schema.js';
import { hashPassword, randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { addDays } from '../../lib/util.js';
import { audit } from '../../services/audit.js';
import { orgInviteMail } from '../../services/email.js';
import { enqueue } from '../../jobs/boss.js';
import { ensureUniqueIdentity, issueSession } from '../auth/service.js';

const toOrg = (o: typeof organizations.$inferSelect): z.infer<typeof OrganizationDto> => ({
  id: o.id, name: o.name, slug: o.slug, website: o.website, logoUrl: o.logoUrl, retentionDays: o.retentionDays, createdAt: o.createdAt.toISOString(),
});

export const orgRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ---------------- public: join via invite token ---------------- */
  app.get('/join/:token', { schema: { tags: ['orgs'], security: [], params: z.object({ token: z.string() }), response: { 200: OrgInvitePreview } } }, async (req) => {
    const [row] = await getDb()
      .select({ inv: orgInvites, orgName: organizations.name })
      .from(orgInvites)
      .innerJoin(organizations, eq(organizations.id, orgInvites.organizationId))
      .where(and(eq(orgInvites.tokenHash, sha256(req.params.token)), isNull(orgInvites.acceptedAt), gt(orgInvites.expiresAt, new Date())))
      .limit(1);
    if (!row) throw notFound('Invitation');
    const [existing] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, row.inv.email)).limit(1);
    return { organizationName: row.orgName, email: row.inv.email, role: row.inv.role as 'admin' | 'member', accountExists: Boolean(existing), expiresAt: row.inv.expiresAt.toISOString() };
  });

  app.post('/join', { schema: { tags: ['orgs'], security: [], body: AcceptOrgInviteBody, response: { 201: AuthResponse } } }, async (req, reply) => {
    const db = getDb();
    const [inv] = await db.select().from(orgInvites).where(and(eq(orgInvites.tokenHash, sha256(req.body.token)), isNull(orgInvites.acceptedAt), gt(orgInvites.expiresAt, new Date()))).limit(1);
    if (!inv) throw notFound('Invitation');
    let [user] = await db.select().from(users).where(eq(users.email, inv.email)).limit(1);
    if (!user) {
      if (!req.body.name || !req.body.username || !req.body.password) throw badRequest('name, username and password are required to create your account');
      const username = Username.parse(req.body.username);
      await ensureUniqueIdentity(inv.email, username);
      [user] = await db.insert(users).values({ name: req.body.name, username, email: inv.email, passwordHash: await hashPassword(req.body.password), role: 'recruiter', emailVerifiedAt: new Date() }).returning();
    } else if (user.role === 'candidate') {
      [user] = await db.update(users).set({ role: 'recruiter' }).where(eq(users.id, user.id)).returning();
    }
    const [existingMembership] = await db.select().from(memberships).where(eq(memberships.userId, user!.id)).limit(1);
    if (existingMembership && existingMembership.organizationId !== inv.organizationId) throw conflict('This account already belongs to another organization');
    if (!existingMembership) await db.insert(memberships).values({ organizationId: inv.organizationId, userId: user!.id, role: inv.role === 'owner' ? 'admin' : inv.role });
    await db.update(orgInvites).set({ acceptedAt: new Date() }).where(eq(orgInvites.id, inv.id));
    audit({ action: 'org.member_joined', targetType: 'organization', targetId: inv.organizationId, actorId: user!.id, organizationId: inv.organizationId }, req);
    return reply.status(201).send(await issueSession(user!, req, reply));
  });

  /* ---------------- authenticated org management ---------------- */
  const managed: FastifyPluginAsyncZod = async (org) => {
    org.addHook('preHandler', org.requireOrg());

    org.get('/current', { schema: { tags: ['orgs'], response: { 200: OrganizationDto } } }, async (req) => {
      const [o] = await getDb().select().from(organizations).where(eq(organizations.id, req.user!.org!.id)).limit(1);
      if (!o) throw notFound('Organization');
      return toOrg(o);
    });

    org.patch('/current', { preHandler: org.requireOrg('owner', 'admin'), schema: { tags: ['orgs'], body: UpdateOrganizationBody, response: { 200: OrganizationDto } } }, async (req) => {
      const db = getDb();
      if (req.body.slug) {
        const [taken] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, req.body.slug)).limit(1);
        if (taken && taken.id !== req.user!.org!.id) throw conflict('Slug is taken');
      }
      const [o] = await db.update(organizations).set(req.body).where(eq(organizations.id, req.user!.org!.id)).returning();
      audit({ action: 'org.updated', targetType: 'organization', targetId: o!.id, meta: req.body as Record<string, unknown> }, req);
      return toOrg(o!);
    });

    org.get('/members', { schema: { tags: ['orgs'], response: { 200: z.array(MemberDto) } } }, async (req) => {
      const rows = await getDb()
        .select({ userId: users.id, name: users.name, email: users.email, username: users.username, role: memberships.role, joinedAt: memberships.createdAt })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organizationId, req.user!.org!.id))
        .orderBy(memberships.createdAt);
      return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
    });

    org.patch('/members/:userId', { preHandler: org.requireOrg('owner', 'admin'), schema: { tags: ['orgs'], params: z.object({ userId: z.uuid() }), body: UpdateMemberBody, response: { 200: OkResponse } } }, async (req) => {
      const db = getDb();
      const [m] = await db.select().from(memberships).where(and(eq(memberships.organizationId, req.user!.org!.id), eq(memberships.userId, req.params.userId))).limit(1);
      if (!m) throw notFound('Member');
      if (m.role === 'owner') throw forbidden('The owner role cannot be changed');
      await db.update(memberships).set({ role: req.body.role }).where(eq(memberships.id, m.id));
      audit({ action: 'org.member_role_changed', targetType: 'user', targetId: m.userId, meta: { role: req.body.role } }, req);
      return { ok: true as const };
    });

    org.delete('/members/:userId', { preHandler: org.requireOrg('owner', 'admin'), schema: { tags: ['orgs'], params: z.object({ userId: z.uuid() }), response: { 200: OkResponse } } }, async (req) => {
      const db = getDb();
      const [m] = await db.select().from(memberships).where(and(eq(memberships.organizationId, req.user!.org!.id), eq(memberships.userId, req.params.userId))).limit(1);
      if (!m) throw notFound('Member');
      if (m.role === 'owner') throw forbidden('The owner cannot be removed');
      if (m.userId === req.user!.id) throw badRequest('You cannot remove yourself');
      await db.delete(memberships).where(eq(memberships.id, m.id));
      audit({ action: 'org.member_removed', targetType: 'user', targetId: m.userId }, req);
      return { ok: true as const };
    });

    org.get('/invites', { schema: { tags: ['orgs'], response: { 200: z.array(OrgInviteDto) } } }, async (req) => {
      const rows = await getDb()
        .select({ inv: orgInvites, inviter: users.name })
        .from(orgInvites)
        .leftJoin(users, eq(users.id, orgInvites.invitedBy))
        .where(eq(orgInvites.organizationId, req.user!.org!.id))
        .orderBy(orgInvites.createdAt);
      return rows.map(({ inv, inviter }) => ({ id: inv.id, email: inv.email, role: inv.role as 'admin' | 'member', invitedBy: inviter ?? 'Unknown', expiresAt: inv.expiresAt.toISOString(), acceptedAt: inv.acceptedAt?.toISOString() ?? null, createdAt: inv.createdAt.toISOString() }));
    });

    org.post('/invites', { preHandler: org.requireOrg('owner', 'admin'), schema: { tags: ['orgs'], body: CreateOrgInviteBody, response: { 201: OrgInviteDto } } }, async (req, reply) => {
      const db = getDb();
      const [member] = await db.select({ id: memberships.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.organizationId, req.user!.org!.id), eq(users.email, req.body.email))).limit(1);
      if (member) throw conflict('This person is already a member');
      const token = randomToken();
      const [inv] = await db.insert(orgInvites).values({ organizationId: req.user!.org!.id, email: req.body.email, role: req.body.role, tokenHash: sha256(token), invitedBy: req.user!.id, expiresAt: addDays(new Date(), 14) }).returning();
      await enqueue('email.send', { mail: orgInviteMail({ to: req.body.email, orgName: req.user!.org!.name, inviterName: req.user!.name, token }) });
      audit({ action: 'org.invite_created', targetType: 'org_invite', targetId: inv!.id, meta: { email: req.body.email } }, req);
      return reply.status(201).send({ id: inv!.id, email: inv!.email, role: inv!.role as 'admin' | 'member', invitedBy: req.user!.name, expiresAt: inv!.expiresAt.toISOString(), acceptedAt: null, createdAt: inv!.createdAt.toISOString() });
    });

    org.delete('/invites/:id', { preHandler: org.requireOrg('owner', 'admin'), schema: { tags: ['orgs'], params: z.object({ id: z.uuid() }), response: { 200: OkResponse } } }, async (req) => {
      await getDb().delete(orgInvites).where(and(eq(orgInvites.id, req.params.id), eq(orgInvites.organizationId, req.user!.org!.id), isNull(orgInvites.acceptedAt)));
      return { ok: true as const };
    });
  };
  await app.register(managed);
};
