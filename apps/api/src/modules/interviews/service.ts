import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import {
  AI_DISCLOSURE_TEXT,
  AI_DISCLOSURE_VERSION,
  type CandidateTurnDto,
  type Competency,
  type InterviewDto,
  type InterviewPlan,
  type InterviewSummaryDto,
  type SectionProgress,
  type TranscriptEventDto,
  type TurnDto,
} from '@hws/shared';
import { getDb } from '../../db/client.js';
import {
  codeSubmissions,
  consents,
  decisions,
  interviewTurns,
  interviews,
  jobs,
  organizations,
  proctoringEvents,
  questions,
  reports,
  resumes,
  transcriptEvents,
  users,
  memberships,
  type Interview,
  type InterviewTurn,
  type Job,
  type TranscriptEvent,
} from '../../db/schema.js';
import { sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, gone, notFound } from '../../lib/errors.js';
import { addDays, addMinutes, addSeconds, iso } from '../../lib/util.js';
import { audit } from '../../services/audit.js';
import { evaluateAnswer, streamNextQuestion } from '../../services/ai/tasks.js';
import { interviewCompletedMail } from '../../services/email.js';
import { enqueue } from '../../jobs/boss.js';
import { env } from '../../config/env.js';
import type { AuthUser } from '../../plugins/auth.js';

/* --------------------------------- loading -------------------------------- */

export interface LoadedInterview {
  interview: Interview;
  job: Job;
  orgName: string;
  candidate: { id: string; name: string; email: string; username: string };
}

export async function loadInterview(id: string): Promise<LoadedInterview> {
  const [row] = await getDb()
    .select({ interview: interviews, job: jobs, orgName: organizations.name, cId: users.id, cName: users.name, cEmail: users.email, cUsername: users.username })
    .from(interviews)
    .innerJoin(jobs, eq(jobs.id, interviews.jobId))
    .innerJoin(organizations, eq(organizations.id, interviews.organizationId))
    .innerJoin(users, eq(users.id, interviews.candidateId))
    .where(eq(interviews.id, id))
    .limit(1);
  if (!row) throw notFound('Interview');
  return { interview: row.interview, job: row.job, orgName: row.orgName, candidate: { id: row.cId, name: row.cName, email: row.cEmail, username: row.cUsername } };
}

export function assertCandidate(li: LoadedInterview, user: AuthUser) {
  if (li.interview.candidateId !== user.id) throw forbidden('This interview belongs to another candidate');
}

export function assertRecruiter(li: LoadedInterview, user: AuthUser) {
  if (user.role === 'superadmin') return;
  if (!user.org || li.interview.organizationId !== user.org.id) throw forbidden('This interview belongs to another organization');
}

/* -------------------------------- mapping --------------------------------- */

