# Code execution

The coding section runs candidate code against test cases. This document describes the runner
abstraction, the sandbox, how grading works and how to add a language.

## The abstraction

`apps/api/src/services/runner/types.ts` defines a `CodeRunner` with two methods: report which
languages are executable right now, and run one source file against a list of inputs with time and
memory limits. Three implementations exist and are selected with `CODE_RUNNER`:

| Runner | When to use | Isolation |
| --- | --- | --- |
| `docker` | API host runs Docker | Ephemeral container per submission |
| `judge0` | Hosted deployments, no Docker on the API host | Judge0's own sandbox |
| `local` | Development without Docker | **None.** Refused in production |
| `none` | IDE not needed | No execution |

`gradeSubmission()` in `runner/index.ts` wraps whichever runner is active: it checks language
availability, bounds concurrency (`RUNNER_MAX_CONCURRENCY`), runs the cases, computes verdicts and
the weighted score, and produces results in which hidden cases carry no input, expected output or
program output. Recruiters get the unredacted results; candidates get the redacted ones.

## Verdicts

Each case ends with one of `passed`, `wrong_answer`, `time_limit`, `memory_limit`, `runtime_error`,
`compile_error`, `internal_error`. Output comparison ignores trailing whitespace on each line and
trailing blank lines, and normalises Windows line endings; it is otherwise exact. Leading
whitespace and the order of lines matter.

The weighted score of a submission is the sum of the weights of passed cases divided by the total
weight, scaled to 0–100. Sample cases usually carry weight 1 and hidden cases more.

## The Docker sandbox

For each submission the runner writes the source and all inputs to a temporary directory, then
starts one container:

```
docker run --rm --network none \
  --memory <limit> --memory-swap <limit> --cpus 1 --pids-limit 128 \
  --cap-drop ALL --security-opt no-new-privileges \
  --read-only --tmpfs /tmp:rw,exec,size=256m \
  --user 1000:1000 -v <workdir>:/work:rw -w /work <image> sh /work/harness.sh
```

The harness compiles once (for compiled languages), then runs each case with `timeout -s KILL`
and records exit code, wall time (from `/proc/uptime`, so it works on BusyBox images), stdout and
stderr to files. The runner reads those files back and maps them to verdicts: exit 137 within the
time budget is treated as a memory kill, exit 137 at the budget as a time limit, any other non-zero
exit as a runtime error. A watchdog kills the whole container if it exceeds the overall budget.

Per-language multipliers account for runtime start-up (Python ×3, Node ×1.5, JVM ×2) and memory
baselines (JVM +128 MB, Node +64 MB). Problems configure the base limits (`timeLimitMs`,
`memoryLimitMb`).

The runner checks `docker image inspect` for each language image once and caches the result; pull
new images with `scripts/pull-sandbox-images.sh` and restart the API.

## Judge0

The Judge0 adapter uses the batch endpoints with base64 payloads, one Judge0 submission per test
case, and polls until every status id is above 2. It fetches `/languages` once to learn which ids
the instance supports and falls back to the standard CE ids. Status ids map as follows: 3 passed,
4 wrong answer (we compare outputs ourselves rather than trusting Judge0's comparison), 5 time
limit, 6 compile error, 7–12 runtime errors, 13+ internal errors.

## Supported languages

| Id | Image | Judge0 id |
| --- | --- | --- |
| `javascript` | `node:24-alpine` | 63 |
| `typescript` | `node:24-alpine` (native type stripping) | 74 |
| `python` | `python:3.12-alpine` | 71 |
| `cpp` | `gcc:14` | 54 |
| `c` | `gcc:14` | 50 |
| `java` | `eclipse-temurin:21-jdk-alpine` (class `Main`) | 62 |
| `go` | `golang:1.23-alpine` | 60 |
| `rust` | `rust:1-alpine` | 73 |

Programs read from standard input and write to standard output, like a judge.

## Adding a language

1. Add the id, label, Monaco language and file extension to `LANGUAGES` in
   `packages/shared/src/enums.ts`.
2. Add a `LanguageSpec` to `LANGUAGE_SPECS` in `apps/api/src/services/runner/types.ts`: file name,
   image, compile and run commands, Judge0 id, time factor, memory overhead, and a `local` command
   if the unsafe runner should support it.
3. Add a starter snippet in `apps/web/src/features/coding/starter.ts` so the editor is not empty.
4. Pull the image on each runner host.

## Security notes

- The sandbox has no network. A problem that needs network access is a problem that should not be
  auto-graded.
- The work directory is the only writable mount and is deleted after the run.
- Source code is capped at 60 KB and output at 20 KB per stream; anything beyond is truncated so a
  pathological program cannot fill the database.
- Giving the API container access to the Docker socket makes it a privileged component. Keep it on
  a host that runs nothing else sensitive, or use Judge0.
