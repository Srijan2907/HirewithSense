import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthResponse, PublicUser } from '@hws/shared';
import { env, isProd } from '../../config/env.js';
import { getDb, type Tx } from '../../db/client.js';
import { authTokens, memberships, organizations, refreshSessions, users, type User } from '../../db/schema.js';
import { hashPassword, randomToken, sha256, signAccessToken, verifyPassword } from '../../lib/crypto.js';
import { badRequest, conflict, locked, unauthorized } from '../../lib/errors.js';
import { addDays, addMinutes, iso, slugify } from '../../lib/util.js';
import { audit } from '../../services/audit.js';
import { deliverMail, passwordResetMail, verifyEmailMail } from '../../services/email.js';
import { enqueue } from '../../jobs/boss.js';

export const REFRESH_COOKIE = 'hws_refresh';
const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

function cookieSecure(): boolean {
  const c = env().COOKIE_SECURE;
  return c === 'auto' ? isProd() : c === 'true';
}

export function setRefreshCookie(reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/api/v1/auth',
    expires,
    domain: env().COOKIE_DOMAIN,
  });
}

export function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth', domain: env().COOKIE_DOMAIN });
}

export async function toPublicUser(u: User): Promise<PublicUser> {
  let organization: PublicUser['organization'] = null;
  if (u.role !== 'candidate') {
    const [m] = await getDb()
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, u.id))
      .orderBy(memberships.createdAt)
      .limit(1);
    organization = m ?? null;
  }
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    emailVerifiedAt: iso(u.emailVerifiedAt),
    createdAt: u.createdAt.toISOString(),
    organization,
  };
}

export async function issueSession(user: User, req: FastifyRequest, reply: FastifyReply, familyId?: string): Promise<AuthResponse> {
  const e = env();
  const pub = await toPublicUser(user);
  const accessToken = await signAccessToken({ sub: user.id, role: user.role, ver: user.tokenVersion, org: pub.organization?.id });
  const refresh = randomToken();
  const expiresAt = addDays(new Date(), e.REFRESH_TOKEN_TTL_DAYS);
  await getDb().insert(refreshSessions).values({
    userId: user.id,
    tokenHash: sha256(refresh),
    familyId: familyId ?? crypto.randomUUID(),
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
    ip: req.clientIp || null,
    expiresAt,
  });
  setRefreshCookie(reply, refresh, expiresAt);
  return { user: pub, accessToken, expiresIn: e.ACCESS_TOKEN_TTL_SECONDS };
}

export async function ensureUniqueIdentity(email: string, username: string, tx?: Tx) {
  const db = tx ?? getDb();
  const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (byEmail) throw conflict('An account with this email already exists');
  const [byUsername] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (byUsername) throw conflict('This username is taken');
}

export async function registerCandidate(input: { name: string; username: string; email: string; password: string }): Promise<User> {
  await ensureUniqueIdentity(input.email, input.username);
  const [user] = await getDb()
    .insert(users)
    .values({ name: input.name, username: input.username, email: input.email, passwordHash: await hashPassword(input.password), role: env().SUPERADMIN_EMAILS.includes(input.email) ? 'superadmin' : 'candidate' })
    .returning();
  await sendVerification(user!);
  return user!;
}

export async function registerRecruiter(input: { name: string; username: string; email: string; password: string; organizationName: string; organizationSlug?: string }): Promise<User> {
  await ensureUniqueIdentity(input.email, input.username);
  const slugBase = input.organizationSlug ?? slugify(input.organizationName);
  return getDb().transaction(async (tx) => {
    let slug = slugBase;
    for (let i = 0; i < 5; i++) {
      const [taken] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
      if (!taken) break;
      if (input.organizationSlug) throw conflict('This organization slug is taken');
      slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const [org] = await tx.insert(organizations).values({ name: input.organizationName, slug, retentionDays: env().DEFAULT_RETENTION_DAYS }).returning();
    const [user] = await tx
      .insert(users)
      .values({ name: input.name, username: input.username, email: input.email, passwordHash: await hashPassword(input.password), role: env().SUPERADMIN_EMAILS.includes(input.email) ? 'superadmin' : 'recruiter' })
      .returning();
    await tx.insert(memberships).values({ organizationId: org!.id, userId: user!.id, role: 'owner' });
    await sendVerification(user!);
    return user!;
  });
}

export async function login(email: string, password: string, req: FastifyRequest): Promise<User> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.deletedAt) {
    await verifyPassword(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali'); // constant-time-ish
    throw unauthorized('Invalid email or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw locked(`Too many failed attempts. Try again after ${user.lockedUntil.toISOString()}`);
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    await db
      .update(users)
      .set({ failedLoginAttempts: attempts, lockedUntil: attempts >= MAX_FAILED ? addMinutes(new Date(), LOCK_MINUTES) : null })
      .where(eq(users.id, user.id));
    audit({ action: 'auth.login_failed', targetType: 'user', targetId: user.id, actorId: null, ip: req.clientIp });
    throw unauthorized('Invalid email or password');
  }
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  }
  audit({ action: 'auth.login', targetType: 'user', targetId: user.id, actorId: user.id, ip: req.clientIp });
  return user;
}

