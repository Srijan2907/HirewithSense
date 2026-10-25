import { z } from 'zod';
import { USER_ROLES } from '../enums.js';
import { Email, Id, IsoDate, Password, Slug, Username } from './common.js';

export const PublicUser = z.object({
  id: Id,
  name: z.string(),
  username: z.string(),
  email: z.string(),
  role: z.enum(USER_ROLES),
  emailVerifiedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  /** Present for recruiters: the organization they act for. */
  organization: z
    .object({ id: Id, name: z.string(), slug: z.string(), role: z.enum(['owner', 'admin', 'member']) })
    .nullable(),
});
export type PublicUser = z.infer<typeof PublicUser>;

export const RegisterCandidateBody = z.object({
  name: z.string().trim().min(1).max(120),
  username: Username,
  email: Email,
  password: Password,
});
export type RegisterCandidateBody = z.infer<typeof RegisterCandidateBody>;

export const RegisterRecruiterBody = RegisterCandidateBody.extend({
  organizationName: z.string().trim().min(2).max(120),
  organizationSlug: Slug.optional(),
});
export type RegisterRecruiterBody = z.infer<typeof RegisterRecruiterBody>;

export const LoginBody = z.object({ email: Email, password: z.string().min(1).max(128) });
export type LoginBody = z.infer<typeof LoginBody>;

export const AuthResponse = z.object({
  user: PublicUser,
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int(),
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const ForgotPasswordBody = z.object({ email: Email });
export const ResetPasswordBody = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
  password: Password,
});
export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: Password,
});
export const VerifyEmailBody = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i) });

export const SessionDto = z.object({
  id: Id,
  createdAt: IsoDate,
  lastUsedAt: IsoDate,
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  current: z.boolean(),
});
export type SessionDto = z.infer<typeof SessionDto>;
