import type { CaseResult, LanguageId, TestCase, Verdict } from '@hws/shared';
import { env } from '../../config/env.js';
import { codeRuns } from '../../plugins/metrics.js';
import { unavailable } from '../../lib/errors.js';
import type { CodeRunner, RunResult } from './types.js';

class NoopRunner implements CodeRunner {
  readonly kind = 'none';
  async availableLanguages(): Promise<LanguageId[]> {
    return [];
  }
  async run(): Promise<RunResult> {
    return { runner: this.kind, compileOutput: null, compileError: false, cases: [], error: 'Code execution is not configured on this server (set CODE_RUNNER).' };
  }
}

let runner: CodeRunner | null = null;
let running = 0;
const waiters: Array<() => void> = [];

export async function getRunner(): Promise<CodeRunner> {
  if (runner) return runner;
  const e = env();
  switch (e.CODE_RUNNER) {
    case 'docker': {
      const { DockerRunner } = await import('./docker.js');
      runner = new DockerRunner();
      break;
    }
    case 'judge0': {
      const { Judge0Runner } = await import('./judge0.js');
      runner = new Judge0Runner();
      break;
    }
    case 'local': {
      if (e.NODE_ENV === 'production') throw new Error('CODE_RUNNER=local is not allowed in production');
      const { UnsafeLocalRunner } = await import('./local.js');
      runner = new UnsafeLocalRunner();
      break;
    }
    default:
      runner = new NoopRunner();
  }
  return runner;
}

export function setRunner(r: CodeRunner | null) {
  runner = r;
}

/** Bound the number of concurrent sandbox executions on this node. */
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  const max = env().RUNNER_MAX_CONCURRENCY;
  if (running >= max) await new Promise<void>((resolve) => waiters.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

export interface GradeOutcome {
  status: 'graded' | 'error';
  runner: string;
  compileOutput: string | null;
  errorMessage: string | null;
  results: CaseResult[];
  passed: number;
  total: number;
  /** Weighted 0..100 */
  score: number | null;
  passedWeight: number;
  totalWeight: number;
}

/**
 * Execute `cases` and produce candidate-safe results: hidden cases never expose input, expected
 * output, stdout or stderr. `revealAll` is used for recruiter views.
 */
export async function gradeSubmission(opts: {
  languageId: LanguageId;
  sourceCode: string;
  cases: TestCase[];
  timeLimitMs: number;
  memoryLimitMb: number;
  revealAll?: boolean;
}): Promise<GradeOutcome> {
  const r = await getRunner();
  const available = await r.availableLanguages();
  if (!available.includes(opts.languageId)) {
    throw unavailable(`Language ${opts.languageId} is not available on this server's code runner (${r.kind}).`);
  }
  const result = await withSlot(() =>
    r.run({
      languageId: opts.languageId,
      sourceCode: opts.sourceCode,
      cases: opts.cases.map((c) => ({ input: c.input, expectedOutput: c.expectedOutput })),
      timeLimitMs: opts.timeLimitMs,
      memoryLimitMb: opts.memoryLimitMb,
    }),
  );

  const totalWeight = opts.cases.reduce((s, c) => s + (c.weight ?? 1), 0);
  if (result.error) {
    return { status: 'error', runner: result.runner, compileOutput: null, errorMessage: result.error, results: [], passed: 0, total: opts.cases.length, score: null, passedWeight: 0, totalWeight };
  }
  if (result.compileError) {
    codeRuns.inc({ runner: result.runner, language: opts.languageId, verdict: 'compile_error' });
    const results: CaseResult[] = opts.cases.map((c, i) => ({
      index: i,
      isSample: Boolean(c.isSample),
      label: c.label ?? null,
      verdict: 'compile_error' as Verdict,
      timeMs: null,
      memoryKb: null,
      stdout: null,
      stderr: null,
      expectedOutput: c.isSample || opts.revealAll ? c.expectedOutput : null,
      input: c.isSample || opts.revealAll ? c.input : null,
    }));
    return { status: 'graded', runner: result.runner, compileOutput: result.compileOutput, errorMessage: null, results, passed: 0, total: opts.cases.length, score: 0, passedWeight: 0, totalWeight };
  }

  let passed = 0;
  let passedWeight = 0;
  const results: CaseResult[] = opts.cases.map((c, i) => {
    const raw = result.cases[i] ?? { verdict: 'internal_error' as Verdict, stdout: '', stderr: '', timeMs: null, memoryKb: null };
    const reveal = Boolean(c.isSample) || Boolean(opts.revealAll);
    if (raw.verdict === 'passed') {
      passed++;
      passedWeight += c.weight ?? 1;
    }
    codeRuns.inc({ runner: result.runner, language: opts.languageId, verdict: raw.verdict });
    return {
      index: i,
      isSample: Boolean(c.isSample),
      label: c.label ?? null,
      verdict: raw.verdict,
      timeMs: raw.timeMs,
      memoryKb: raw.memoryKb,
      stdout: reveal ? raw.stdout : null,
      stderr: reveal ? raw.stderr : null,
      expectedOutput: reveal ? c.expectedOutput : null,
      input: reveal ? c.input : null,
    };
  });
  const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 10000) / 100 : null;
  return { status: 'graded', runner: result.runner, compileOutput: result.compileOutput, errorMessage: null, results, passed, total: opts.cases.length, score, passedWeight, totalWeight };
}
