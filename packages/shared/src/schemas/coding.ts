import { z } from 'zod';
import { LANGUAGE_IDS, SUBMISSION_STATUSES, VERDICTS } from '../enums.js';
import { Id, IsoDate } from './common.js';

export const CaseResult = z.object({
  index: z.number().int(),
  isSample: z.boolean(),
  label: z.string().nullable(),
  verdict: z.enum(VERDICTS),
  timeMs: z.number().nullable(),
  memoryKb: z.number().nullable(),
  /** Only populated for sample cases (never for hidden cases). */
  stdout: z.string().nullable(),
  stderr: z.string().nullable(),
  expectedOutput: z.string().nullable(),
  input: z.string().nullable(),
});
export type CaseResult = z.infer<typeof CaseResult>;

export const SubmissionDto = z.object({
  id: Id,
  interviewId: Id,
  problemId: Id,
  sectionIndex: z.number().int(),
  languageId: z.enum(LANGUAGE_IDS),
  sourceCode: z.string(),
  kind: z.enum(['run', 'submit']),
  status: z.enum(SUBMISSION_STATUSES),
  compileOutput: z.string().nullable(),
  errorMessage: z.string().nullable(),
  passed: z.number().int(),
  total: z.number().int(),
  /** Weighted score 0..100 across all cases. */
  score: z.number().nullable(),
  results: z.array(CaseResult),
  runner: z.string().nullable(),
  createdAt: IsoDate,
  gradedAt: IsoDate.nullable(),
});
export type SubmissionDto = z.infer<typeof SubmissionDto>;

export const RunCodeBody = z.object({
  problemId: Id,
  languageId: z.enum(LANGUAGE_IDS),
  sourceCode: z.string().max(60000),
  /** Optional custom stdin for ad-hoc runs (sample cases still run). */
  customInput: z.string().max(10000).optional(),
});
export type RunCodeBody = z.infer<typeof RunCodeBody>;

export const SubmitCodeBody = z.object({
  problemId: Id,
  languageId: z.enum(LANGUAGE_IDS),
  sourceCode: z.string().min(1).max(60000),
});
export type SubmitCodeBody = z.infer<typeof SubmitCodeBody>;

export const SaveDraftBody = z.object({
  problemId: Id,
  languageId: z.enum(LANGUAGE_IDS),
  sourceCode: z.string().max(60000),
});

export const DraftDto = z.object({
  problemId: Id,
  languageId: z.enum(LANGUAGE_IDS),
  sourceCode: z.string(),
  updatedAt: IsoDate,
});

export const LanguageInfo = z.object({
  id: z.enum(LANGUAGE_IDS),
  label: z.string(),
  monaco: z.string(),
  available: z.boolean(),
});

export const CodingRoomState = z.object({
  sectionIndex: z.number().int(),
  problems: z.array(z.any()),
  drafts: z.array(DraftDto),
  submissions: z.array(SubmissionDto),
  languages: z.array(LanguageInfo),
});
