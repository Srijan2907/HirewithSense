import { z } from 'zod';

export const Id = z.uuid();
export const IsoDate = z.iso.datetime({ offset: true }).or(z.iso.datetime());
export const Email = z.email().max(254).transform((v) => v.trim().toLowerCase());
export const Password = z.string().min(10, 'Use at least 10 characters').max(128);
export const Username = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Letters, numbers, dot, dash and underscore only')
  .transform((v) => v.toLowerCase());
export const Slug = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and dashes');

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const OkResponse = z.object({ ok: z.literal(true) });
export const IdParam = z.object({ id: Id });