export function toInterviewDto(li: LoadedInterview): InterviewDto {
  const i = li.interview;
  return {
    id: i.id,
    jobId: i.jobId,
    jobTitle: li.job.title,
    organizationName: li.orgName,
    candidate: li.candidate,
    status: i.status,
    plan: i.plan,
    sections: i.sections,
    currentSection: i.currentSection,
    consentedAt: iso(i.consentedAt),
    startedAt: iso(i.startedAt),
    overallDeadline: iso(i.overallDeadline),
    completeBy: iso(i.completeBy),
    submittedAt: iso(i.submittedAt),
    completedAt: iso(i.completedAt),
    reportStatus: i.reportStatus,
    serverTime: new Date().toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

export const toTurnDto = (t: InterviewTurn): TurnDto => ({
  id: t.id,
  interviewId: t.interviewId,
  sectionIndex: t.sectionIndex,
  order: t.order,
  question: t.question,
  competencyKey: t.competencyKey,
  source: t.source,
  questionId: t.questionId,
  askedAt: t.askedAt.toISOString(),
  answer: t.answer,
  answeredAt: iso(t.answeredAt),
  answerDurationSeconds: t.answerDurationSeconds,
  inputMode: (t.inputMode as 'text' | 'voice' | null) ?? null,
  skipped: t.skipped,
  evaluation: t.evaluation ?? null,
});

export const toCandidateTurnDto = (t: InterviewTurn): CandidateTurnDto => {
  const { evaluation: _e, ...rest } = toTurnDto(t);
  return rest;
};

export const toTranscriptDto = (e: TranscriptEvent): TranscriptEventDto => ({
  id: e.id, sectionIndex: e.sectionIndex, speaker: e.speaker, text: e.text, turnId: e.turnId, at: e.at.toISOString(),
});

export function sectionsFromPlan(plan: InterviewPlan): SectionProgress[] {
  return plan.sections.map((s, index) => ({ index, type: s.type, title: s.title, durationMinutes: s.durationMinutes, status: 'pending', startedAt: null, deadline: null, completedAt: null }));
}

/* ----------------------------- state machine ------------------------------ */

export async function createInterviewFromInvite(opts: { jobId: string; organizationId: string; candidateId: string; inviteId: string; job: Job }): Promise<Interview> {
  const plan = opts.job.interviewPlan;
  const [row] = await getDb()
    .insert(interviews)
    .values({
      jobId: opts.jobId,
      organizationId: opts.organizationId,
      candidateId: opts.candidateId,
      inviteId: opts.inviteId,
      status: 'ready',
      plan,
      sections: sectionsFromPlan(plan),
      completeBy: addDays(new Date(), plan.completionWindowDays),
    })
    .returning();
  return row!;
}

export async function recordConsent(li: LoadedInterview, user: AuthUser, body: { disclosureVersion: string; accommodationRequest?: string }, req: FastifyRequest) {
  if (body.disclosureVersion !== AI_DISCLOSURE_VERSION) throw conflict('The disclosure text has been updated. Please reload and review it again.');
  if (li.interview.status !== 'ready') throw conflict('Consent can only be recorded before the interview starts');
  const db = getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(consents).values({
      interviewId: li.interview.id,
      userId: user.id,
      disclosureVersion: body.disclosureVersion,
      textHash: sha256(AI_DISCLOSURE_TEXT),
      accommodationRequest: body.accommodationRequest ?? null,
      ip: req.clientIp || null,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
      consentedAt: now,
    });
    await tx.update(interviews).set({ consentedAt: now }).where(eq(interviews.id, li.interview.id));
  });
  audit({ action: 'interview.consented', targetType: 'interview', targetId: li.interview.id, organizationId: li.interview.organizationId }, req);
  return { disclosureVersion: body.disclosureVersion, textHash: sha256(AI_DISCLOSURE_TEXT), consentedAt: now.toISOString(), accommodationRequest: body.accommodationRequest ?? null };
}

export async function startInterview(li: LoadedInterview, req: FastifyRequest): Promise<Interview> {
  const i = li.interview;
  if (i.status === 'in_progress') return i;
  if (i.status !== 'ready') throw conflict(`Interview cannot be started from status ${i.status}`);
  if (!i.consentedAt) throw conflict('Please review and accept the AI disclosure before starting');
  if (i.completeBy && i.completeBy < new Date()) throw gone('The completion window for this interview has passed');
  const now = new Date();
  const total = i.plan.sections.reduce((s, x) => s + x.durationMinutes, 0);
  const sections = i.sections.map((s, idx) => (idx === 0 ? { ...s, status: 'active' as const, startedAt: now.toISOString(), deadline: addMinutes(now, s.durationMinutes).toISOString() } : s));
  const [latestResume] = await getDb().select({ id: resumes.id }).from(resumes).where(eq(resumes.userId, i.candidateId)).orderBy(desc(resumes.createdAt)).limit(1);
  const [row] = await getDb()
    .update(interviews)
    .set({
      status: 'in_progress',
      startedAt: now,
      currentSection: 0,
      sections,
      overallDeadline: addMinutes(now, total + 5 + i.plan.sections.length),
      resumeId: latestResume?.id ?? null,
    })
    .where(and(eq(interviews.id, i.id), eq(interviews.status, 'ready')))
    .returning();
  if (!row) throw conflict('Interview was started concurrently');
  await getDb().insert(transcriptEvents).values({ interviewId: i.id, sectionIndex: 0, speaker: 'system', text: `Interview started. Section 1 of ${sections.length}: ${sections[0]!.title} (${sections[0]!.durationMinutes} min).`, at: now });
  audit({ action: 'interview.started', targetType: 'interview', targetId: i.id, organizationId: i.organizationId }, req);
  return row;
}

/** Throws unless the interview is in progress and the given (or current) section is still within its deadline + grace. */
export function assertWritable(i: Interview, sectionIndex?: number): SectionProgress {
  if (i.status !== 'in_progress') throw conflict('Interview is not in progress');
  const idx = sectionIndex ?? i.currentSection;
  if (idx === null || idx === undefined) throw conflict('No active section');
  const s = i.sections[idx];
  if (!s || s.status !== 'active') throw conflict('This section is not active');
  const deadline = s.deadline ? new Date(s.deadline).getTime() : 0;
  if (Date.now() > deadline + i.plan.graceSeconds * 1000) throw gone('Time is up for this section');
  if (i.overallDeadline && Date.now() > i.overallDeadline.getTime() + i.plan.graceSeconds * 1000) throw gone('The interview time limit has passed');
  return s;
}

