import { z } from 'zod';
import { ORG_ROLES } from '../enums.js';
import { Email, Id, IsoDate, Slug } from './common.js';

export const OrganizationDto = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  website: z.string().nullable(),
  logoUrl: z.string().nullable(),
  /** Days to keep interview data before automatic purge. */
  retentionDays: z.number().int(),
  createdAt: IsoDate,
});
export type OrganizationDto = z.infer<typeof OrganizationDto>;

export const UpdateOrganizationBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  slug: Slug.optional(),
  website: z.url().max(200).nullable().optional(),
  retentionDays: z.number().int().min(30).max(3650).optional(),
});

export const MemberDto = z.object({
  userId: Id,
  name: z.string(),
  email: z.string(),
  username: z.string(),
  role: z.enum(ORG_ROLES),
  joinedAt: IsoDate,
});
export type MemberDto = z.infer<typeof MemberDto>;

export const UpdateMemberBody = z.object({ role: z.enum(['admin', 'member']) });

export const OrgInviteDto = z.object({
  id: Id,
  email: z.string(),
  role: z.enum(['admin', 'member']),
  invitedBy: z.string(),
  expiresAt: IsoDate,
  acceptedAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export type OrgInviteDto = z.infer<typeof OrgInviteDto>;

export const CreateOrgInviteBody = z.object({ email: Email, role: z.enum(['admin', 'member']).default('member') });

export const AcceptOrgInviteBody = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
  /** Required when the invitee has no account yet. */
  name: z.string().trim().min(1).max(120).optional(),
  username: z.string().optional(),
  password: z.string().min(10).max(128).optional(),
});

export const OrgInvitePreview = z.object({
  organizationName: z.string(),
  email: z.string(),
  role: z.enum(['admin', 'member']),
  accountExists: z.boolean(),
  expiresAt: IsoDate,
});
