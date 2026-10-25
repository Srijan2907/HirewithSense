import { z } from 'zod';
import { DECISIONS, RECOMMENDATIONS, REPORT_STATUSES } from '../enums.js';
import { Id, IsoDate } from './common.js';

export const Evidence = z.object({
  quote: z.string().max(600),
  /** Where the quote came from. */
  source: z.enum(['answer', 'code', 'test_results', 'transcript']),
  turnId: Id.nullable().optional(),
  submissionId: Id.nullable().optional(),
  note: z.string().max(400).optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const CompetencyScore = z.object({
  key: z.string(),
  label: z.string(),
  weight: z.number(),
  /** 0–100; null means not assessed (insufficient evidence). */
  score: z.number().min(0).max(100).nullable(),
  /** 1–5 anchored level; null when not assessed. */
  level: z.number().int().min(1).max(5).nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(1200),
  evidence: z.array(Evidence).max(8),
  /** True when the score was computed deterministically (e.g. from tests), not by the model. */
  deterministic: z.boolean().default(false),
});
export type CompetencyScore = z.infer<typeof CompetencyScore>;

export const IntegritySummary = z.object({
  flags: z.number().int(),
  focusLost: z.number().int(),
  pasteEvents: z.number().int(),
  fullscreenExits: z.number().int(),
  tabHidden: z.number().int(),
  otherEvents: z.number().int(),
  /** Human-readable, non-judgemental notes. */
  notes: z.array(z.string()),
});
export type IntegritySummary = z.infer<typeof IntegritySummary>;

export const ReportDto = z.object({
  id: Id,
  interviewId: Id,
  status: z.enum(REPORT_STATUSES),
  error: z.string().nullable(),
  summary: z.string(),
  strengths: z.array(z.string()),
  considerations: z.array(z.string()),
  competencies: z.array(CompetencyScore),
  /** Weighted score over assessed competencies, 0–100. */
  weightedScore: z.number().nullable(),
  /** Share (0–1) of total weight that was assessed. */
  coverage: z.number(),
  recommendation: z.enum(RECOMMENDATIONS),
  minimumScore: z.number(),
  meetsMinimum: z.boolean().nullable(),
  integrity: IntegritySummary,
  provider: z.string(),
  model: z.string().nullable(),
  generatedAt: IsoDate.nullable(),
  /** Which evidence was fed to the model, for auditability. */
  evidenceStats: z.object({
    turns: z.number().int(),
    answered: z.number().int(),
    submissions: z.number().int(),
    transcriptChars: z.number().int(),
  }),
});
export type ReportDto = z.infer<typeof ReportDto>;

/** What the model is asked to produce (coding correctness is injected deterministically). */
export const ModelReport = z.object({
  summary: z.string().max(2000),
  strengths: z.array(z.string().max(300)).max(8),
  considerations: z.array(z.string().max(300)).max(8),
  competencies: z.array(
    z.object({
      key: z.string(),
      score: z.number().min(0).max(100).nullable(),
      level: z.number().int().min(1).max(5).nullable(),
      confidence: z.number().min(0).max(1),
      rationale: z.string().max(1200),
      evidence: z.array(Evidence).max(8).default([]),
    }),
  ),
});
export type ModelReport = z.infer<typeof ModelReport>;

export const DecisionDto = z.object({
  interviewId: Id,
  decision: z.enum(DECISIONS),
  reason: z.string(),
  overridesRecommendation: z.boolean(),
  decidedBy: z.object({ id: Id, name: z.string() }),
  decidedAt: IsoDate,
});
export type DecisionDto = z.infer<typeof DecisionDto>;

export const DecisionBody = z.object({
  decision: z.enum(DECISIONS),
  reason: z.string().trim().min(5).max(2000),
});

export const RankingRow = z.object({
  interviewId: Id,
  candidate: z.object({ id: Id, name: z.string(), email: z.string() }),
  status: z.string(),
  weightedScore: z.number().nullable(),
  coverage: z.number().nullable(),
  recommendation: z.string().nullable(),
  meetsMinimum: z.boolean().nullable(),
  competencyScores: z.record(z.string(), z.number().nullable()),
  codingScore: z.number().nullable(),
  integrityFlags: z.number().int(),
  decision: z.string().nullable(),
  completedAt: IsoDate.nullable(),
});
export type RankingRow = z.infer<typeof RankingRow>;

export const RankingsDto = z.object({
  job: z.object({ id: Id, title: z.string(), minimumScore: z.number(), competencies: z.array(z.object({ key: z.string(), label: z.string(), weight: z.number() })) }),
  rows: z.array(RankingRow),
});
export type RankingsDto = z.infer<typeof RankingsDto>;
