import { afterEach, describe, expect, it, vi } from 'vitest';
import { Judge0Runner } from './judge0.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('Judge0Runner', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits a batch and maps statuses to verdicts', async () => {
    process.env.JUDGE0_URL = 'https://judge.example';
    const { loadEnv } = await import('../../config/env.js');
    loadEnv();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/submissions/batch?base64_encoded=true')) {
        const body = JSON.parse(String(init!.body));
        expect(body.submissions).toHaveLength(3);
        expect(body.submissions[0].language_id).toBe(71);
        return new Response(JSON.stringify([{ token: 't1' }, { token: 't2' }, { token: 't3' }]), { status: 201 });
      }
      return new Response(
        JSON.stringify({
          submissions: [
            { token: 't1', status: { id: 3 }, stdout: b64('42\n'), stderr: null, time: '0.01', memory: 3000 },
            { token: 't2', status: { id: 4 }, stdout: b64('41\n'), stderr: null, time: '0.01', memory: 3000 },
            { token: 't3', status: { id: 5 }, stdout: null, stderr: null, time: '2.0', memory: 3000 },
          ],
        }),
        { status: 200 },
      );
    }));
    const runner = new Judge0Runner();
    const res = await runner.run({ languageId: 'python', sourceCode: 'print(42)', cases: [{ input: '', expectedOutput: '42' }, { input: '', expectedOutput: '42' }, { input: '', expectedOutput: '' }], timeLimitMs: 1000, memoryLimitMb: 128 });
    expect(res.cases.map((c) => c.verdict)).toEqual(['passed', 'wrong_answer', 'time_limit']);
    expect(res.cases[0]!.timeMs).toBe(10);
    expect(calls[0]).toMatch(/POST .*\/submissions\/batch/);
  });

  it('reports compile errors', async () => {
    process.env.JUDGE0_URL = 'https://judge.example';
    const { loadEnv } = await import('../../config/env.js');
    loadEnv();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('base64_encoded=true') && !url.includes('tokens=')) return new Response(JSON.stringify([{ token: 'a' }]), { status: 201 });
      return new Response(JSON.stringify({ submissions: [{ token: 'a', status: { id: 6 }, compile_output: b64('main.cpp:1: error: expected'), stdout: null }] }), { status: 200 });
    }));
    const res = await new Judge0Runner().run({ languageId: 'cpp', sourceCode: 'int main( {}', cases: [{ input: '', expectedOutput: '' }], timeLimitMs: 1000, memoryLimitMb: 128 });
    expect(res.compileError).toBe(true);
    expect(res.compileOutput).toContain('error');
  });
});
