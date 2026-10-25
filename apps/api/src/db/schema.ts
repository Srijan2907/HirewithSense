import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  CaseResult,
  Competency,
  CompetencyScore,
  IntegritySummary,
  InterviewPlan,
  ResumeProfile,
  SectionProgress,
  TestCase,
  TurnEvaluation,
} from '@hws/shared';

/* --------------------------------- enums --------------------------------- */

export const userRole = pgEnum('user_role', ['candidate', 'recruiter', 'superadmin']);
export const orgRole = pgEnum('org_role', ['owner', 'admin', 'member']);
export const jobStatus = pgEnum('job_status', ['draft', 'open', 'closed', 'archived']);
export const interviewStatus = pgEnum('interview_status', [
  'invited',
  'ready',
  'in_progress',
  'submitted',
  'completed',
  'expired',
  'cancelled',
]);
export const inviteStatus = pgEnum('invite_status', ['pending', 'accepted', 'expired', 'cancelled']);
export const difficulty = pgEnum('difficulty', ['easy', 'medium', 'hard']);
export const speaker = pgEnum('speaker', ['interviewer', 'candidate', 'system']);
export const submissionStatus = pgEnum('submission_status', ['queued', 'running', 'graded', 'error']);
export const reportStatus = pgEnum('report_status', ['pending', 'generating', 'ready', 'failed']);
export const parseStatus = pgEnum('parse_status', ['pending', 'parsing', 'parsed', 'failed']);
export const authTokenPurpose = pgEnum('auth_token_purpose', ['password_reset', 'email_verify']);
export const decisionEnum = pgEnum('decision', ['advance', 'hold', 'reject', 'hire']);
export const turnSource = pgEnum('turn_source', ['bank', 'generated', 'follow_up']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* --------------------------------- users --------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    username: text('username').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('candidate'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    headline: text('headline'),
    location: text('location'),
    timezone: text('timezone'),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    tokenVersion: integer('token_version').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email), uniqueIndex('users_username_idx').on(t.username)],
);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  website: text('website'),
  logoUrl: text('logo_url'),
  retentionDays: integer('retention_days').notNull().default(365),
  ...timestamps,
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_org_user_idx').on(t.organizationId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const orgInvites = pgTable(
  'org_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: orgRole('role').notNull().default('member'),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('org_invites_org_idx').on(t.organizationId)],
);

export const refreshSessions = pgTable(
  'refresh_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('refresh_sessions_user_idx').on(t.userId), index('refresh_sessions_family_idx').on(t.familyId)],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_tokens_user_idx').on(t.userId)],
);

/* -------------------------------- resumes -------------------------------- */

export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    extractedText: text('extracted_text').notNull().default(''),
    parseStatus: parseStatus('parse_status').notNull().default('pending'),
    parseError: text('parse_error'),
    profile: jsonb('profile').$type<ResumeProfile>(),
    ...timestamps,
  },
  (t) => [index('resumes_user_idx').on(t.userId)],
);

/* ---------------------------------- jobs --------------------------------- */

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    department: text('department'),
    location: text('location'),
    employmentType: text('employment_type'),
    seniority: text('seniority'),
    description: text('description').notNull(),
    skills: jsonb('skills').$type<string[]>().notNull().default([]),
    status: jobStatus('status').notNull().default('draft'),
    competencies: jsonb('competencies').$type<Competency[]>().notNull(),
    interviewPlan: jsonb('interview_plan').$type<InterviewPlan>().notNull(),
    minimumScore: doublePrecision('minimum_score').notNull().default(65),
    biasAuditUrl: text('bias_audit_url'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('jobs_org_slug_idx').on(t.organizationId, t.slug), index('jobs_org_status_idx').on(t.organizationId, t.status)],
);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    competencyKey: text('competency_key'),
    difficulty: difficulty('difficulty').notNull().default('medium'),
    expectedSignals: jsonb('expected_signals').$type<string[]>().notNull().default([]),
    followUpHints: jsonb('follow_up_hints').$type<string[]>().notNull().default([]),
    order: integer('order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('questions_job_idx').on(t.jobId)],
);

