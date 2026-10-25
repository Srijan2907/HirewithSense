import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AI_DISCLOSURE_VERSION } from '@hws/shared';
import { auth, createApp, latestMail, registerCandidate, registerRecruiter, truncateAll, type Session } from './helpers.js';

let app: FastifyInstance;
let recruiter: Session;
let jobId: string;
let problemId: string;

beforeAll(async () => {
  app = await createApp();
  await truncateAll();
  recruiter = await registerRecruiter(app, 10);
});
afterAll(async () => app.close());

const post = (url: string, s: Session, payload?: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: auth(s), payload });
const get = (url: string, s: Session) => app.inject({ method: 'GET', url, headers: auth(s) });

describe('recruiter job setup', () => {
  it('creates a job with default competencies and plan', async () => {
    const res = await post('/api/v1/jobs', recruiter, { title: 'Backend Engineer', description: 'Build and operate our Node.js services with PostgreSQL and Kubernetes.', skills: ['Node.js', 'PostgreSQL'] });
    expect(res.statusCode).toBe(201);
    jobId = res.json().id;
    expect(res.json().competencies).toHaveLength(5);
    expect(res.json().status).toBe('draft');
  });

  it('rejects rubric weights that do not total 100', async () => {
    const res = await post('/api/v1/jobs', recruiter, { title: 'Bad', description: 'This description is long enough.', competencies: [{ key: 'a', label: 'A', weight: 50 }] });
    expect(res.statusCode).toBe(400);
  });

  it('adds bank questions and a coding problem', async () => {
    const q = await post(`/api/v1/jobs/${jobId}/questions`, recruiter, { prompt: 'Describe a production incident you handled end to end.', competencyKey: 'problem_solving', expectedSignals: ['root cause', 'postmortem'] });
    expect(q.statusCode).toBe(201);
    const p = await post(`/api/v1/jobs/${jobId}/problems`, recruiter, {
      title: 'Sum two numbers',
      statement: 'Read two integers from stdin and print their sum.',
      languageIds: ['javascript', 'python'],
      testCases: [
        { input: '1 2\n', expectedOutput: '3\n', isSample: true },
        { input: '10 -4\n', expectedOutput: '6\n', isSample: false, weight: 2 },
      ],
    });
    expect(p.statusCode).toBe(201);
    problemId = p.json().id;
    expect(p.json().testCases).toHaveLength(2);
  });

  it('refuses to open a job whose plan has no coding section while coding_correctness has weight', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/jobs/${jobId}`, headers: auth(recruiter), payload: { status: 'open' } });
    expect(res.statusCode).toBe(400);
  });

  it('sets a two-section plan and opens the job', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${jobId}`,
      headers: auth(recruiter),
      payload: {
        interviewPlan: {
          sections: [
            { type: 'conversation', title: 'Conversation', durationMinutes: 20, questionCount: 3, allowGeneratedQuestions: true },
            { type: 'coding', title: 'Coding', durationMinutes: 30, problemIds: [problemId], languageIds: ['javascript', 'python'] },
          ],
          graceSeconds: 15,
          completionWindowDays: 7,
        },
        status: 'open',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('open');
  });
});

