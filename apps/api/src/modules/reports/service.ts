import { and, eq, inArray } from 'drizzle-orm';
import type { Competency, CompetencyScore, DecisionDto, IntegritySummary, ReportDto } from '@hws/shared';
import { codingScore, levelFromScore, recommend, weightedScore } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { codingProblems, interviewTurns, interviews, proctoringEvents, reports, type Decision, type Report } from '../../db/schema.js';
import { getAi } from '../../services/ai/provider.js';
import { stripUntrusted } from '../../lib/redact.js';
import { generateModelReport } from '../../services/ai/tasks.js';
import { bestSubmissions } from '../coding/service.js';
import { loadInterview, notifyRecruiters } from '../interviews/service.js';

export const toReportDto = (r: Report): ReportDto => ({
  id: r.id,
  interviewId: r.interviewId,
  status: r.status,
  error: r.error,
  summary: r.summary,
  strengths: r.strengths,
  considerations: r.considerations,
  competencies: r.competencies,
  weightedScore: r.weightedScore,
  coverage: r.coverage,
  recommendation: r.recommendation as ReportDto['recommendation'],
  minimumScore: r.minimumScore,
  meetsMinimum: r.meetsMinimum,
  integrity: r.integrity ?? { flags: 0, focusLost: 0, pasteEvents: 0, fullscreenExits: 0, tabHidden: 0, otherEvents: 0, notes: [] },
  provider: r.provider,
  model: r.model,
  generatedAt: r.generatedAt?.toISOString() ?? null,
  evidenceStats: r.evidenceStats ?? { turns: 0, answered: 0, submissions: 0, transcriptChars: 0 },
});

export const toDecisionDto = (d: Decision, name: string): DecisionDto => ({
  interviewId: d.interviewId,
  decision: d.decision,
  reason: d.reason,
  overridesRecommendation: d.overridesRecommendation,
  decidedBy: { id: d.decidedBy ?? '00000000-0000-0000-0000-000000000000', name },
  decidedAt: d.decidedAt.toISOString(),
});

export async function integritySummary(interviewId: string): Promise<IntegritySummary> {
  const rows = await getDb().select({ type: proctoringEvents.type }).from(proctoringEvents).where(eq(proctoringEvents.interviewId, interviewId));
  const count = (t: string) => rows.filter((r) => r.type === t).length;
  const focusLost = count('focus_lost');
  const pasteEvents = count('paste');
  const fullscreenExits = count('fullscreen_exit');
  const tabHidden = count('tab_hidden');
  const devtools = count('devtools_suspected');
  const otherEvents = rows.length - focusLost - pasteEvents - fullscreenExits - tabHidden - devtools;
  const notes: string[] = [];
  if (focusLost + tabHidden > 5) notes.push(`The interview window lost focus or was hidden ${focusLost + tabHidden} times.`);
  if (pasteEvents > 0) notes.push(`${pasteEvents} paste event(s) were recorded in the editor or answer field.`);
  if (fullscreenExits > 0) notes.push(`Full-screen mode was exited ${fullscreenExits} time(s).`);
  if (devtools > 0) notes.push('Developer tools may have been opened.');
  if (!notes.length) notes.push('No notable interface events were recorded.');
  return { flags: focusLost + pasteEvents + fullscreenExits + tabHidden + devtools, focusLost, pasteEvents, fullscreenExits, tabHidden, otherEvents, notes };
}

