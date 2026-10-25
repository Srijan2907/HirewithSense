import { describe, expect, it } from 'vitest';
import { DockerRunner } from '../src/services/runner/docker.js';

const enabled = process.env.TEST_CODE_RUNNER === 'docker';

describe.skipIf(!enabled)('DockerRunner', () => {
  const runner = new DockerRunner();

  it('lists available languages', async () => {
    const langs = await runner.availableLanguages();
    expect(langs).toContain('javascript');
    expect(langs).toContain('python');
  });

  it('runs javascript with passing, wrong and timeout cases', async () => {
    const res = await runner.run({
      languageId: 'javascript',
      sourceCode: "const s=require('fs').readFileSync(0,'utf8').trim(); if(s==='loop'){for(;;){}} console.log(Number(s)*2);",
      cases: [
        { input: '21\n', expectedOutput: '42\n' },
        { input: '5\n', expectedOutput: '11\n' },
        { input: 'loop\n', expectedOutput: '0\n' },
      ],
      timeLimitMs: 1000,
      memoryLimitMb: 128,
    });
    expect(res.compileError).toBe(false);
    expect(res.cases.map((c) => c.verdict)).toEqual(['passed', 'wrong_answer', 'time_limit']);
    expect(res.cases[0]!.timeMs).not.toBeNull();
  }, 60_000);

  it('reports compile errors for c++ and runs a correct program', async () => {
    const bad = await runner.run({ languageId: 'cpp', sourceCode: 'int main( { return 0; }', cases: [{ input: '', expectedOutput: '' }], timeLimitMs: 1000, memoryLimitMb: 128 });
    expect(bad.compileError).toBe(true);
    expect(bad.compileOutput).toMatch(/error/);
    const good = await runner.run({ languageId: 'cpp', sourceCode: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;}', cases: [{ input: '2 3', expectedOutput: '5' }], timeLimitMs: 1000, memoryLimitMb: 128 });
    expect(good.cases[0]!.verdict).toBe('passed');
  }, 120_000);

  it('runs python and detects runtime errors', async () => {
    const res = await runner.run({ languageId: 'python', sourceCode: 'import sys\nx=sys.stdin.read().strip()\nprint(1//int(x))', cases: [{ input: '1', expectedOutput: '1' }, { input: '0', expectedOutput: '0' }], timeLimitMs: 1000, memoryLimitMb: 128 });
    expect(res.cases.map((c) => c.verdict)).toEqual(['passed', 'runtime_error']);
    expect(res.cases[1]!.stderr).toContain('ZeroDivisionError');
  }, 60_000);

  it('has no network access inside the sandbox', async () => {
    const res = await runner.run({ languageId: 'python', sourceCode: "import socket\ntry:\n  socket.create_connection(('1.1.1.1',53),timeout=2)\n  print('online')\nexcept Exception as e:\n  print('offline')", cases: [{ input: '', expectedOutput: 'offline' }], timeLimitMs: 4000, memoryLimitMb: 128 });
    expect(res.cases[0]!.verdict).toBe('passed');
  }, 60_000);
});