export const codingProblems = pgTable(
  'coding_problems',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    statement: text('statement').notNull(),
    difficulty: difficulty('difficulty').notNull().default('medium'),
    languageIds: jsonb('language_ids').$type<string[]>().notNull(),
    starterCode: jsonb('starter_code').$type<Record<string, string>>().notNull().default({}),
    timeLimitMs: integer('time_limit_ms').notNull().default(3000),
    memoryLimitMb: integer('memory_limit_mb').notNull().default(256),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    testCases: jsonb('test_cases').$type<TestCase[]>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('coding_problems_job_idx').on(t.jobId)],
);

/* ------------------------------- interviews ------------------------------ */

export const interviewInvites = pgTable(
  'interview_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    candidateName: text('candidate_name'),
    message: text('message'),
    tokenHash: text('token_hash').notNull().unique(),
    status: inviteStatus('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    interviewId: uuid('interview_id'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('interview_invites_job_idx').on(t.jobId), index('interview_invites_email_idx').on(t.email)],
);

export const interviews = pgTable(
  'interviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteId: uuid('invite_id').references(() => interviewInvites.id, { onDelete: 'set null' }),
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    status: interviewStatus('status').notNull().default('ready'),
    plan: jsonb('plan').$type<InterviewPlan>().notNull(),
    sections: jsonb('sections').$type<SectionProgress[]>().notNull(),
    currentSection: integer('current_section'),
    consentedAt: timestamp('consented_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    overallDeadline: timestamp('overall_deadline', { withTimezone: true }),
    completeBy: timestamp('complete_by', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    reportStatus: reportStatus('report_status'),
    ...timestamps,
  },
  (t) => [
    index('interviews_candidate_idx').on(t.candidateId),
    index('interviews_job_idx').on(t.jobId),
    index('interviews_org_status_idx').on(t.organizationId, t.status),
    index('interviews_deadline_idx').on(t.overallDeadline),
  ],
);

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  interviewId: uuid('interview_id')
    .notNull()
    .references(() => interviews.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  disclosureVersion: text('disclosure_version').notNull(),
  textHash: text('text_hash').notNull(),
  accommodationRequest: text('accommodation_request'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
});

export const interviewTurns = pgTable(
  'interview_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    interviewId: uuid('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    sectionIndex: integer('section_index').notNull(),
    order: integer('order').notNull(),
    question: text('question').notNull(),
    competencyKey: text('competency_key'),
    source: turnSource('source').notNull(),
    questionId: uuid('question_id'),
    askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
    answer: text('answer'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answerDurationSeconds: doublePrecision('answer_duration_seconds'),
    inputMode: text('input_mode'),
    skipped: boolean('skipped').notNull().default(false),
    evaluation: jsonb('evaluation').$type<TurnEvaluation>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('interview_turns_interview_idx').on(t.interviewId, t.order)],
);

export const transcriptEvents = pgTable(
  'transcript_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    interviewId: uuid('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    sectionIndex: integer('section_index').notNull().default(0),
    speaker: speaker('speaker').notNull(),
    text: text('text').notNull(),
    turnId: uuid('turn_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('transcript_events_interview_idx').on(t.interviewId, t.at)],
);

export const codeDrafts = pgTable(
  'code_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    interviewId: uuid('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    problemId: uuid('problem_id').notNull(),
    languageId: text('language_id').notNull(),
    sourceCode: text('source_code').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('code_drafts_interview_problem_idx').on(t.interviewId, t.problemId)],
);

export const codeSubmissions = pgTable(
  'code_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    interviewId: uuid('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    problemId: uuid('problem_id').notNull(),
    sectionIndex: integer('section_index').notNull(),
    languageId: text('language_id').notNull(),
    sourceCode: text('source_code').notNull(),
    kind: text('kind').notNull().default('submit'),
    status: submissionStatus('status').notNull().default('queued'),
    compileOutput: text('compile_output'),
    errorMessage: text('error_message'),
    passed: integer('passed').notNull().default(0),
    total: integer('total').notNull().default(0),
    score: doublePrecision('score'),
    results: jsonb('results').$type<CaseResult[]>().notNull().default([]),
    runner: text('runner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
  },
  (t) => [index('code_submissions_interview_idx').on(t.interviewId, t.createdAt)],
);

export const proctoringEvents = pgTable(
  'proctoring_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    interviewId: uuid('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    sectionIndex: integer('section_index'),
    meta: jsonb('meta').$type<Record<string, string | number | boolean>>(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('proctoring_events_interview_idx').on(t.interviewId, t.at)],
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  interviewId: uuid('interview_id')
    .notNull()
    .unique()
    .references(() => interviews.id, { onDelete: 'cascade' }),
  status: reportStatus('status').notNull().default('pending'),
  error: text('error'),
  summary: text('summary').notNull().default(''),
  strengths: jsonb('strengths').$type<string[]>().notNull().default([]),
  considerations: jsonb('considerations').$type<string[]>().notNull().default([]),
  competencies: jsonb('competencies').$type<CompetencyScore[]>().notNull().default([]),
  weightedScore: doublePrecision('weighted_score'),
  coverage: doublePrecision('coverage').notNull().default(0),
  recommendation: text('recommendation').notNull().default('insufficient_evidence'),
  minimumScore: doublePrecision('minimum_score').notNull().default(65),
  meetsMinimum: boolean('meets_minimum'),
  integrity: jsonb('integrity').$type<IntegritySummary>(),
  provider: text('provider').notNull().default('mock'),
  model: text('model'),
  evidenceStats: jsonb('evidence_stats').$type<{ turns: number; answered: number; submissions: number; transcriptChars: number }>(),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  ...timestamps,
});

export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  interviewId: uuid('interview_id')
    .notNull()
    .unique()
    .references(() => interviews.id, { onDelete: 'cascade' }),
  decision: decisionEnum('decision').notNull(),
  reason: text('reason').notNull(),
  overridesRecommendation: boolean('overrides_recommendation').notNull().default(false),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------ cross-cutting ---------------------------- */

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id'),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_org_idx').on(t.organizationId, t.createdAt), index('audit_logs_target_idx').on(t.targetType, t.targetId)],
);

