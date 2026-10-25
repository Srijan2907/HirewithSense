import type { FastifyBaseLogger } from 'fastify';
import type { QueueName } from './boss.js';
import { deliverMail, type Mail } from '../services/email.js';
import { parseResumeJob } from '../modules/resumes/service.js';

type Handler = (data: any, log: FastifyBaseLogger | Console) => Promise<void>;

const handlers: Partial<Record<QueueName, Handler>> = {
  'email.send': async (data: { mail: Mail }) => {
    await deliverMail(data.mail);
  },
  'resume.parse': async (data: { resumeId: string }) => {
    await parseResumeJob(data.resumeId);
  },
};

export function registerHandler(name: QueueName, handler: Handler) {
  handlers[name] = handler;
}

export function getHandler(name: QueueName): Handler | undefined {
  return handlers[name];
}

/** Used when DISABLE_JOBS=true (tests): run the job synchronously. */
export async function runInline(name: QueueName, data: Record<string, unknown>): Promise<void> {
  const h = handlers[name];
  if (!h) return;
  try {
    await h(data, console);
  } catch (err) {
    // Mirrors pg-boss semantics: a failing job never fails the request that enqueued it.
    if (process.env.NODE_ENV !== 'test') console.error(`[jobs] ${name} failed inline:`, err);
  }
}