export async function rotateRefresh(rawToken: string | undefined, req: FastifyRequest, reply: FastifyReply): Promise<AuthResponse> {
  if (!rawToken) throw unauthorized('No session');
  const db = getDb();
  const hash = sha256(rawToken);
  const [session] = await db.select().from(refreshSessions).where(eq(refreshSessions.tokenHash, hash)).limit(1);
  if (!session) {
    clearRefreshCookie(reply);
    throw unauthorized('Session not found');
  }
  if (session.revokedAt) {
    // Reuse of a rotated token: assume theft and revoke the entire family.
    await db.update(refreshSessions).set({ revokedAt: new Date() }).where(and(eq(refreshSessions.familyId, session.familyId), isNull(refreshSessions.revokedAt)));
    clearRefreshCookie(reply);
    audit({ action: 'auth.refresh_reuse_detected', targetType: 'user', targetId: session.userId, actorId: session.userId, ip: req.clientIp });
    throw unauthorized('Session revoked');
  }
  if (session.expiresAt < new Date()) {
    clearRefreshCookie(reply);
    throw unauthorized('Session expired');
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || user.deletedAt) throw unauthorized('Account no longer exists');
  await db.update(refreshSessions).set({ revokedAt: new Date(), lastUsedAt: new Date() }).where(eq(refreshSessions.id, session.id));
  return issueSession(user, req, reply, session.familyId);
}

export async function revokeByToken(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await getDb().update(refreshSessions).set({ revokedAt: new Date() }).where(eq(refreshSessions.tokenHash, sha256(rawToken)));
}

export async function revokeAll(userId: string): Promise<void> {
  const db = getDb();
  await db.update(refreshSessions).set({ revokedAt: new Date() }).where(and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt)));
  await db.update(users).set({ tokenVersion: (await db.select({ v: users.tokenVersion }).from(users).where(eq(users.id, userId)))[0]!.v + 1 }).where(eq(users.id, userId));
}

export async function listSessions(userId: string, currentRaw: string | undefined) {
  const rows = await getDb()
    .select()
    .from(refreshSessions)
    .where(and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt), gt(refreshSessions.expiresAt, new Date())))
    .orderBy(refreshSessions.lastUsedAt);
  const currentHash = currentRaw ? sha256(currentRaw) : null;
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt.toISOString(), userAgent: r.userAgent, ip: r.ip, current: r.tokenHash === currentHash }));
}

export async function revokeSession(userId: string, sessionId: string) {
  await getDb().update(refreshSessions).set({ revokedAt: new Date() }).where(and(eq(refreshSessions.id, sessionId), eq(refreshSessions.userId, userId)));
}

/* --------------------------- one-time token flows -------------------------- */

async function createOneTimeToken(userId: string, purpose: 'password_reset' | 'email_verify', ttlMinutes: number): Promise<string> {
  const token = randomToken();
  await getDb().insert(authTokens).values({ userId, purpose, tokenHash: sha256(token), expiresAt: addMinutes(new Date(), ttlMinutes) });
  return token;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.deletedAt) return;
  const token = await createOneTimeToken(user.id, 'password_reset', 30);
  await enqueue('email.send', { mail: passwordResetMail(user.email, user.name, token) });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.purpose, 'password_reset'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);
  if (!row) throw badRequest('Reset link is invalid or has expired');
  await db.transaction(async (tx) => {
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    await tx.update(users).set({ passwordHash: await hashPassword(password), failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, row.userId));
  });
  await revokeAll(row.userId);
  audit({ action: 'auth.password_reset', targetType: 'user', targetId: row.userId, actorId: row.userId });
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw badRequest('Current password is incorrect');
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  await revokeAll(userId);
}

export async function sendVerification(user: User): Promise<void> {
  try {
    const token = await createOneTimeToken(user.id, 'email_verify', 60 * 24);
    await enqueue('email.send', { mail: verifyEmailMail(user.email, user.name, token) });
  } catch {
    /* non-fatal */
  }
}

export async function verifyEmail(token: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.purpose, 'email_verify'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);
  if (!row) throw badRequest('Verification link is invalid or has expired');
  await db.transaction(async (tx) => {
    await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
  });
}

export { deliverMail };
