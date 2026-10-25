import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { and, eq } from 'drizzle-orm';
import type { OrgRole, UserRole } from '@hws/shared';
import { getDb } from '../db/client.js';
import { memberships, organizations, users } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/crypto.js';

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
  tokenVersion: number;
  org: { id: string; name: string; slug: string; role: OrgRole } | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
    optionalAuth: preHandlerHookHandler;
    requireRole: (...roles: UserRole[]) => preHandlerHookHandler;
    requireOrg: (...roles: OrgRole[]) => preHandlerHookHandler;
  }
}

async function resolveUser(req: FastifyRequest): Promise<AuthUser | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      role: users.role,
      tokenVersion: users.tokenVersion,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  if (!row || row.deletedAt) throw unauthorized('Account no longer exists');
  if (row.tokenVersion !== claims.ver) throw unauthorized('Session has been revoked. Please sign in again.');

  let org: AuthUser['org'] = null;
  if (row.role !== 'candidate') {
    const [m] = await db
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, row.id), claims.org ? eq(memberships.organizationId, claims.org) : undefined))
      .orderBy(memberships.createdAt)
      .limit(1);
    org = m ?? null;
  }
  return { id: row.id, name: row.name, username: row.username, email: row.email, role: row.role, tokenVersion: row.tokenVersion, org };
}

export default fp(async (app) => {
  app.decorateRequest('user', null);

  app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
    const user = await resolveUser(req);
    if (!user) throw unauthorized();
    req.user = user;
  });

  app.decorate('optionalAuth', async (req: FastifyRequest, _reply: FastifyReply) => {
    try {
      req.user = await resolveUser(req);
    } catch {
      req.user = null;
    }
  });

  app.decorate('requireRole', (...roles: UserRole[]) => {
    const handler: preHandlerHookHandler = async (req) => {
      if (!req.user) req.user = await resolveUser(req);
      if (!req.user) throw unauthorized();
      if (!roles.includes(req.user.role) && req.user.role !== 'superadmin') throw forbidden();
    };
    return handler;
  });

  app.decorate('requireOrg', (...roles: OrgRole[]) => {
    const handler: preHandlerHookHandler = async (req) => {
      if (!req.user) req.user = await resolveUser(req);
      if (!req.user) throw unauthorized();
      if (req.user.role === 'candidate') throw forbidden('Recruiter account required');
      if (!req.user.org) throw forbidden('You are not a member of an organization');
      if (roles.length && !roles.includes(req.user.org.role)) throw forbidden('Insufficient organization role');
    };
    return handler;
  });
}, { name: 'auth' });

/** Helper for services: current org id or throw. */
export function orgIdOf(user: AuthUser | null): string {
  if (!user?.org) throw forbidden('Organization context required');
  return user.org.id;
}
