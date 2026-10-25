import { z } from 'zod';
import { JOB_STATUSES, LANGUAGE_IDS, QUESTION_DIFFICULTIES, SECTION_TYPES } from '../enums.js';
import { Id, IsoDate } from './common.js';

/** A competency is one rubric dimension with a weight. Weights across a job sum to 100. */
export const Competency = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'snake_case key'),
  label: z.string().trim().min(2).max(60),
  description: z.string().trim().max(600).default(''),
  weight: z.number().min(0).max(100),
  /** Behaviourally anchored descriptors for levels 1..5 (optional but recommended). */
  anchors: z.array(z.string().trim().max(300)).max(5).optional(),
});
export type Competency = z.infer<typeof Competency>;

export const CompetencyList = z
  .array(Competency)
  .min(1)
  .max(10)
  .superRefine((list, ctx) => {
    const total = list.reduce((s, c) => s + c.weight, 0);
    if (Math.abs(total - 100) > 0.01) {
      ctx.addIssue({ code: 'custom', message: `Weights must total 100 (currently ${total})` });
    }
    const keys = new Set<string>();
    for (const c of list) {
      if (keys.has(c.key)) ctx.addIssue({ code: 'custom', message: `Duplicate competency key ${c.key}` });
      keys.add(c.key);
    }
  });

export const DEFAULT_COMPETENCIES: Competency[] = [
  {
    key: 'technical_knowledge',
    label: 'Technical knowledge',
    description: 'Depth and accuracy of domain and technology understanding relevant to the role.',
    weight: 25,
  },
  {
    key: 'problem_solving',
    label: 'Problem solving',
    description: 'Decomposes problems, reasons about trade-offs, handles ambiguity and edge cases.',
    weight: 25,
  },
  {
    key: 'communication',
    label: 'Communication',
    description: 'Explains ideas clearly and concisely with appropriate structure; content, not delivery.',
    weight: 15,
  },
  {
    key: 'project_depth',
    label: 'Project depth',
    description: 'Can go deep on own work: decisions, alternatives, failures, measurable impact.',
    weight: 15,
  },
  {
    key: 'coding_correctness',
    label: 'Coding correctness',
    description: 'Computed deterministically from test results in the coding section.',
    weight: 20,
  },
];

export const ConversationSection = z.object({
  type: z.literal('conversation'),
  title: z.string().trim().min(1).max(80).default('Conversation'),
  durationMinutes: z.number().int().min(5).max(90),
  /** Number of questions the interviewer asks (bank questions first, then AI-generated). */
  questionCount: z.number().int().min(1).max(20),
  /** Allow the interviewer to generate follow-ups beyond the bank. */
  allowGeneratedQuestions: z.boolean().default(true),
});
export const CodingSection = z.object({
  type: z.literal('coding'),
  title: z.string().trim().min(1).max(80).default('Coding'),
  durationMinutes: z.number().int().min(10).max(180),
  problemIds: z.array(Id).min(1).max(5),
  languageIds: z.array(z.enum(LANGUAGE_IDS)).min(1).default(['javascript', 'python']),
});
export const InterviewSection = z.discriminatedUnion('type', [ConversationSection, CodingSection]);
export type InterviewSection = z.infer<typeof InterviewSection>;
export type ConversationSection = z.infer<typeof ConversationSection>;
export type CodingSection = z.infer<typeof CodingSection>;

export const InterviewPlan = z.object({
  sections: z.array(InterviewSection).min(1).max(4),
  /** Grace seconds after a deadline during which writes are still accepted (network slack). */
  graceSeconds: z.number().int().min(0).max(120).default(15),
  /** Days a candidate has to complete after accepting the invite. */
  completionWindowDays: z.number().int().min(1).max(60).default(7),
});
export type InterviewPlan = z.infer<typeof InterviewPlan>;

export const planDuration = (plan: { sections: { durationMinutes: number }[] }) =>
  plan.sections.reduce((s, x) => s + x.durationMinutes, 0);

export const JobDto = z.object({
  id: Id,
  organizationId: Id,
  title: z.string(),
  slug: z.string(),
  department: z.string().nullable(),
  location: z.string().nullable(),
  employmentType: z.string().nullable(),
  description: z.string(),
  skills: z.array(z.string()),
  seniority: z.string().nullable(),
  status: z.enum(JOB_STATUSES),
  competencies: z.array(Competency),
  interviewPlan: InterviewPlan,
  minimumScore: z.number(),
  /** Public URL of the most recent bias-audit summary, if any (NYC LL144). */
  biasAuditUrl: z.string().nullable(),
  createdBy: Id,
  createdAt: IsoDate,
  updatedAt: IsoDate,
  stats: z
    .object({
      invited: z.number().int(),
      inProgress: z.number().int(),
      completed: z.number().int(),
      averageScore: z.number().nullable(),
    })
    .optional(),
});
export type JobDto = z.infer<typeof JobDto>;

/**
 * Field definitions without defaults. Zod 4 applies `.default()` even through `.partial()`, so update
 * bodies are derived from these and create bodies add the defaults explicitly.
 */
