import { z } from 'zod';
import { INTERVIEW_STATUSES, SECTION_TYPES, SPEAKERS } from '../enums.js';
import { Email, Id, IsoDate } from './common.js';
import { InterviewPlan } from './job.js';

export const InterviewInviteDto = z.object({
  id: Id,
  jobId: Id,
  email: z.string(),
  candidateName: z.string().nullable(),
  message: z.string().nullable(),
  status: z.enum(['pending', 'accepted', 'expired', 'cancelled']),
  expiresAt: IsoDate,
  acceptedAt: IsoDate.nullable(),
  interviewId: Id.nullable(),
  invitedBy: z.string(),
  createdAt: IsoDate,
});
export type InterviewInviteDto = z.infer<typeof InterviewInviteDto>;

export const CreateInviteBody = z.object({
  email: Email,
  candidateName: z.string().trim().max(120).optional(),
  message: z.string().trim().max(2000).optional(),
  expiresInDays: z.number().int().min(1).max(60).default(14),
});
export const BulkCreateInviteBody = z.object({
  invites: z.array(CreateInviteBody).min(1).max(200),
});

export const InvitePreview = z.object({
  jobTitle: z.string(),
  organizationName: z.string(),
  candidateName: z.string().nullable(),
  email: z.string(),
  message: z.string().nullable(),
  expiresAt: IsoDate,
  totalMinutes: z.number().int(),
  sections: z.array(z.object({ type: z.enum(SECTION_TYPES), title: z.string(), durationMinutes: z.number().int() })),
  accountExists: z.boolean(),
  /** When true the invite was already accepted: redirect to the interview. */
  interviewId: Id.nullable(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

export const AcceptInviteBody = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
  name: z.string().trim().min(1).max(120).optional(),
  username: z.string().optional(),
  password: z.string().min(10).max(128).optional(),
});

export const SectionProgress = z.object({
  index: z.number().int(),
  type: z.enum(SECTION_TYPES),
  title: z.string(),
  durationMinutes: z.number().int(),
  status: z.enum(['pending', 'active', 'done']),
  startedAt: IsoDate.nullable(),
  deadline: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
});
export type SectionProgress = z.infer<typeof SectionProgress>;

export const InterviewDto = z.object({
  id: Id,
  jobId: Id,
  jobTitle: z.string(),
  organizationName: z.string(),
  candidate: z.object({ id: Id, name: z.string(), email: z.string(), username: z.string() }),
  status: z.enum(INTERVIEW_STATUSES),
  plan: InterviewPlan,
  sections: z.array(SectionProgress),
  currentSection: z.number().int().nullable(),
  consentedAt: IsoDate.nullable(),
  startedAt: IsoDate.nullable(),
  overallDeadline: IsoDate.nullable(),
  completeBy: IsoDate.nullable(),
  submittedAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  reportStatus: z.enum(['pending', 'generating', 'ready', 'failed']).nullable(),
  /** Server time, so clients can correct clock skew. */
  serverTime: IsoDate,
  createdAt: IsoDate,
});
export type InterviewDto = z.infer<typeof InterviewDto>;

export const InterviewSummaryDto = z.object({
  id: Id,
  jobId: Id,
  jobTitle: z.string(),
  candidate: z.object({ id: Id, name: z.string(), email: z.string() }),
  status: z.enum(INTERVIEW_STATUSES),
  totalMinutes: z.number().int(),
  startedAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  completeBy: IsoDate.nullable(),
  weightedScore: z.number().nullable(),
  recommendation: z.string().nullable(),
  decision: z.string().nullable(),
  integrityFlags: z.number().int(),
  createdAt: IsoDate,
});
export type InterviewSummaryDto = z.infer<typeof InterviewSummaryDto>;

export const InterviewListQuery = z.object({
  jobId: Id.optional(),
  status: z.enum(INTERVIEW_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['recent', 'score']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ConsentBody = z.object({
  /** Must match the current disclosure version served to the client. */
  disclosureVersion: z.string(),
  accepted: z.literal(true),
  /** Optional accommodation request recorded alongside consent. */
  accommodationRequest: z.string().trim().max(2000).optional(),
});

export const ConsentDto = z.object({
  disclosureVersion: z.string(),
  textHash: z.string(),
  consentedAt: IsoDate,
  accommodationRequest: z.string().nullable(),
});

export const TurnEvaluation = z.object({
  score: z.number().min(0).max(10).nullable(),
  feedback: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  competencyKey: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});
export type TurnEvaluation = z.infer<typeof TurnEvaluation>;

export const TurnDto = z.object({
  id: Id,
  interviewId: Id,
  sectionIndex: z.number().int(),
  order: z.number().int(),
  question: z.string(),
  competencyKey: z.string().nullable(),
  source: z.enum(['bank', 'generated', 'follow_up']),
  questionId: Id.nullable(),
  askedAt: IsoDate,
  answer: z.string().nullable(),
  answeredAt: IsoDate.nullable(),
  answerDurationSeconds: z.number().nullable(),
  inputMode: z.enum(['text', 'voice']).nullable(),
  skipped: z.boolean(),
  evaluation: TurnEvaluation.nullable(),
});
export type TurnDto = z.infer<typeof TurnDto>;

/** Candidate-safe view of a turn: no per-turn scores during the interview. */
export const CandidateTurnDto = TurnDto.omit({ evaluation: true });
export type CandidateTurnDto = z.infer<typeof CandidateTurnDto>;

export const AnswerBody = z.object({
  turnId: Id,
  answer: z.string().trim().min(1).max(12000),
  inputMode: z.enum(['text', 'voice']).default('text'),
  answerDurationSeconds: z.number().min(0).max(7200).optional(),
});
export const SkipTurnBody = z.object({ turnId: Id });

export const TranscriptEventDto = z.object({
  id: Id,
  sectionIndex: z.number().int(),
  speaker: z.enum(SPEAKERS),
  text: z.string(),
  turnId: Id.nullable(),
  at: IsoDate,
});
export type TranscriptEventDto = z.infer<typeof TranscriptEventDto>;

export const AppendTranscriptBody = z.object({
  text: z.string().trim().min(1).max(12000),
  turnId: Id.nullable().optional(),
  at: IsoDate.optional(),
});

/** Server-sent event payloads streamed while the interviewer "thinks". */
export const QuestionStreamEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({ type: z.literal('question'), turn: CandidateTurnDto, remaining: z.number().int() }),
  z.object({ type: z.literal('section_complete'), sectionIndex: z.number().int() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type QuestionStreamEvent = z.infer<typeof QuestionStreamEvent>;

export const InterviewRoomState = z.object({
  interview: InterviewDto,
  turns: z.array(CandidateTurnDto),
  /** Questions remaining in the active conversation section. */
  remainingQuestions: z.number().int().nullable(),
});
export type InterviewRoomState = z.infer<typeof InterviewRoomState>;
