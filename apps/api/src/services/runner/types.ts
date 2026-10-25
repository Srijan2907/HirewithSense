import type { LanguageId, Verdict } from '@hws/shared';

export interface RunCase {
  input: string;
  expectedOutput: string;
}

export interface RunRequest {
  languageId: LanguageId;
  sourceCode: string;
  cases: RunCase[];
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface RawCaseResult {
  verdict: Verdict;
  stdout: string;
  stderr: string;
  timeMs: number | null;
  memoryKb: number | null;
}

export interface RunResult {
  runner: string;
  compileOutput: string | null;
  /** When compile fails, `cases` is empty and verdict is reported here. */
  compileError: boolean;
  cases: RawCaseResult[];
  error?: string;
}

export interface CodeRunner {
  readonly kind: string;
  /** Languages this runner can execute right now. */
  availableLanguages(): Promise<LanguageId[]>;
  run(req: RunRequest): Promise<RunResult>;
}

export interface LanguageSpec {
  id: LanguageId;
  file: string;
  image: string;
  compile?: string;
  run: string;
  judge0Id: number;
  /** Multiplier applied to time limits (JIT/VM warm-up). */
  timeFactor: number;
  /** Extra memory (MB) for runtimes with a large baseline. */
  memoryOverheadMb: number;
  local?: { cmd: string[] };
}

export const LANGUAGE_SPECS: Record<LanguageId, LanguageSpec> = {
  javascript: { id: 'javascript', file: 'main.js', image: 'node:24-alpine', run: 'node --max-old-space-size={mem} main.js', judge0Id: 63, timeFactor: 1.5, memoryOverheadMb: 64, local: { cmd: ['node', 'main.js'] } },
  typescript: { id: 'typescript', file: 'main.ts', image: 'node:24-alpine', run: 'node --max-old-space-size={mem} main.ts', judge0Id: 74, timeFactor: 1.5, memoryOverheadMb: 64, local: { cmd: ['node', 'main.ts'] } },
  python: { id: 'python', file: 'main.py', image: 'python:3.12-alpine', run: 'python3 main.py', judge0Id: 71, timeFactor: 3, memoryOverheadMb: 32, local: { cmd: ['python3', 'main.py'] } },
  cpp: { id: 'cpp', file: 'main.cpp', image: 'gcc:14', compile: 'g++ -O2 -std=c++17 -o main main.cpp', run: './main', judge0Id: 54, timeFactor: 1, memoryOverheadMb: 0 },
  c: { id: 'c', file: 'main.c', image: 'gcc:14', compile: 'gcc -O2 -std=c17 -o main main.c -lm', run: './main', judge0Id: 50, timeFactor: 1, memoryOverheadMb: 0 },
  java: { id: 'java', file: 'Main.java', image: 'eclipse-temurin:21-jdk-alpine', compile: 'javac Main.java', run: 'java -Xmx{mem}m -Xss64m Main', judge0Id: 62, timeFactor: 2, memoryOverheadMb: 128 },
  go: { id: 'go', file: 'main.go', image: 'golang:1.23-alpine', compile: 'GOCACHE=/tmp/gocache GOPATH=/tmp/go GOFLAGS=-mod=mod go build -o main main.go', run: './main', judge0Id: 60, timeFactor: 1, memoryOverheadMb: 16 },
  rust: { id: 'rust', file: 'main.rs', image: 'rust:1-alpine', compile: 'rustc -O -o main main.rs', run: './main', judge0Id: 73, timeFactor: 1, memoryOverheadMb: 0 },
};

/** Normalise program output for comparison: trailing whitespace per line and trailing blank lines are ignored. */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

export function outputsMatch(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

export const clip = (s: string, max = 20_000) => (s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s);