const JobFields = z.object({
  title: z.string().trim().min(2).max(150),
  department: z.string().trim().max(80).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'internship']).nullable().optional(),
  seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'lead']).nullable().optional(),
  description: z.string().trim().min(10).max(20000),
  skills: z.array(z.string().trim().min(1).max(40)).max(50),
  competencies: CompetencyList,
  interviewPlan: InterviewPlan.optional(),
  minimumScore: z.number().min(0).max(100),
  biasAuditUrl: z.url().nullable().optional(),
});

export const CreateJobBody = JobFields.extend({
  skills: JobFields.shape.skills.default([]),
  competencies: CompetencyList.default(DEFAULT_COMPETENCIES),
  minimumScore: JobFields.shape.minimumScore.default(65),
});
export type CreateJobBody = z.infer<typeof CreateJobBody>;

export const UpdateJobBody = JobFields.partial().extend({
  status: z.enum(JOB_STATUSES).optional(),
});
export type UpdateJobBody = z.infer<typeof UpdateJobBody>;

export const JobListQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/* ----------------------------- Question bank ----------------------------- */

export const QuestionDto = z.object({
  id: Id,
  jobId: Id,
  prompt: z.string(),
  competencyKey: z.string().nullable(),
  difficulty: z.enum(QUESTION_DIFFICULTIES),
  expectedSignals: z.array(z.string()),
  followUpHints: z.array(z.string()),
  order: z.number().int(),
  createdAt: IsoDate,
});
export type QuestionDto = z.infer<typeof QuestionDto>;

const QuestionFields = z.object({
  prompt: z.string().trim().min(5).max(4000),
  competencyKey: z.string().trim().max(40).nullable().optional(),
  difficulty: z.enum(QUESTION_DIFFICULTIES),
  expectedSignals: z.array(z.string().trim().min(1).max(200)).max(10),
  followUpHints: z.array(z.string().trim().min(1).max(300)).max(5),
  order: z.number().int().min(0).max(1000),
});
export const CreateQuestionBody = QuestionFields.extend({
  difficulty: QuestionFields.shape.difficulty.default('medium'),
  expectedSignals: QuestionFields.shape.expectedSignals.default([]),
  followUpHints: QuestionFields.shape.followUpHints.default([]),
  order: QuestionFields.shape.order.default(0),
});
export type CreateQuestionBody = z.infer<typeof CreateQuestionBody>;
export const UpdateQuestionBody = QuestionFields.partial();
export type UpdateQuestionBody = z.infer<typeof UpdateQuestionBody>;

/* ---------------------------- Coding problems ---------------------------- */

export const TestCase = z.object({
  input: z.string().max(20000),
  expectedOutput: z.string().max(20000),
  /** Sample cases are shown to the candidate with input/output; hidden ones are not. */
  isSample: z.boolean().default(false),
  weight: z.number().min(0).max(100).default(1),
  label: z.string().trim().max(60).optional(),
});
export type TestCase = z.infer<typeof TestCase>;

export const CodingProblemDto = z.object({
  id: Id,
  jobId: Id,
  title: z.string(),
  statement: z.string(),
  difficulty: z.enum(QUESTION_DIFFICULTIES),
  languageIds: z.array(z.enum(LANGUAGE_IDS)),
  starterCode: z.record(z.string(), z.string()),
  timeLimitMs: z.number().int(),
  memoryLimitMb: z.number().int(),
  tags: z.array(z.string()),
  testCaseCount: z.number().int(),
  sampleCount: z.number().int(),
  /** Full cases: recruiter view only. */
  testCases: z.array(TestCase).optional(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type CodingProblemDto = z.infer<typeof CodingProblemDto>;

/** What a candidate is allowed to see about a problem. */
export const CandidateProblemDto = CodingProblemDto.omit({ testCases: true }).extend({
  sampleCases: z.array(TestCase.pick({ input: true, expectedOutput: true, label: true })),
});
export type CandidateProblemDto = z.infer<typeof CandidateProblemDto>;

const CodingProblemFields = z.object({
  title: z.string().trim().min(2).max(150),
  statement: z.string().trim().min(10).max(30000),
  difficulty: z.enum(QUESTION_DIFFICULTIES),
  languageIds: z.array(z.enum(LANGUAGE_IDS)).min(1),
  starterCode: z.record(z.string(), z.string().max(20000)),
  timeLimitMs: z.number().int().min(500).max(20000),
  memoryLimitMb: z.number().int().min(32).max(1024),
  tags: z.array(z.string().trim().min(1).max(30)).max(10),
  testCases: z.array(TestCase).min(1).max(50),
});
export const CreateCodingProblemBody = CodingProblemFields.extend({
  difficulty: CodingProblemFields.shape.difficulty.default('medium'),
  languageIds: CodingProblemFields.shape.languageIds.default(['javascript', 'python']),
  starterCode: CodingProblemFields.shape.starterCode.default({}),
  timeLimitMs: CodingProblemFields.shape.timeLimitMs.default(3000),
  memoryLimitMb: CodingProblemFields.shape.memoryLimitMb.default(256),
  tags: CodingProblemFields.shape.tags.default([]),
});
export type CreateCodingProblemBody = z.infer<typeof CreateCodingProblemBody>;
export const UpdateCodingProblemBody = CodingProblemFields.partial();
export type UpdateCodingProblemBody = z.infer<typeof UpdateCodingProblemBody>;
