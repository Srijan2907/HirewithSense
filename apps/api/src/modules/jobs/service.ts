import { and, eq, sql } from 'drizzle-orm';
import type { CodingProblemDto, CandidateProblemDto, JobDto, QuestionDto, InterviewPlan, CreateJobBody } from '@hws/shared';
import { InterviewPlan as InterviewPlanSchema } from '@hws/shared';
import { getDb } from '../../db/client.js';
import { codingProblems, interviews, jobs, questions, reports, type CodingProblem, type Job, type Question } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { slugify } from '../../lib/util.js';

export function defaultPlan(): InterviewPlan {
  return InterviewPlanSchema.parse({
    sections: [{ type: 'conversation', title: 'Conversation', durationMinutes: 25, questionCount: 6, allowGeneratedQuestions: true }],
  });
}

export const toJobDto = (j: Job, stats?: JobDto['stats']): JobDto => ({
  id: j.id,
  organizationId: j.organizationId,
  title: j.title,
  slug: j.slug,
  department: j.department,
  location: j.location,
  employmentType: j.employmentType,
  description: j.description,
  skills: j.skills,
  seniority: j.seniority,
  status: j.status,
  competencies: j.competencies,
  interviewPlan: j.interviewPlan,
  minimumScore: j.minimumScore,
  biasAuditUrl: j.biasAuditUrl,
  createdBy: j.createdBy ?? j.organizationId,
  createdAt: j.createdAt.toISOString(),
  updatedAt: j.updatedAt.toISOString(),
  ...(stats ? { stats } : {}),
});

export const toQuestionDto = (q: Question): QuestionDto => ({
  id: q.id, jobId: q.jobId, prompt: q.prompt, competencyKey: q.competencyKey, difficulty: q.difficulty, expectedSignals: q.expectedSignals, followUpHints: q.followUpHints, order: q.order, createdAt: q.createdAt.toISOString(),
});

export const toProblemDto = (p: CodingProblem, includeCases: boolean): CodingProblemDto => ({
  id: p.id,
  jobId: p.jobId,
  title: p.title,
  statement: p.statement,
  difficulty: p.difficulty,
  languageIds: p.languageIds as CodingProblemDto['languageIds'],
  starterCode: p.starterCode,
  timeLimitMs: p.timeLimitMs,
  memoryLimitMb: p.memoryLimitMb,
  tags: p.tags,
  testCaseCount: p.testCases.length,
  sampleCount: p.testCases.filter((t) => t.isSample).length,
  ...(includeCases ? { testCases: p.testCases } : {}),
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export const toCandidateProblemDto = (p: CodingProblem): CandidateProblemDto => {
  const { testCases: _omit, ...rest } = toProblemDto(p, false);
  return { ...rest, sampleCases: p.testCases.filter((t) => t.isSample).map((t) => ({ input: t.input, expectedOutput: t.expectedOutput, label: t.label })) };
};

export async function getOrgJob(orgId: string, jobId: string): Promise<Job> {
  const [j] = await getDb().select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organizationId, orgId))).limit(1);
  if (!j) throw notFound('Job');
  return j;
}

export async function uniqueJobSlug(orgId: string, title: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const [taken] = await getDb().select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organizationId, orgId), eq(jobs.slug, slug))).limit(1);
    if (!taken) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Validate that a plan's coding sections reference problems belonging to this job and that the plan is publishable. */
export async function validatePlan(jobId: string, plan: InterviewPlan, competencies: CreateJobBody['competencies']): Promise<void> {
  const codingSections = plan.sections.filter((s) => s.type === 'coding');
  if (codingSections.length) {
    const ids = codingSections.flatMap((s) => (s.type === 'coding' ? s.problemIds : []));
    const rows = await getDb().select({ id: codingProblems.id, languageIds: codingProblems.languageIds }).from(codingProblems).where(eq(codingProblems.jobId, jobId));
    const known = new Map(rows.map((r) => [r.id, r.languageIds]));
    for (const id of ids) if (!known.has(id)) throw badRequest(`Coding problem ${id} does not belong to this job`);
    for (const s of codingSections) {
      if (s.type !== 'coding') continue;
      for (const pid of s.problemIds) {
        const langs = known.get(pid) ?? [];
        if (!s.languageIds.some((l) => langs.includes(l))) throw badRequest(`Problem ${pid} supports none of the section languages`);
      }
    }
  }
  const hasCoding = codingSections.length > 0;
  const codingWeight = competencies.find((c) => c.key === 'coding_correctness')?.weight ?? 0;
  if (!hasCoding && codingWeight > 0) {
    throw badRequest('coding_correctness has weight but the interview plan has no coding section. Set its weight to 0 or add a coding section.');
  }
}

export async function jobStats(jobIds: string[]): Promise<Map<string, NonNullable<JobDto['stats']>>> {
  if (!jobIds.length) return new Map();
  const rows = await getDb()
    .select({
      jobId: interviews.jobId,
      invited: sql<number>`count(*) filter (where ${interviews.status} in ('invited','ready'))`.mapWith(Number),
      inProgress: sql<number>`count(*) filter (where ${interviews.status} = 'in_progress')`.mapWith(Number),
      completed: sql<number>`count(*) filter (where ${interviews.status} in ('submitted','completed','expired'))`.mapWith(Number),
      averageScore: sql<number | null>`avg(${reports.weightedScore})`,
    })
    .from(interviews)
    .leftJoin(reports, eq(reports.interviewId, interviews.id))
    .where(sql`${interviews.jobId} in ${jobIds}`)
    .groupBy(interviews.jobId);
  const map = new Map<string, NonNullable<JobDto['stats']>>();
  for (const id of jobIds) map.set(id, { invited: 0, inProgress: 0, completed: 0, averageScore: null });
  for (const r of rows) map.set(r.jobId, { invited: r.invited, inProgress: r.inProgress, completed: r.completed, averageScore: r.averageScore === null ? null : Math.round(Number(r.averageScore) * 10) / 10 });
  return map;
}

export { questions, codingProblems };
