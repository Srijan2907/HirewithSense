import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LanguageId } from '@hws/shared';
import { env } from '../../config/env.js';
import { LANGUAGE_SPECS, clip, outputsMatch, type CodeRunner, type RawCaseResult, type RunRequest, type RunResult } from './types.js';

/**
 * Runs each submission in a single ephemeral container: compile once, then run every test case with
 * its own `timeout`. The container has no network, a hard memory cap, a pids limit, dropped
 * capabilities and a read-only root filesystem; only the per-run work directory is writable.
 */
export class DockerRunner implements CodeRunner {
  readonly kind = 'docker';
  private available: Map<string, boolean> | null = null;

  async availableLanguages(): Promise<LanguageId[]> {
    if (!this.available) {
      this.available = new Map();
      const images = [...new Set(Object.values(LANGUAGE_SPECS).map((s) => s.image))];
      await Promise.all(
        images.map(async (img) => {
          const r = await exec(env().DOCKER_BIN, ['image', 'inspect', img], { timeoutMs: 10_000 });
          this.available!.set(img, r.code === 0);
        }),
      );
    }
    return (Object.keys(LANGUAGE_SPECS) as LanguageId[]).filter((id) => this.available!.get(LANGUAGE_SPECS[id].image));
  }

  /** Force a re-check (e.g. after pulling images). */
  invalidate() {
    this.available = null;
  }

  async run(req: RunRequest): Promise<RunResult> {
    const spec = LANGUAGE_SPECS[req.languageId];
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'hws-run-'));
    const name = `hws-${randomUUID().slice(0, 12)}`;
    try {
      await fs.writeFile(path.join(work, spec.file), req.sourceCode, 'utf8');
      await Promise.all(req.cases.map((c, i) => fs.writeFile(path.join(work, `in_${i}`), c.input, 'utf8')));

      const memMb = req.memoryLimitMb + spec.memoryOverheadMb;
      const perCaseSec = Math.max(1, Math.ceil((req.timeLimitMs * spec.timeFactor) / 1000));
      const runCmd = spec.run.replace('{mem}', String(req.memoryLimitMb));
      const script = harness({ compile: spec.compile, run: runCmd, count: req.cases.length, perCaseSec });
      await fs.writeFile(path.join(work, 'harness.sh'), script, { mode: 0o755 });
      await fs.chmod(work, 0o777);

      const totalSec = 30 + req.cases.length * (perCaseSec + 1);
      const args = [
        'run', '--rm', '--name', name,
        '--network', 'none',
        '--memory', `${memMb}m`, '--memory-swap', `${memMb}m`,
        '--cpus', '1', '--pids-limit', '128',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--read-only', '--tmpfs', '/tmp:rw,exec,size=256m',
        '-v', `${work}:/work:rw`, '-w', '/work',
        '-e', 'HOME=/tmp',
        '--user', '1000:1000',
        spec.image, 'sh', '/work/harness.sh',
      ];
      const r = await exec(env().DOCKER_BIN, args, { timeoutMs: totalSec * 1000, onTimeout: () => exec(env().DOCKER_BIN, ['kill', name], { timeoutMs: 5000 }) });
      if (r.timedOut) {
        return { runner: this.kind, compileOutput: null, compileError: false, cases: req.cases.map(() => ({ verdict: 'time_limit', stdout: '', stderr: 'Execution exceeded the overall time budget', timeMs: null, memoryKb: null })) };
      }
      if (r.code !== 0 && !(await exists(path.join(work, 'compile_status')))) {
        return { runner: this.kind, compileOutput: null, compileError: false, cases: [], error: `Sandbox failed to start (exit ${r.code}): ${clip(r.stderr, 2000)}` };
      }

      const compileStatus = (await readOr(path.join(work, 'compile_status'), '0')).trim();
      const compileOutput = clip((await readOr(path.join(work, 'compile_out'), '')).trim(), 8000) || null;
      if (compileStatus !== '0') {
        return { runner: this.kind, compileOutput: compileOutput ?? 'Compilation failed', compileError: true, cases: [] };
      }

      const cases: RawCaseResult[] = [];
      for (let i = 0; i < req.cases.length; i++) {
        const code = Number((await readOr(path.join(work, `code_${i}`), '255')).trim());
        const stdout = clip(await readOr(path.join(work, `out_${i}`), ''));
        const stderr = clip(await readOr(path.join(work, `err_${i}`), ''), 8000);
        const timeMs = Number((await readOr(path.join(work, `time_${i}`), '')).trim());
        const elapsed = Number.isFinite(timeMs) ? timeMs : null;
        let verdict: RawCaseResult['verdict'];
        if (code === 137 || code === 124) verdict = elapsed !== null && elapsed < perCaseSec * 1000 - 50 ? 'memory_limit' : 'time_limit';
        else if (code !== 0) verdict = 'runtime_error';
        else verdict = outputsMatch(stdout, req.cases[i]!.expectedOutput) ? 'passed' : 'wrong_answer';
        cases.push({ verdict, stdout, stderr, timeMs: elapsed, memoryKb: null });
      }
      return { runner: this.kind, compileOutput, compileError: false, cases };
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function harness(o: { compile?: string; run: string; count: number; perCaseSec: number }): string {
  const lines = [
    '#!/bin/sh',
    'cd /work',
    'now_ms() { read up _ < /proc/uptime; echo "${up%.*}${up#*.}0"; }',
    o.compile ? `${o.compile} > compile_out 2>&1; echo $? > compile_status` : 'echo 0 > compile_status; : > compile_out',
    'if [ "$(cat compile_status)" != "0" ]; then exit 0; fi',
    `i=0; while [ $i -lt ${o.count} ]; do`,
    '  s=$(now_ms)',
    `  timeout -s KILL ${o.perCaseSec} ${o.run} < in_$i > out_$i 2> err_$i`,
    '  echo $? > code_$i',
    '  e=$(now_ms); echo $((e - s)) > time_$i',
    '  i=$((i + 1))',
    'done',
    'exit 0',
  ];
  return lines.join('\n') + '\n';
}

async function readOr(p: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return fallback;
  }
}
async function exists(p: string) {
  return fs.access(p).then(() => true, () => false);
}

export function exec(cmd: string, args: string[], opts: { timeoutMs: number; input?: string; onTimeout?: () => unknown }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void opts.onTimeout?.();
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stdout.on('data', (d) => (stdout.length < 1_000_000 ? (stdout += d) : null));
    child.stderr.on('data', (d) => (stderr.length < 1_000_000 ? (stderr += d) : null));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}
