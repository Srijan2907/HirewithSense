export type ErrorCode =
  | 'bad_request'
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'locked'
  | 'service_unavailable'
  | 'internal_error';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  payload_too_large: 413,
  unsupported_media_type: 415,
  locked: 423,
  rate_limited: 429,
  service_unavailable: 503,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.details = details;
    this.expose = this.statusCode < 500;
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError('bad_request', m, d);
export const unauthorized = (m = 'Authentication required') => new AppError('unauthorized', m);
export const forbidden = (m = 'You do not have permission to do that') => new AppError('forbidden', m);
export const notFound = (what = 'Resource') => new AppError('not_found', `${what} not found`);
export const conflict = (m: string) => new AppError('conflict', m);
export const gone = (m: string) => new AppError('gone', m);
export const locked = (m: string) => new AppError('locked', m);
export const unavailable = (m: string) => new AppError('service_unavailable', m);
export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