export async function completeSection(li: LoadedInterview, sectionIndex: number, req: FastifyRequest | null): Promise<Interview> {
  const i = li.interview;
  if (i.status !== 'in_progress') throw conflict('Interview is not in progress');
  if (i.currentSection !== sectionIndex) throw conflict('Only the active section can be completed');
  const now = new Date();
  const sections = i.sections.map((s) => (s.index === sectionIndex ? { ...s, status: 'done' as const, completedAt: now.toISOString() } : s));
  const next = sections.find((s) => s.status === 'pending');
  if (!next) {
    return finishInterview(li, 'completed', req);
  }
  const started = { ...next, status: 'active' as const, startedAt: now.toISOString(), deadline: addMinutes(now, next.durationMinutes).toISOString() };
  const updatedSections = sections.map((s) => (s.index === next.index ? started : s));
  const [row] = await getDb().update(interviews).set({ sections: updatedSections, currentSection: next.index }).where(eq(interviews.id, i.id)).returning();
  await getDb().insert(transcriptEvents).values({ interviewId: i.id, sectionIndex: next.index, speaker: 'system', text: `Section ${next.index + 1} of ${sections.length}: ${next.title} (${next.durationMinutes} min).`, at: now });
  return row!;
}

export async function finishInterview(li: LoadedInterview, reason: 'completed' | 'expired', req: FastifyRequest | null): Promise<Interview> {
  const i = li.interview;
  if (i.status !== 'in_progress') {
    if (i.status === 'submitted' || i.status === 'completed' || i.status === 'expired') return i;
    throw conflict('Interview is not in progress');
  }
  const now = new Date();
  const sections = i.sections.map((s) => (s.status === 'done' ? s : { ...s, status: 'done' as const, completedAt: s.completedAt ?? now.toISOString() }));
  const [row] = await getDb()
    .update(interviews)
    .set({ status: reason === 'expired' ? 'expired' : 'submitted', submittedAt: now, sections, currentSection: null, reportStatus: 'pending' })
    .where(and(eq(interviews.id, i.id), eq(interviews.status, 'in_progress')))
    .returning();
  if (!row) return (await loadInterview(i.id)).interview;
  await getDb().insert(transcriptEvents).values({ interviewId: i.id, sectionIndex: i.currentSection ?? 0, speaker: 'system', text: reason === 'expired' ? 'Time limit reached. Interview closed automatically.' : 'Candidate finished the interview.', at: now });
  await getDb().insert(reports).values({ interviewId: i.id, status: 'pending', minimumScore: li.job.minimumScore }).onConflictDoNothing();
  await enqueue('report.generate', { interviewId: i.id }, { singletonKey: `report:${i.id}` });
  audit({ action: reason === 'expired' ? 'interview.expired' : 'interview.submitted', targetType: 'interview', targetId: i.id, organizationId: i.organizationId, actorId: req?.user?.id ?? null }, req ?? undefined);
  return row;
}

/* ------------------------------ conversation ------------------------------ */

function pickTargetCompetency(job: Job, turns: InterviewTurn[]): Competency {
  const eligible = job.competencies.filter((c) => c.weight > 0 && c.key !== 'coding_correctness');
  const pool = eligible.length ? eligible : job.competencies;
  const counts = new Map<string, number>();
  for (const t of turns) if (t.competencyKey) counts.set(t.competencyKey, (counts.get(t.competencyKey) ?? 0) + 1);
  let best = pool[0]!;
  let bestRatio = Infinity;
  for (const c of pool) {
    const ratio = ((counts.get(c.key) ?? 0) + 1) / Math.max(1, c.weight);
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = c;
    }
  }
  return best;
}

export interface NextQuestionResult {
  kind: 'question' | 'section_complete';
  stream?: AsyncIterable<string>;
  finalize?: (text: string) => Promise<InterviewTurn>;
  remaining: number;
  existing?: InterviewTurn;
}

/**
 * Decide the next conversation turn. Returns either an unanswered existing turn (idempotent on
 * reconnect), a bank question, or a streamed AI question with a finalizer that persists the turn.
 */
