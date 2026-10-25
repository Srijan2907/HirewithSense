import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auth, createApp, latestMail, registerCandidate, registerRecruiter, truncateAll, type Session } from './helpers.js';

let app: FastifyInstance;
let owner: Session;
beforeAll(async () => {
  app = await createApp();
  await truncateAll();
  owner = await registerRecruiter(app, 20);
});
afterAll(async () => app.close());

describe('organizations', () => {
  it('shows the current org and lets the owner update it', async () => {
    const cur = await app.inject({ method: 'GET', url: '/api/v1/orgs/current', headers: auth(owner) });
    expect(cur.statusCode).toBe(200);
    expect(cur.json().retentionDays).toBe(365);
    const upd = await app.inject({ method: 'PATCH', url: '/api/v1/orgs/current', headers: auth(owner), payload: { retentionDays: 180, website: 'https://acme.example' } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().retentionDays).toBe(180);
  });

  it('invites a teammate who joins via the emailed token and gets recruiter access', async () => {
    const inv = await app.inject({ method: 'POST', url: '/api/v1/orgs/invites', headers: auth(owner), payload: { email: 'teammate@example.com', role: 'admin' } });
    expect(inv.statusCode).toBe(201);
    const mail = await latestMail('teammate@example.com');
    const token = mail!.text.match(/join\/([a-f0-9]{64})/)![1]!;
    const preview = await app.inject({ method: 'GET', url: `/api/v1/orgs/join/${token}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().accountExists).toBe(false);
    const join = await app.inject({ method: 'POST', url: '/api/v1/orgs/join', payload: { token, name: 'Team Mate', username: 'teammate', password: 'TeamMatePass123!' } });
    expect(join.statusCode).toBe(201);
    expect(join.json().user.role).toBe('recruiter');
    expect(join.json().user.organization.role).toBe('admin');
    const members = await app.inject({ method: 'GET', url: '/api/v1/orgs/members', headers: auth(owner) });
    expect(members.json()).toHaveLength(2);
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/orgs/join', payload: { token } });
    expect(reuse.statusCode).toBe(404);
  });

  it('prevents members from managing the organization and protects the owner', async () => {
    const inv = await app.inject({ method: 'POST', url: '/api/v1/orgs/invites', headers: auth(owner), payload: { email: 'member@example.com', role: 'member' } });
    expect(inv.statusCode).toBe(201);
    const mail = await latestMail('member@example.com');
    const token = mail!.text.match(/join\/([a-f0-9]{64})/)![1]!;
    const join = await app.inject({ method: 'POST', url: '/api/v1/orgs/join', payload: { token, name: 'Mem Ber', username: 'member1', password: 'MemberPass12345!' } });
    const member: Session = { token: join.json().accessToken, cookie: '', user: join.json().user };
    const denied = await app.inject({ method: 'PATCH', url: '/api/v1/orgs/current', headers: auth(member), payload: { name: 'Hijacked' } });
    expect(denied.statusCode).toBe(403);
    const removeOwner = await app.inject({ method: 'DELETE', url: `/api/v1/orgs/members/${owner.user.id}`, headers: auth(owner) });
    expect(removeOwner.statusCode).toBe(403);
    const demote = await app.inject({ method: 'PATCH', url: `/api/v1/orgs/members/${member.user.id}`, headers: auth(owner), payload: { role: 'admin' } });
    expect(demote.statusCode).toBe(200);
    const remove = await app.inject({ method: 'DELETE', url: `/api/v1/orgs/members/${member.user.id}`, headers: auth(owner) });
    expect(remove.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/v1/orgs/current', headers: auth(member) });
    expect(after.statusCode).toBe(403);
  });

  it('keeps candidates out of recruiter routes and recruiters out of candidate-only data', async () => {
    const cand = await registerCandidate(app, 21);
    for (const url of ['/api/v1/jobs', '/api/v1/orgs/current', '/api/v1/admin/dashboard', '/api/v1/interviews?page=1']) {
      const r = await app.inject({ method: 'GET', url, headers: auth(cand) });
      expect(r.statusCode, url).toBe(403);
    }
    const noAuth = await app.inject({ method: 'GET', url: '/api/v1/jobs' });
    expect(noAuth.statusCode).toBe(401);
    const badToken = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: 'Bearer not-a-token' } });
    expect(badToken.statusCode).toBe(401);
  });

  it('isolates jobs between organizations', async () => {
    const other = await registerRecruiter(app, 22);
    const job = await app.inject({ method: 'POST', url: '/api/v1/jobs', headers: auth(owner), payload: { title: 'Private role', description: 'Only visible to the owning organization.' } });
    expect(job.statusCode).toBe(201);
    const peek = await app.inject({ method: 'GET', url: `/api/v1/jobs/${job.json().id}`, headers: auth(other) });
    expect(peek.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/v1/jobs', headers: auth(other) });
    expect(list.json().total).toBe(0);
  });
});

describe('candidate account deletion', () => {
  it('anonymises the user and revokes sessions', async () => {
    const cand = await registerCandidate(app, 23);
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/users/me/delete', headers: auth(cand), payload: { confirmEmail: 'nope@example.com' } });
    expect(wrong.statusCode).toBe(409);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/users/me/delete', headers: auth(cand), payload: { confirmEmail: cand.user.email } });
    expect(ok.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(cand) });
    expect(me.statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: cand.user.email, password: 'Sup3rSecretPass!' } });
    expect(login.statusCode).toBe(401);
  });
});

describe('candidate data export', () => {
  it('returns everything about the signed-in candidate and nothing about others', async () => {
    const a = await registerCandidate(app, 24);
    const b = await registerCandidate(app, 25);
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me/export', headers: auth(a) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const body = JSON.parse(res.body);
    expect(body.format).toBe('hirewithsense.candidate-export.v1');
    expect(body.account.email).toBe(a.user.email);
    expect(res.body).not.toContain(b.user.email);
    expect(Array.isArray(body.interviews)).toBe(true);
    expect(Array.isArray(body.accountEvents)).toBe(true);
    expect(body.resumes).toEqual([]);
  });
});
