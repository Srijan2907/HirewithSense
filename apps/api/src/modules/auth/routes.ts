import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AuthResponse,
  ChangePasswordBody,
  ErrorResponse,
  ForgotPasswordBody,
  LoginBody,
  OkResponse,
  PublicUser,
  RegisterCandidateBody,
  RegisterRecruiterBody,
  ResetPasswordBody,
  SessionDto,
  VerifyEmailBody,
} from '@hws/shared';
import { getDb } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { notFound } from '../../lib/errors.js';
import * as svc from './service.js';

const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/register', { ...authLimit, schema: { tags: ['auth'], security: [], body: RegisterCandidateBody, response: { 201: AuthResponse, 409: ErrorResponse } } }, async (req, reply) => {
    const user = await svc.registerCandidate(req.body);
    return reply.status(201).send(await svc.issueSession(user, req, reply));
  });

  app.post('/register/recruiter', { ...authLimit, schema: { tags: ['auth'], security: [], body: RegisterRecruiterBody, response: { 201: AuthResponse, 409: ErrorResponse } } }, async (req, reply) => {
    const user = await svc.registerRecruiter(req.body);
    return reply.status(201).send(await svc.issueSession(user, req, reply));
  });

  app.post('/login', { ...authLimit, schema: { tags: ['auth'], security: [], body: LoginBody, response: { 200: AuthResponse, 401: ErrorResponse, 423: ErrorResponse } } }, async (req, reply) => {
    const user = await svc.login(req.body.email, req.body.password, req);
    return svc.issueSession(user, req, reply);
  });

  app.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['auth'], security: [], response: { 200: AuthResponse, 401: ErrorResponse } } }, async (req, reply) => {
    return svc.rotateRefresh(req.cookies[svc.REFRESH_COOKIE], req, reply);
  });

  app.post('/logout', { schema: { tags: ['auth'], security: [], response: { 200: OkResponse } } }, async (req, reply) => {
    await svc.revokeByToken(req.cookies[svc.REFRESH_COOKIE]);
    svc.clearRefreshCookie(reply);
    return { ok: true as const };
  });

  app.post('/logout-all', { preHandler: app.authenticate, schema: { tags: ['auth'], response: { 200: OkResponse } } }, async (req, reply) => {
    await svc.revokeAll(req.user!.id);
    svc.clearRefreshCookie(reply);
    return { ok: true as const };
  });

  app.post('/forgot-password', { ...authLimit, schema: { tags: ['auth'], security: [], body: ForgotPasswordBody, response: { 200: z.object({ ok: z.literal(true), message: z.string() }) } } }, async (req) => {
    await svc.requestPasswordReset(req.body.email);
    return { ok: true as const, message: 'If an account exists for that email, reset instructions have been sent.' };
  });

  app.post('/reset-password', { ...authLimit, schema: { tags: ['auth'], security: [], body: ResetPasswordBody, response: { 200: OkResponse, 400: ErrorResponse } } }, async (req) => {
    await svc.resetPassword(req.body.token, req.body.password);
    return { ok: true as const };
  });

  app.post('/change-password', { preHandler: app.authenticate, schema: { tags: ['auth'], body: ChangePasswordBody, response: { 200: OkResponse } } }, async (req, reply) => {
    await svc.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
    svc.clearRefreshCookie(reply);
    return { ok: true as const };
  });

  app.post('/verify-email', { ...authLimit, schema: { tags: ['auth'], security: [], body: VerifyEmailBody, response: { 200: OkResponse, 400: ErrorResponse } } }, async (req) => {
    await svc.verifyEmail(req.body.token);
    return { ok: true as const };
  });

  app.post('/resend-verification', { preHandler: app.authenticate, ...authLimit, schema: { tags: ['auth'], response: { 200: OkResponse } } }, async (req) => {
    const [user] = await getDb().select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) throw notFound('User');
    if (!user.emailVerifiedAt) await svc.sendVerification(user);
    return { ok: true as const };
  });

  app.get('/me', { preHandler: app.authenticate, schema: { tags: ['auth'], response: { 200: PublicUser } } }, async (req) => {
    const [user] = await getDb().select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) throw notFound('User');
    return svc.toPublicUser(user);
  });

  app.get('/sessions', { preHandler: app.authenticate, schema: { tags: ['auth'], response: { 200: z.array(SessionDto) } } }, async (req) => {
    return svc.listSessions(req.user!.id, req.cookies[svc.REFRESH_COOKIE]);
  });

  app.delete('/sessions/:id', { preHandler: app.authenticate, schema: { tags: ['auth'], params: z.object({ id: z.uuid() }), response: { 200: OkResponse } } }, async (req) => {
    await svc.revokeSession(req.user!.id, req.params.id);
    return { ok: true as const };
  });
};
