import { PgBoss } from 'pg-boss';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env.js';
import { jobsProcessed } from '../plugins/metrics.js';

export const QUEUES = {
  resumeParse: 'resume.parse',
  submissionGrade: 'submission.grade',
  reportGenerate: 'report.generate',
  emailSend: 'email.send',
  interviewExpire: 'interview.expire',
  retentionPurge: 'retention.purge',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

let boss: PgBoss | null = null;
let logger: FastifyBaseLogger | Console = console;

export function setJobLogger(l: FastifyBaseLogger) {
  logger = l;
}

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const b = new PgBoss({
    connectionString: env().DATABASE_URL,
    schema: 'pgboss',
    max: 4,
    supervise: true,
    schedule: true,
  });
  b.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await b.start();
  for (const name of Object.values(QUEUES)) {
    await b.createQueue(name, { retryLimit: 3, retryDelay: 10, retryBackoff: true, expireInSeconds: 15 * 60, retentionSeconds: 7 * 86_400 }).catch(() => {});
  }
  boss = b;
  return b;
}

export async function stopBoss(): Promise<void> {
  if (boss) await boss.stop({ graceful: true, timeout: 10_000 });
  boss = null;
}

/** Enqueue work. When jobs are disabled (tests), the fallback runs inline so behaviour stays observable. */
export async function enqueue(name: QueueName, data: Record<string, unknown>, opts?: { singletonKey?: string; startAfter?: number }): Promise<string | null> {
  if (env().DISABLE_JOBS) {
    const { runInline } = await import('./workers.js');
    await runInline(name, data);
    return null;
  }
  const b = await getBoss();
  return b.send(name, data, { singletonKey: opts?.singletonKey, startAfter: opts?.startAfter });
}

export function recordJob(queue: string, outcome: 'ok' | 'error') {
  jobsProcessed.inc({ queue, outcome });
}