export async function nextQuestion(li: LoadedInterview): Promise<NextQuestionResult> {
  const i = li.interview;
  const section = assertWritable(i);
  const plan = i.plan.sections[section.index];
  if (!plan || plan.type !== 'conversation') throw conflict('The active section is not a conversation');
  const db = getDb();
  const turns = await db.select().from(interviewTurns).where(and(eq(interviewTurns.interviewId, i.id), eq(interviewTurns.sectionIndex, section.index))).orderBy(asc(interviewTurns.order));
  const open = turns.find((t) => !t.answer && !t.skipped);
  if (open) return { kind: 'question', existing: open, remaining: plan.questionCount - turns.length };
  if (turns.length >= plan.questionCount) return { kind: 'section_complete', remaining: 0 };

  const askedIds = new Set(turns.map((t) => t.questionId).filter(Boolean));
  const bank = await db.select().from(questions).where(eq(questions.jobId, i.jobId)).orderBy(asc(questions.order), asc(questions.createdAt));
  const nextBank = bank.find((q) => !askedIds.has(q.id));
  const order = turns.length;
  const remaining = plan.questionCount - turns.length - 1;

  if (nextBank && (!plan.allowGeneratedQuestions || order % 2 === 0 || !turns.length)) {
    const [turn] = await db
      .insert(interviewTurns)
      .values({ interviewId: i.id, sectionIndex: section.index, order, question: nextBank.prompt, competencyKey: nextBank.competencyKey, source: 'bank', questionId: nextBank.id })
      .returning();
    await db.insert(transcriptEvents).values({ interviewId: i.id, sectionIndex: section.index, speaker: 'interviewer', text: nextBank.prompt, turnId: turn!.id });
    return { kind: 'question', existing: turn!, remaining };
  }

  if (!plan.allowGeneratedQuestions && !nextBank) {
    // Bank exhausted and generation disabled: the section is effectively complete.
    return { kind: 'section_complete', remaining: 0 };
  }

  const target = pickTargetCompetency(li.job, turns);
  const [resume] = i.resumeId ? await db.select().from(resumes).where(eq(resumes.id, i.resumeId)).limit(1) : [];
  const last = turns.at(-1);
  const stream = await streamNextQuestion({
    job: { title: li.job.title, description: li.job.description, skills: li.job.skills, seniority: li.job.seniority },
    targetCompetency: target,
    resume: resume?.profile ?? null,
    previousQuestions: turns.map((t) => t.question),
    lastAnswer: last?.answer ?? null,
    askedCount: turns.length,
    totalQuestions: plan.questionCount,
    candidateName: li.candidate.name,
    followUpHints: last?.questionId ? (bank.find((q) => q.id === last.questionId)?.followUpHints ?? []) : [],
  });
  const finalize = async (text: string) => {
    const question = text.trim().replace(/^["“]|["”]$/g, '') || 'Could you tell me more about your most relevant experience for this role?';
    const [turn] = await db
      .insert(interviewTurns)
      .values({ interviewId: i.id, sectionIndex: section.index, order, question, competencyKey: target.key, source: last?.answer && /you mentioned|you said|earlier/i.test(question) ? 'follow_up' : 'generated' })
      .returning();
    await db.insert(transcriptEvents).values({ interviewId: i.id, sectionIndex: section.index, speaker: 'interviewer', text: question, turnId: turn!.id });
    return turn!;
  };
  return { kind: 'question', stream, finalize, remaining };
}

export async function answerTurn(li: LoadedInterview, body: { turnId: string; answer: string; inputMode: 'text' | 'voice'; answerDurationSeconds?: number }, req: FastifyRequest): Promise<InterviewTurn> {
  const i = li.interview;
  const db = getDb();
  const [turn] = await db.select().from(interviewTurns).where(and(eq(interviewTurns.id, body.turnId), eq(interviewTurns.interviewId, i.id))).limit(1);
  if (!turn) throw notFound('Question');
  assertWritable(i, turn.sectionIndex);
  if (turn.answer) throw conflict('This question has already been answered');
  const now = new Date();
  const [updated] = await db
    .update(interviewTurns)
    .set({ answer: body.answer, answeredAt: now, inputMode: body.inputMode, answerDurationSeconds: body.answerDurationSeconds ?? null, skipped: false })
    .where(eq(interviewTurns.id, turn.id))
    .returning();
  await db.insert(transcriptEvents).values({ interviewId: i.id, sectionIndex: turn.sectionIndex, speaker: 'candidate', text: body.answer, turnId: turn.id, at: now });

  const competency = li.job.competencies.find((c) => c.key === turn.competencyKey) ?? null;
  const [bankQ] = turn.questionId ? await db.select().from(questions).where(eq(questions.id, turn.questionId)).limit(1) : [];
  const evaluation = evaluateAnswer({ jobTitle: li.job.title, question: turn.question, answer: body.answer, competency, expectedSignals: bankQ?.expectedSignals ?? [], candidateName: li.candidate.name })
    .then((ev) => db.update(interviewTurns).set({ evaluation: ev }).where(eq(interviewTurns.id, turn.id)))
    .catch((err) => req.log.warn({ err, turnId: turn.id }, 'answer evaluation failed'));
  if (env().NODE_ENV === 'test') await evaluation;
  return updated!;
}

