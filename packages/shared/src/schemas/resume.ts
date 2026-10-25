import { z } from 'zod';
import { RESUME_PARSE_STATUSES } from '../enums.js';
import { Id, IsoDate } from './common.js';

export const ResumeProfile = z.object({
  summary: z.string().max(2000).default(''),
  skills: z.array(z.string().max(60)).max(80).default([]),
  experience: z
    .array(
      z.object({
        company: z.string().max(120).default(''),
        title: z.string().max(120).default(''),
        start: z.string().max(40).default(''),
        end: z.string().max(40).default(''),
        highlights: z.array(z.string().max(500)).max(10).default([]),
      }),
    )
    .max(20)
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string().max(120).default(''),
        description: z.string().max(800).default(''),
        technologies: z.array(z.string().max(60)).max(20).default([]),
      }),
    )
    .max(20)
    .default([]),
  education: z
    .array(
      z.object({
        institution: z.string().max(160).default(''),
        degree: z.string().max(160).default(''),
        year: z.string().max(20).default(''),
      }),
    )
    .max(10)
    .default([]),
  yearsOfExperience: z.number().min(0).max(60).nullable().default(null),
});
export type ResumeProfile = z.infer<typeof ResumeProfile>;

export const ResumeDto = z.object({
  id: Id,
  userId: Id,
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  parseStatus: z.enum(RESUME_PARSE_STATUSES),
  parseError: z.string().nullable(),
  profile: ResumeProfile.nullable(),
  textPreview: z.string().nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ResumeDto = z.infer<typeof ResumeDto>;
