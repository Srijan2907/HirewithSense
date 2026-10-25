import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { LanguageId } from '@hws/shared';
import { exec } from './docker.js';
import { LANGUAGE_SPECS, clip, outputsMatch, type CodeRunner, type RawCaseResult, type RunRequest, type RunResult } from './types.js';

/**
 * DEVELOPMENT ONLY. Executes candidate code directly on the host with nothing but a timeout.
 * Never enable in production: it is here so the IDE can be exercised without Docker or Judge0.
 */
export class UnsafeLocalRunner implements CodeRunner {
  readonly kind = 'local-unsafe';
  async availableLanguages(): Promise<LanguageId[]> {
    const out: LanguageId[] = [];
    for (const spec of Object.values(LANGUAGE_SPECS)) {
      if (!spec.local) continue;
      const r = await exec(spec.local.cmd[0]!, ['--version'], { timeoutMs: 5000 });
      if (r.code === 0) out.push(spec.id);
    }
    return out;
  }
  async run(req: RunRequest): Promise<RunResult> {
    const spec = LANGUAGE_SPECS[req.languageId];
    if (!spec.local) return { runner: this.kind, compileOutput: null, compileError: false, cases: [], error: `Language ${req.languageId} is not supported by the local runner` };
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'hws-local-'));
    try {
      await fs.writeFile(path.join(work, spec.file), req.sourceCode, 'utf8');
      const cases: RawCaseResult[] = [];
      for (const c of req.cases) {
        const started = Date.now();
        const r = await exec(spec.local.cmd[0]!, [...spec.local.cmd.slice(1).map((a) => path.join(work, a))], { timeoutMs: req.timeLimitMs * spec.timeFactor, input: c.input });
        const timeMs = Date.now() - started;
        let verdict: RawCaseResult['verdict'];
        if (r.timedOut) verdict = 'time_limit';
        else if (r.code !== 0) verdict = 'runtime_error';
        else verdict = outputsMatch(r.stdout, c.expectedOutput) ? 'passed' : 'wrong_answer';
        cases.push({ verdict, stdout: clip(r.stdout), stderr: clip(r.stderr, 8000), timeMs, memoryKb: null });
      }
      return { runner: this.kind, compileOutput: null, compileError: false, cases };
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }
}