describe('candidate interview flow', () => {
  let inviteToken: string;
  let candidate: Session;
  let interviewId: string;

  it('invites a candidate by email', async () => {
    const res = await post(`/api/v1/invites/jobs/${jobId}`, recruiter, { email: 'alice@example.com', candidateName: 'Alice' });
    expect(res.statusCode).toBe(201);
    const mail = await latestMail('alice@example.com');
    expect(mail?.subject).toContain('Backend Engineer');
    inviteToken = mail!.text.match(/invite\/([a-f0-9]{64})/)![1]!;
    const dup = await post(`/api/v1/invites/jobs/${jobId}`, recruiter, { email: 'alice@example.com' });
    expect(dup.statusCode).toBe(409);
  });

  it('previews and accepts the invite, creating an account and an interview', async () => {
    const preview = await app.inject({ method: 'GET', url: `/api/v1/invites/${inviteToken}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().accountExists).toBe(false);
    expect(preview.json().sections).toHaveLength(2);

    const accept = await app.inject({ method: 'POST', url: '/api/v1/invites/accept', payload: { token: inviteToken, name: 'Alice Example', username: 'alice_ex', password: 'AliceSecret123!' } });
    expect(accept.statusCode).toBe(200);
    candidate = { token: accept.json().accessToken, cookie: '', user: accept.json().user };
    interviewId = accept.json().interviewId;
    expect(candidate.user.role).toBe('candidate');

    const again = await app.inject({ method: 'POST', url: '/api/v1/invites/accept', payload: { token: inviteToken } });
    expect(again.statusCode).toBe(200);
    expect(again.json().interviewId).toBe(interviewId);
  });

  it('refuses to start before consent, then starts after consent', async () => {
    const early = await post(`/api/v1/interviews/${interviewId}/start`, candidate);
    expect(early.statusCode).toBe(409);
    const consent = await post(`/api/v1/interviews/${interviewId}/consent`, candidate, { disclosureVersion: AI_DISCLOSURE_VERSION, accepted: true });
    expect(consent.statusCode).toBe(200);
    const start = await post(`/api/v1/interviews/${interviewId}/start`, candidate);
    expect(start.statusCode).toBe(200);
    expect(start.json().status).toBe('in_progress');
    expect(start.json().sections[0].status).toBe('active');
    expect(start.json().sections[0].deadline).toBeTruthy();
  });

  it('blocks other candidates and recruiters from the room', async () => {
    const other = await registerCandidate(app, 11);
    const res = await get(`/api/v1/interviews/${interviewId}/room`, other);
    expect(res.statusCode).toBe(403);
    const rec = await get(`/api/v1/interviews/${interviewId}/room`, recruiter);
    expect(rec.statusCode).toBe(403);
  });

  async function nextQuestion() {
    const res = await post(`/api/v1/interviews/${interviewId}/next-question`, candidate);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = res.body.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
    return events;
  }

  it('asks the bank question first, then generated questions, and records answers', async () => {
    let events = await nextQuestion();
    let q = events.find((e) => e.type === 'question');
    expect(q.turn.source).toBe('bank');
    expect(q.turn.question).toContain('production incident');
    expect(q.remaining).toBe(2);

    // Idempotent: asking again returns the same open turn.
    events = await nextQuestion();
    expect(events.find((e) => e.type === 'question').turn.id).toBe(q.turn.id);

    const ans = await post(`/api/v1/interviews/${interviewId}/answers`, candidate, { turnId: q.turn.id, answer: 'We had a database outage. I found the root cause in a connection leak, rolled back, and wrote a postmortem with action items. Because of that we added pool metrics.', inputMode: 'text' });
    expect(ans.statusCode).toBe(200);
    expect(ans.json().answer).toContain('root cause');
    expect(ans.json().evaluation).toBeUndefined();

    events = await nextQuestion();
    q = events.find((e) => e.type === 'question');
    expect(['generated', 'follow_up']).toContain(q.turn.source);
    expect(events.some((e) => e.type === 'token')).toBe(true);
    await post(`/api/v1/interviews/${interviewId}/answers`, candidate, { turnId: q.turn.id, answer: 'I would choose PostgreSQL for strong consistency and use Kubernetes for rolling deploys; the trade-off is operational complexity.', inputMode: 'voice', answerDurationSeconds: 42 });

    events = await nextQuestion();
    q = events.find((e) => e.type === 'question');
    const skip = await post(`/api/v1/interviews/${interviewId}/skip`, candidate, { turnId: q.turn.id });
    expect(skip.statusCode).toBe(200);

    events = await nextQuestion();
    expect(events[0].type).toBe('section_complete');
  });

  it('advances to the coding section, runs and submits code', async () => {
    const adv = await post(`/api/v1/interviews/${interviewId}/sections/0/complete`, candidate);
    expect(adv.statusCode).toBe(200);
    expect(adv.json().currentSection).toBe(1);
    expect(adv.json().sections[1].status).toBe('active');

    const room = await get(`/api/v1/interviews/${interviewId}/coding`, candidate);
    expect(room.statusCode).toBe(200);
    expect(room.json().problems[0].sampleCases).toHaveLength(1);
    expect(room.json().problems[0].testCaseCount).toBe(2);
    expect(JSON.stringify(room.json())).not.toContain('10 -4');

    const draft = await app.inject({ method: 'PUT', url: `/api/v1/interviews/${interviewId}/coding/draft`, headers: auth(candidate), payload: { problemId, languageId: 'javascript', sourceCode: '// wip' } });
    expect(draft.statusCode).toBe(200);

    const code = "const [a,b]=require('fs').readFileSync(0,'utf8').trim().split(/\\s+/).map(Number);console.log(a+b);";
    const run = await post(`/api/v1/interviews/${interviewId}/coding/run`, candidate, { problemId, languageId: 'javascript', sourceCode: code });
    if (process.env.TEST_CODE_RUNNER && process.env.TEST_CODE_RUNNER !== 'none') {
      expect(run.statusCode).toBe(200);
      expect(run.json().results[0].verdict).toBe('passed');
    } else {
      expect(run.statusCode).toBe(503);
    }

    const submit = await post(`/api/v1/interviews/${interviewId}/coding/submit`, candidate, { problemId, languageId: 'javascript', sourceCode: code });
    expect(submit.statusCode).toBe(202);
    const sub = await get(`/api/v1/interviews/${interviewId}/coding/submissions/${submit.json().id}`, candidate);
    expect(['graded', 'error']).toContain(sub.json().status);
    for (const r of sub.json().results) if (!r.isSample) expect(r.input).toBeNull();
  });

  it('records proctoring events and finishes, producing a report', async () => {
    const ev = await post(`/api/v1/interviews/${interviewId}/events`, candidate, { events: [{ type: 'focus_lost', at: new Date().toISOString() }, { type: 'paste', at: new Date().toISOString(), meta: { length: 120 } }] });
    expect(ev.statusCode).toBe(202);
    expect(ev.json().accepted).toBe(2);

    const fin = await post(`/api/v1/interviews/${interviewId}/sections/1/complete`, candidate);
    expect(fin.statusCode).toBe(200);
    expect(['submitted', 'completed']).toContain(fin.json().status);
    const after = await get(`/api/v1/interviews/${interviewId}`, candidate);
    expect(after.json().status).toBe('completed');
    expect(after.json().reportStatus).toBe('ready');

    const write = await post(`/api/v1/interviews/${interviewId}/answers`, candidate, { turnId: '00000000-0000-0000-0000-000000000000', answer: 'late', inputMode: 'text' });
    expect([404, 409]).toContain(write.statusCode);
  });

  it('shows the recruiter the full detail, report, rankings and lets them decide', async () => {
    const detail = await get(`/api/v1/interviews/${interviewId}/detail`, recruiter);
    expect(detail.statusCode).toBe(200);
    const d = detail.json();
    expect(d.turns).toHaveLength(3);
    expect(d.turns[0].evaluation).toBeTruthy();
    expect(d.consent.disclosureVersion).toBe(AI_DISCLOSURE_VERSION);
    expect(d.events).toHaveLength(2);
    expect(d.report.status).toBe('ready');
    expect(d.report.competencies).toHaveLength(5);
    expect(d.report.integrity.pasteEvents).toBe(1);
    expect(d.report.competencies.find((c: any) => c.key === 'coding_correctness').deterministic).toBe(true);
    expect(d.decision).toBeNull();

    const rank = await get(`/api/v1/jobs/${jobId}/rankings`, recruiter);
    expect(rank.statusCode).toBe(200);
    expect(rank.json().rows).toHaveLength(1);
    expect(rank.json().rows[0].integrityFlags).toBe(2);

    const csv = await get(`/api/v1/jobs/${jobId}/rankings.csv`, recruiter);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');

    const decision = await app.inject({ method: 'PUT', url: `/api/v1/interviews/${interviewId}/decision`, headers: auth(recruiter), payload: { decision: 'advance', reason: 'Strong incident handling answer; verify coding in a live round.' } });
    expect(decision.statusCode).toBe(200);
    expect(decision.json().decision).toBe('advance');

    const list = await get(`/api/v1/interviews?jobId=${jobId}`, recruiter);
    expect(list.json().items[0].decision).toBe('advance');

    const dash = await get('/api/v1/admin/dashboard', recruiter);
    expect(dash.statusCode).toBe(200);
    expect(dash.json().interviews.completed).toBe(1);

    const otherRecruiter = await registerRecruiter(app, 12);
    const forbidden = await get(`/api/v1/interviews/${interviewId}/detail`, otherRecruiter);
    expect(forbidden.statusCode).toBe(403);
  });

  it('lets the candidate see their interview list without scores', async () => {
    const mine = await get('/api/v1/interviews/mine', candidate);
    expect(mine.statusCode).toBe(200);
    expect(mine.json()[0].status).toBe('completed');
    expect(mine.json()[0].weightedScore).toBeNull();
    const report = await get(`/api/v1/interviews/${interviewId}/report`, candidate);
    expect(report.statusCode).toBe(403);
  });
});
