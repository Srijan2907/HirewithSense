import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Opaque 256-bit token as 64 hex chars. Only its hash is ever stored. */
export const randomToken = () => randomBytes(32).toString('hex');

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface AccessClaims {
  sub: string;
  role: 'candidate' | 'recruiter' | 'superadmin';
  ver: number;
  org?: string;
}

const secret = () => new TextEncoder().encode(env().JWT_SECRET);

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, ver: claims.ver, ...(claims.org ? { org: claims.org } : {}) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer('hirewithsense')
    .setAudience('hirewithsense:api')
    .setIssuedAt()
    .setExpirationTime(`${env().ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secret(), {
    issuer: 'hirewithsense',
    audience: 'hirewithsense:api',
    algorithms: ['HS256'],
  });
  if (!payload.sub || typeof payload.role !== 'string') throw new Error('Malformed token');
  return {
    sub: payload.sub,
    role: payload.role as AccessClaims['role'],
    ver: Number(payload.ver ?? 0),
    org: typeof payload.org === 'string' ? payload.org : undefined,
  };
}
