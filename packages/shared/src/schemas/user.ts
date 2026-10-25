import { z } from 'zod';
import { Username } from './common.js';

export const UpdateProfileBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  username: Username.optional(),
  headline: z.string().trim().max(160).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  timezone: z.string().trim().max(64).optional().nullable(),
});
export type UpdateProfileBody = z.infer<typeof UpdateProfileBody>;

export const CandidateProfile = z.object({
  headline: z.string().nullable(),
  location: z.string().nullable(),
  timezone: z.string().nullable(),
});
export type CandidateProfile = z.infer<typeof CandidateProfile>;
