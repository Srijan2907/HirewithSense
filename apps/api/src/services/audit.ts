import type { FastifyRequest } from 'fastify';
import { getDb } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId?: string | null;
  organizationId?: string | null;
  actorId?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown>;
}

/** Fire-and-forget audit record. Never throws into the request path. */
export function audit(entry: AuditEntry, req?: FastifyRequest): void {
  const row = {
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    organizationId: entry.organizationId ?? req?.user?.org?.id ?? null,
    actorId: entry.actorId ?? req?.user?.id ?? null,
    ip: entry.ip ?? req?.clientIp ?? null,
    meta: entry.meta ?? null,
  };
  Promise.resolve()
    .then(() => getDb().insert(auditLogs).values(row))
    .catch((err) => req?.log.warn({ err }, 'audit insert failed'));
}