export const emailOutbox = pgTable('email_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  text: text('text').notNull(),
  html: text('html'),
  status: text('status').notNull().default('queued'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
});

/* -------------------------------- relations ------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  resumes: many(resumes),
}));
export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  jobs: many(jobs),
}));
export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  organization: one(organizations, { fields: [memberships.organizationId], references: [organizations.id] }),
}));
export const jobsRelations = relations(jobs, ({ one, many }) => ({
  organization: one(organizations, { fields: [jobs.organizationId], references: [organizations.id] }),
  questions: many(questions),
  codingProblems: many(codingProblems),
  interviews: many(interviews),
}));
export const interviewsRelations = relations(interviews, ({ one, many }) => ({
  job: one(jobs, { fields: [interviews.jobId], references: [jobs.id] }),
  candidate: one(users, { fields: [interviews.candidateId], references: [users.id] }),
  turns: many(interviewTurns),
  submissions: many(codeSubmissions),
  report: one(reports, { fields: [interviews.id], references: [reports.interviewId] }),
}));

export const sqlNow = sql`now()`;

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type CodingProblem = typeof codingProblems.$inferSelect;
export type Interview = typeof interviews.$inferSelect;
export type InterviewInvite = typeof interviewInvites.$inferSelect;
export type InterviewTurn = typeof interviewTurns.$inferSelect;
export type TranscriptEvent = typeof transcriptEvents.$inferSelect;
export type CodeSubmission = typeof codeSubmissions.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
