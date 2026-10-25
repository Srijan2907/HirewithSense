import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createApp, latestMail, registerCandidate, registerRecruiter, truncateAll } from './helpers.js';

let app: FastifyInstance;
const cookieOf = (h: string | string[] | undefined) => (Array.isArray(h) ? h : h ? [h] : []).map((c) => c.split(';')[0]).join('; ');
beforeAll(async () => {
  app = await createApp();
  await truncateAll();
});
afterAll(async () => app.close());

describe('auth', () => {
  it('registers a candidate and returns a session', async () => {
    const s = await registerCandidate(app, 1);
    expect(s.user.role).toBe('candidate');
    expect(s.cookie).toContain('hws_refresh=');
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(s) });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(s.user.email);
  });

  it('registers a recruiter with an organization', async () => {
    const s = await registerRecruiter(app, 1);
    expect(s.user.role).toBe('recruiter');
    expect(s.user.organization?.id).toBeTruthy();
    expect((s.user.organization as any).role).toBe('owner');
  });

  it('rejects duplicate email and weak password', async () => {
    const s = await registerCandidate(app, 2);
    const dup = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name: 'x', username: 'anotherone', email: s.user.email, password: 'Sup3rSecretPass!' } });
    expect(dup.statusCode).toBe(409);
    const weak = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name: 'x', username: 'weakpw', email: 'weak@example.com', password: 'short' } });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('validation_error');
  });

  it('logs in, refreshes with rotation, and detects reuse', async () => {
    const s = await registerCandidate(app, 3);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: s.user.email, password: 'Sup3rSecretPass!' } });
    expect(login.statusCode).toBe(200);
    const cookie1 = cookieOf(login.headers['set-cookie']);

    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: cookie1 } });
    expect(r1.statusCode).toBe(200);
    const cookie2 = cookieOf(r1.headers['set-cookie']);
    expect(cookie2).not.toBe(cookie1);

    // Reusing the rotated token must fail and revoke the family.
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: cookie1 } });
    expect(reuse.statusCode).toBe(401);
    const afterReuse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: cookie2 } });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('rejects wrong password and locks after repeated failures', async () => {
    const s = await registerCandidate(app, 4);
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: s.user.email, password: 'wrong-password-1' } });
      expect(r.statusCode).toBe(401);
    }
    const lockedRes = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: s.user.email, password: 'Sup3rSecretPass!' } });
    expect(lockedRes.statusCode).toBe(423);
  });

  it('resets password via emailed token and revokes old sessions', async () => {
    const s = await registerCandidate(app, 5);
    const fp = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: s.user.email } });
    expect(fp.statusCode).toBe(200);
    const mail = await latestMail(s.user.email);
    expect(mail?.subject).toMatch(/reset/i);
    const token = mail!.text.match(/token=([a-f0-9]{64})/)![1];
    const rp = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'N3wSecretPassword!' } });
    expect(rp.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'N3wSecretPassword!' } });
    expect(again.statusCode).toBe(400);
    const old = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(s) });
    expect(old.statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: s.user.email, password: 'N3wSecretPassword!' } });
    expect(login.statusCode).toBe(200);
  });

  it('does not reveal whether an email exists on forgot-password', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email: 'nobody@example.com' } });
    expect(r.statusCode).toBe(200);
  });

  it('verifies email with the emailed token', async () => {
    const s = await registerCandidate(app, 6);
    const mail = await latestMail(s.user.email);
    expect(mail?.subject).toMatch(/verify/i);
    const token = mail!.text.match(/token=([a-f0-9]{64})/)![1];
    const v = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
    expect(v.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(s) });
    expect(me.json().emailVerifiedAt).toBeTruthy();
  });

  it('lists and revokes sessions', async () => {
    const s = await registerCandidate(app, 7);
    const list = await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: { ...auth(s), cookie: s.cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0].current).toBe(true);
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout-all', headers: auth(s) });
    expect(out.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(s) });
    expect(me.statusCode).toBe(401);
  });
});
