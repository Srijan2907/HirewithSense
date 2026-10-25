import { z } from 'zod';
import { PROCTORING_EVENT_TYPES } from '../enums.js';
import { Id, IsoDate } from './common.js';

export const ProctoringEventInput = z.object({
  type: z.enum(PROCTORING_EVENT_TYPES),
  at: IsoDate,
  sectionIndex: z.number().int().nullable().optional(),
  /** Small, non-sensitive context (e.g. pasted length). Never content. */
  meta: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});
export const ProctoringBatchBody = z.object({ events: z.array(ProctoringEventInput).min(1).max(100) });

export const ProctoringEventDto = ProctoringEventInput.extend({ id: Id, receivedAt: IsoDate });
export type ProctoringEventDto = z.infer<typeof ProctoringEventDto>;
