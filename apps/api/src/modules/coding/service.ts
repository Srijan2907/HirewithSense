import { and, eq, inArray } from 'drizzle-orm';
import type { CaseResult, SubmissionDto } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { codeSubmissions, codingProblems, type CodeSubmission } from '../../db/schema.js';
import { gradeSubmission } from '../../services/runner/index.js';

/** Hidden-case details are stored for recruiters and stripped for candidates here. */
export function redactResults(results: CaseResult[]): CaseResult[] {
  return results.map((r) => (r.isSample ? r : { ...r, stdout: null, stderr: null, expectedOutput: null, input: null }));
}

export function toSubmissionDto(s: CodeSubmission, reveal: boolean): SubmissionDto {
  return {
    id: s.id,
    interviewId: s.interviewId,
    problemId: s.problemId,
    sectionIndex: s.sectionIndex,
    languageId: s.languageId as SubmissionDto['languageId'],
    sourceCode: s.sourceCode,
    kind: s.kind as 'run' | 'submit',
    status: s.status,
    compileOutput: s.compileOutput,
    errorMessage: s.errorMessage,
    passed: s.passed,
    total: s.total,
    score: s.score,
    results: reveal ? s.results : redactResults(s.results),
    runner: s.runner,
    createdAt: s.createdAt.toISOString(),
    gradedAt: s.gradedAt?.toISOString() ?? null,
  };
}

/** Background job: grade a queued submission against all test cases. */
export async function gradeSubmissionJob(submissionId: string): Promise<void> {
  const db = getDb();
  const [s] = await db.select().from(codeSubmissions).where(eq(codeSubmissions.id, submissionId)).limit(1);
  if (!s || s.status === 'graded') return;
  const [problem] = await db.select().from(codingProblems).where(eq(codingProblems.id, s.problemId)).limit(1);
  if (!problem) {
    await db.update(codeSubmissions).set({ status: 'error', errorMessage: 'Problem no longer exists' }).where(eq(codeSubmissions.id, s.id));
    return;
  }
  await db.update(codeSubmissions).set({ status: 'running' }).where(eq(codeSubmissions.id, s.id));
  try {
    const out = await gradeSubmission({ languageId: s.languageId as any, sourceCode: s.sourceCode, cases: problem.testCases, timeLimitMs: problem.timeLimitMs, memoryLimitMb: problem.memoryLimitMb, revealAll: true });
    await db
      .update(codeSubmissions)
      .set({ status: out.status, runner: out.runner, compileOutput: out.compileOutput, errorMessage: out.errorMessage, results: out.results, passed: out.passed, total: out.total, score: out.score, gradedAt: new Date() })
      .where(eq(codeSubmissions.id, s.id));
  } catch (err) {
    await db.update(codeSubmissions).set({ status: 'error', errorMessage: (err as Error).message.slice(0, 1000), gradedAt: new Date() }).where(eq(codeSubmissions.id, s.id));
    throw err;
  }
}

/** Best graded submission per problem for an interview (highest score, then latest). */
export async function bestSubmissions(interviewId: string, problemIds: string[]): Promise<Map<string, CodeSubmission>> {
  if (!problemIds.length) return new Map();
  const rows = await getDb()
    .select()
    .from(codeSubmissions)
    .where(and(eq(codeSubmissions.interviewId, interviewId), eq(codeSubmissions.kind, 'submit'), eq(codeSubmissions.status, 'graded'), inArray(codeSubmissions.problemId, problemIds)));
  const best = new Map<string, CodeSubmission>();
  for (const r of rows) {
    const cur = best.get(r.problemId);
    if (!cur || (r.score ?? -1) > (cur.score ?? -1) || ((r.score ?? -1) === (cur.score ?? -1) && r.createdAt > cur.createdAt)) best.set(r.problemId, r);
  }
  return best;
}