/** Background job: build the evidence pack, call the model, merge deterministic scores, persist. */
export async function generateReportJob(interviewId: string): Promise<void> {
  const db = getDb();
  const li = await loadInterview(interviewId);
  const { interview: i, job } = li;
  if (!['submitted', 'expired', 'completed'].includes(i.status)) return;

  await db.insert(reports).values({ interviewId, status: 'generating', minimumScore: job.minimumScore }).onConflictDoUpdate({ target: reports.interviewId, set: { status: 'generating', error: null } });
  await db.update(interviews).set({ reportStatus: 'generating' }).where(eq(interviews.id, interviewId));

  try {
    const turns = await db.select().from(interviewTurns).where(eq(interviewTurns.interviewId, interviewId)).orderBy(interviewTurns.sectionIndex, interviewTurns.order);
    const codingSections = i.plan.sections.filter((s) => s.type === 'coding');
    const problemIds = codingSections.flatMap((s) => (s.type === 'coding' ? s.problemIds : []));
    const best = await bestSubmissions(interviewId, problemIds);
    const problems = problemIds.length ? await db.select().from(codingProblems).where(inArray(codingProblems.id, problemIds)) : [];

    const perProblem = problemIds.map((pid) => {
      const p = problems.find((x) => x.id === pid);
      const totalWeight = p ? p.testCases.reduce((s, c) => s + (c.weight ?? 1), 0) : 0;
      const sub = best.get(pid);
      const passedWeight = sub ? sub.results.filter((r) => r.verdict === 'passed').reduce((s, r) => s + (p?.testCases[r.index]?.weight ?? 1), 0) : 0;
      return { passedWeight, totalWeight };
    });
    const codingValue = problemIds.length ? codingScore(perProblem) : null;

    const ai = await getAi();
    const model = await generateModelReport({
      job: { title: job.title, description: job.description, seniority: job.seniority, minimumScore: job.minimumScore },
      competencies: job.competencies,
      turns: turns.map((t) => ({ id: t.id, competencyKey: t.competencyKey, question: t.question, answer: t.answer, skipped: t.skipped, evaluation: t.evaluation ?? null })),
      coding: [...best.values()].map((s) => ({ submissionId: s.id, problemTitle: problems.find((p) => p.id === s.problemId)?.title ?? 'Problem', languageId: s.languageId, passed: s.passed, total: s.total, score: s.score, sourceCode: s.sourceCode })),
      candidateName: li.candidate.name,
    });

    const competencies: CompetencyScore[] = job.competencies.map((c: Competency) => {
      const m = model.competencies.find((x) => x.key === c.key);
      if (c.key === 'coding_correctness') {
        const score = codingValue;
        return {
          key: c.key,
          label: c.label,
          weight: c.weight,
          score,
          level: levelFromScore(score),
          confidence: score === null ? 0 : 1,
          rationale: score === null ? 'No graded submissions were recorded for the coding section.' : `Computed from test results: ${perProblem.map((p) => `${p.passedWeight}/${p.totalWeight}`).join(', ')} weighted cases passed per problem (unattempted problems count as 0).`,
          evidence: [...best.values()].map((s) => ({ quote: `${s.passed}/${s.total} test cases passed (${s.languageId})`, source: 'test_results' as const, submissionId: s.id })),
          deterministic: true,
        };
      }
      const validEvidence = (m?.evidence ?? []).map((e) => ({ ...e, quote: stripUntrusted(e.quote) })).filter((e) => e.quote.length > 0);
      const score = m && validEvidence.length ? m.score : null;
      return {
        key: c.key,
        label: c.label,
        weight: c.weight,
        score,
        level: m?.level ?? levelFromScore(score),
        confidence: m?.confidence ?? 0,
        rationale: m?.rationale ?? 'The model did not return an assessment for this competency.',
        evidence: validEvidence,
        deterministic: false,
      };
    });

    const ws = weightedScore(competencies.map((c) => ({ weight: c.weight, score: c.score })));
    const recommendation = recommend(ws.score, ws.coverage, job.minimumScore);
    const integrity = await integritySummary(interviewId);
    const answered = turns.filter((t) => t.answer).length;
    const transcriptChars = turns.reduce((s, t) => s + (t.answer?.length ?? 0), 0);

    await db
      .update(reports)
      .set({
        status: 'ready',
        error: null,
        summary: model.summary,
        strengths: model.strengths,
        considerations: model.considerations,
        competencies,
        weightedScore: ws.score,
        coverage: ws.coverage,
        recommendation,
        minimumScore: job.minimumScore,
        meetsMinimum: ws.score === null ? null : ws.score >= job.minimumScore,
        integrity,
        provider: ai.name,
        model: ai.model,
        evidenceStats: { turns: turns.length, answered, submissions: best.size, transcriptChars },
        generatedAt: new Date(),
      })
      .where(eq(reports.interviewId, interviewId));
    await db.update(interviews).set({ status: 'completed', completedAt: new Date(), reportStatus: 'ready' }).where(and(eq(interviews.id, interviewId), inArray(interviews.status, ['submitted', 'expired', 'completed'])));
    await notifyRecruiters(li).catch(() => {});
  } catch (err) {
    await db.update(reports).set({ status: 'failed', error: (err as Error).message.slice(0, 1000) }).where(eq(reports.interviewId, interviewId));
    await db.update(interviews).set({ reportStatus: 'failed' }).where(eq(interviews.id, interviewId));
    throw err;
  }
}
