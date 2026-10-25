# AI, evaluation and scoring

This page explains what the model is asked to do, what it is deliberately not asked to do, how a
report's numbers are computed, and how to plug in a provider.

## Design principles

1. **The model never decides.** It asks questions, scores individual answers, and drafts the
   report. A recruiter records the outcome. The recommendation field exists to summarise the
   evidence, and the UI says so wherever it appears.
2. **Scores need evidence.** A competency is only scored when the model can quote something the
   candidate said or wrote. Without a quote the competency is marked "not assessed" and carries no
   weight in the overall score. Unassessed weight is reported as reduced coverage rather than
   silently imputed.
3. **Coding is graded by tests, not by the model.** The `coding_correctness` competency is computed
   from test results. The model may comment on the code but cannot change that number.
4. **Only job-related content is evaluated.** Prompts carry an explicit fairness instruction, names
   and contact details are redacted before text reaches a scoring prompt, and the voice path turns
   speech into text before anything is evaluated, so accent, fluency and appearance never reach the
   model.
5. **Candidate text is data, not instructions.** Resume text, answers and code are wrapped in
   `<untrusted>` tags and the system prompt tells the model to ignore any instructions inside them.
   Model output is validated against a schema and retried once with the validation error if it does
   not conform. Wrapper tags are stripped from quotes before they are stored.

## The tasks

| Task | Model | Input | Output |
| --- | --- | --- | --- |
| Resume parsing | `AI_MODEL` | Extracted resume text | Structured profile: summary, skills, experience, projects, education |
| Question generation | `AI_MODEL`, streamed | Job, target competency, redacted resume, previous questions, last answer | One question, 1–3 sentences |
| Answer evaluation | `AI_MODEL` | Question, answer, competency and its anchors, expected signals from the question bank | Score 0–10, feedback, strengths, gaps, confidence |
| Report | `AI_REASONING_MODEL` if set, else `AI_MODEL` | Whole interview: every turn with its evaluation, best submission per problem with test results | Per-competency score, level, confidence, rationale, evidence quotes; summary; strengths; considerations |
| Code review | `AI_MODEL` | Problem, code, test summary | Feedback and up to three follow-up questions |

Question generation chooses the target competency on the server, not in the model: among
competencies with weight (excluding coding correctness) it picks the one with the lowest ratio of
questions asked to weight, so a 30 % competency gets roughly twice the attention of a 15 % one.
Bank questions are asked first, in their configured order; generated questions fill the rest of the
section's budget and may follow up on the previous answer.

## How a report is computed

For each competency `c` with weight `w_c` the model (or the test runner, for coding) yields a
score `s_c` in 0–100 or `null`.

- **Weighted score** = Σ `s_c · w_c` / Σ `w_c` over assessed competencies only.
- **Coverage** = Σ `w_c` (assessed) / Σ `w_c` (all).
- **Level** maps the score to a 1–5 anchor: ≥85 → 5, ≥70 → 4, ≥55 → 3, ≥40 → 2, else 1.
- **Coding score** = weighted share of passed test cases across all problems in the plan, using the
  best graded submission per problem. Unattempted problems count as zero so skipping a problem is
  not rewarded.
- **Recommendation**: `insufficient_evidence` when there is no score or coverage is below 50 %;
  otherwise `strong_hire` at or above max(minimum + 15, 85), `hire` at or above the job's minimum,
  `borderline` within 10 points below it, else `no_hire`.
- **Meets minimum**: weighted score ≥ the job's `minimumScore`, or `null` when unscored.

These functions live in `packages/shared/src/scoring.ts` and are unit tested; the web app uses the
same code for any client-side display.

The report also records which provider and model produced it, how much evidence it saw (turns,
answered turns, submissions, transcript characters), and an **integrity summary** computed from
interface telemetry. Integrity is stored and shown separately and never feeds the score.

## Decisions and overrides

A decision (`advance`, `hold`, `reject`, `hire`) always needs a written reason. When the report has a
definite recommendation and the decision points the other way, the decision is flagged as an
override so reviewers can find them later. An `insufficient_evidence` recommendation is not a
verdict, so nothing can override it.

## Providers

The API talks to models through the OpenAI chat-completions protocol, which almost every provider
now exposes. Set `AI_PROVIDER=openai_compatible`, an `AI_API_KEY`, a model name, and for anything
other than OpenAI a base URL:

| Provider | `AI_BASE_URL` | Example model |
| --- | --- | --- |
| OpenAI | leave empty | `gpt-4.1-mini` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash` |
| Alibaba DashScope (Qwen) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1` |

The provider must support JSON-mode responses (`response_format: json_object`) for the structured
tasks and streaming for question generation. All of the above do. Server-side speech features use
OpenAI's audio endpoints and are enabled with `AI_ENABLE_AUDIO=true`; the web app otherwise relies
on the browser's own speech recognition and synthesis, which costs nothing and keeps audio on the
candidate's device.

### The offline provider

With `AI_PROVIDER=mock` (the default) a deterministic provider stands in for the model. It
generates reasonable questions from the job and resume, scores answers with simple heuristics
(length, structure words, overlap with the question's expected signals), and assembles a report of
the same shape as a real one. Every piece of output says it was produced offline. It exists so the
product can be developed, demonstrated and tested without credentials; it is not an assessment.

## Adapting the prompts

Prompts are plain strings in `apps/api/src/services/ai/tasks.ts`. If you change the output format
of a task, change the matching Zod schema (`ResumeProfile`, `TurnEvaluation`, `ModelReport`,
`CodeReview`) in the same change; validation is what keeps a misbehaving model from corrupting
stored data. Keep the fairness paragraph in every scoring prompt.