export async function skipTurn(li: LoadedInterview, turnId: string): Promise<InterviewTurn> {
  const db = getDb();
  const [turn] = await db.select().from(interviewTurns).where(and(eq(interviewTurns.id, turnId), eq(interviewTurns.interviewId, li.interview.id))).limit(1);
  if (!turn) throw notFound('Question');
  assertWritable(li.interview, turn.sectionIndex);
  if (turn.answer) throw conflict('This question has already been answered');
  const [updated] = await db.update(interviewTurns).set({ skipped: true, answeredAt: new Date() }).where(eq(interviewTurns.id, turn.id)).returning();
  await db.insert(transcriptEvents).values({ interviewId: li.interview.id, sectionIndex: turn.sectionIndex, speaker: 'system', text: 'Candidate skipped the question.', turnId: turn.id });
  return updated!;
}

/* ------------------------------ recruiter lists ---------------------------- */

export async function listInterviews(opts: { orgId?: string; candidateId?: string; jobId?: string; status?: Interview['status']; q?: string; sort: 'recent' | 'score'; page: number; pageSize: number }) {
  const db = getDb();
  const where = and(
    opts.orgId ? eq(interviews.organizationId, opts.orgId) : undefined,
    opts.candidateId ? eq(interviews.candidateId, opts.candidateId) : undefined,
    opts.jobId ? eq(interviews.jobId, opts.jobId) : undefined,
    opts.status ? eq(interviews.status, opts.status) : undefined,
    opts.q ? sql`(${users.name} ilike ${'%' + opts.q + '%'} or ${users.email} ilike ${'%' + opts.q + '%'} or ${jobs.title} ilike ${'%' + opts.q + '%'})` : undefined,
  );
  const base = db
    .select({
      i: interviews,
      jobTitle: jobs.title,
      cId: users.id,
      cName: users.name,
      cEmail: users.email,
      score: reports.weightedScore,
      recommendation: reports.recommendation,
      reportStatus: reports.status,
      decision: decisions.decision,
      flags: sql<number>`(select count(*) from ${proctoringEvents} pe where pe.interview_id = ${interviews.id} and pe.type in ('focus_lost','paste','fullscreen_exit','tab_hidden','devtools_suspected'))`.mapWith(Number),
    })
    .from(interviews)
    .innerJoin(jobs, eq(jobs.id, interviews.jobId))
    .innerJoin(users, eq(users.id, interviews.candidateId))
    .leftJoin(reports, eq(reports.interviewId, interviews.id))
    .leftJoin(decisions, eq(decisions.interviewId, interviews.id))
    .where(where);
  const rows = await base
    .orderBy(opts.sort === 'score' ? sql`${reports.weightedScore} desc nulls last` : desc(interviews.createdAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  const countRows = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(interviews).innerJoin(jobs, eq(jobs.id, interviews.jobId)).innerJoin(users, eq(users.id, interviews.candidateId)).where(where);
  const items: InterviewSummaryDto[] = rows.map((r) => ({
    id: r.i.id,
    jobId: r.i.jobId,
    jobTitle: r.jobTitle,
    candidate: { id: r.cId, name: r.cName, email: r.cEmail },
    status: r.i.status,
    totalMinutes: r.i.plan.sections.reduce((s, x) => s + x.durationMinutes, 0),
    startedAt: iso(r.i.startedAt),
    completedAt: iso(r.i.completedAt ?? r.i.submittedAt),
    completeBy: iso(r.i.completeBy),
    weightedScore: r.reportStatus === 'ready' ? r.score : null,
    recommendation: r.reportStatus === 'ready' ? r.recommendation : null,
    decision: r.decision ?? null,
    integrityFlags: r.flags,
    createdAt: r.i.createdAt.toISOString(),
  }));
  return { items, total: countRows[0]?.count ?? 0, page: opts.page, pageSize: opts.pageSize };
}

export async function notifyRecruiters(li: LoadedInterview): Promise<void> {
  const rows = await getDb()
    .select({ email: users.email, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, li.interview.organizationId), inArray(memberships.role, ['owner', 'admin'])));
  await Promise.all(rows.slice(0, 5).map((r) => enqueue('email.send', { mail: interviewCompletedMail({ to: r.email, recruiterName: r.name, candidateName: li.candidate.name, jobTitle: li.job.title, interviewId: li.interview.id }) })));
}

export { codeSubmissions, badRequest };
