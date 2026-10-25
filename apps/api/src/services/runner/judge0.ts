import type { LanguageId } from '@hws/shared';
import { env } from '../../config/env.js';
import { sleep } from '../../lib/util.js';
import { LANGUAGE_SPECS, clip, outputsMatch, type CodeRunner, type RawCaseResult, type RunRequest, type RunResult } from './types.js';

/** Judge0 CE / Extra CE adapter using batch submissions with base64 payloads. */
export class Judge0Runner implements CodeRunner {
  readonly kind = 'judge0';
  private languages: Set<number> | null = null;

  private headers(): Record<string, string> {
    const e = env();
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (e.JUDGE0_API_KEY) h['X-RapidAPI-Key'] = e.JUDGE0_API_KEY;
    if (e.JUDGE0_API_HOST) h['X-RapidAPI-Host'] = e.JUDGE0_API_HOST;
    if (e.JUDGE0_AUTH_TOKEN) h['X-Auth-Token'] = e.JUDGE0_AUTH_TOKEN;
    return h;
  }
  private base() {
    return (env().JUDGE0_URL ?? '').replace(/\/$/, '');
  }

  async availableLanguages(): Promise<LanguageId[]> {
    if (!this.base()) return [];
    if (!this.languages) {
      try {
        const res = await fetch(`${this.base()}/languages`, { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
        const list = (await res.json()) as { id: number }[];
        this.languages = new Set(list.map((l) => l.id));
      } catch {
        this.languages = new Set(Object.values(LANGUAGE_SPECS).map((s) => s.judge0Id));
      }
    }
    return (Object.keys(LANGUAGE_SPECS) as LanguageId[]).filter((id) => this.languages!.has(LANGUAGE_SPECS[id].judge0Id));
  }

  async run(req: RunRequest): Promise<RunResult> {
    const spec = LANGUAGE_SPECS[req.languageId];
    const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
    const cpu = Math.min(15, Math.max(1, (req.timeLimitMs * spec.timeFactor) / 1000));
    const submissions = req.cases.map((c) => ({
      language_id: spec.judge0Id,
      source_code: b64(req.sourceCode),
      stdin: b64(c.input),
      cpu_time_limit: cpu,
      wall_time_limit: Math.min(20, cpu * 2 + 2),
      memory_limit: Math.min(256_000, (req.memoryLimitMb + spec.memoryOverheadMb) * 1024),
      enable_network: false,
    }));
    const create = await fetch(`${this.base()}/submissions/batch?base64_encoded=true`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ submissions }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!create.ok) return { runner: this.kind, compileOutput: null, compileError: false, cases: [], error: `Judge0 batch submission failed (${create.status})` };
    const tokens = ((await create.json()) as { token: string }[]).map((t) => t.token);

    const fields = 'token,status,stdout,stderr,compile_output,time,memory,message';
    let results: any[] = [];
    for (let i = 0; i < 40; i++) {
      await sleep(i < 5 ? 700 : 1500);
      const poll = await fetch(`${this.base()}/submissions/batch?tokens=${tokens.join(',')}&base64_encoded=true&fields=${fields}`, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
      if (!poll.ok) continue;
      results = ((await poll.json()) as { submissions: any[] }).submissions;
      if (results.every((r) => r.status?.id > 2)) break;
    }
    const dec = (s: string | null) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');
    const first = results[0];
    if (first && first.status?.id === 6) {
      return { runner: this.kind, compileOutput: clip(dec(first.compile_output), 8000) || 'Compilation failed', compileError: true, cases: [] };
    }
    const cases: RawCaseResult[] = results.map((r, i) => {
      const stdout = clip(dec(r.stdout));
      const stderr = clip(dec(r.stderr) || dec(r.message), 8000);
      const id: number = r.status?.id ?? 13;
      let verdict: RawCaseResult['verdict'];
      if (id <= 2) verdict = 'internal_error';
      else if (id === 5) verdict = 'time_limit';
      else if (id === 6) verdict = 'compile_error';
      else if (id >= 7 && id <= 12) verdict = 'runtime_error';
      else if (id >= 13) verdict = 'internal_error';
      else verdict = outputsMatch(stdout, req.cases[i]!.expectedOutput) ? 'passed' : 'wrong_answer';
      return { verdict, stdout, stderr, timeMs: r.time ? Math.round(Number(r.time) * 1000) : null, memoryKb: r.memory ?? null };
    });
    return { runner: this.kind, compileOutput: null, compileError: false, cases };
  }
}
