# API reference

The authoritative, always-current reference is the OpenAPI document the API serves at `/docs`
(Swagger UI) and `/docs/json`. It is generated from the Zod schemas, so it cannot drift from the
code. This page explains the parts that an OpenAPI listing does not: the authentication model, the
conventions, the interview state machine, and the streaming protocol.

All routes are prefixed with `/api/v1`.

## Conventions

- Success responses return the resource directly; there is no `{ success: true }` wrapper.
- Errors return `{ error: { code, message, details?, requestId } }` with an appropriate HTTP status.
  Codes are stable strings (`validation_error`, `unauthorized`, `forbidden`, `not_found`, `conflict`,
  `gone`, `locked`, `rate_limited`, `service_unavailable`, `internal_error`). `details` on a
  validation error is a list of `{ path, message }`.
- Lists are paginated as `{ items, total, page, pageSize }` with `page` and `pageSize` query
  parameters (max 100).
- Every response carries an `x-request-id` header; send one yourself to correlate logs.
- Timestamps are ISO 8601 strings in UTC. Ids are UUIDs.

## Authentication

Sign-in returns a short-lived access token (JWT, 15 minutes by default) in the body and sets a
refresh token in an httpOnly cookie named `hws_refresh`, scoped to `/api/v1/auth`.

- Send `Authorization: Bearer <accessToken>` on every protected request.
- When the access token expires, call `POST /auth/refresh` with the cookie. The refresh token is
  rotated on every use; presenting an already-rotated token revokes the whole session family, which
  is how stolen tokens are caught.
- `POST /auth/logout` revokes the current refresh token; `POST /auth/logout-all` revokes every
  session and bumps the user's token version so existing access tokens stop working immediately.

Roles are `candidate`, `recruiter` and `superadmin`. Recruiters belong to exactly one organization
with an organization role of `owner`, `admin` or `member`. Routes under `/jobs`, `/invites/jobs`,
`/admin`, `/orgs/current` and the recruiter half of `/interviews` require an organization context;
mutations that affect other people (member roles, invitations, cancelling interviews, regenerating
reports) additionally require `owner` or `admin`.

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/register` | Candidate sign-up |
| `POST /auth/register/recruiter` | Recruiter sign-up; creates an organization and makes the user its owner |
| `POST /auth/login`, `/refresh`, `/logout`, `/logout-all` | Session lifecycle |
| `POST /auth/forgot-password`, `/reset-password` | Email-based reset, single use, 30-minute token |
| `POST /auth/verify-email`, `/resend-verification` | Email verification |
| `POST /auth/change-password` | Requires the current password; revokes other sessions |
| `GET /auth/me`, `GET /auth/sessions`, `DELETE /auth/sessions/:id` | Identity and device sessions |

Ten failed logins lock an account for fifteen minutes. Auth endpoints are rate limited to ten
requests per minute per IP.

## Organizations

`GET/PATCH /orgs/current`, `GET /orgs/members`, `PATCH/DELETE /orgs/members/:userId`,
`GET/POST /orgs/invites`, `DELETE /orgs/invites/:id`. Teammates join through an emailed token:
`GET /orgs/join/:token` previews the invitation and `POST /orgs/join` accepts it, creating an
account when the address is new.

## Jobs, questions and coding problems

A job carries its rubric (`competencies`, weights summing to 100) and its `interviewPlan` (an
ordered list of sections). Jobs start as `draft`; opening a job validates that every coding section
references problems of that job and that the `coding_correctness` competency has weight only when a
coding section exists.

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /jobs`, `GET/PATCH/DELETE /jobs/:id` | Job CRUD with pipeline stats on reads |
| `GET/POST /jobs/:id/questions`, `PATCH/DELETE /jobs/:id/questions/:qid` | Question bank |
| `GET/POST /jobs/:id/problems`, `PATCH/DELETE /jobs/:id/problems/:pid` | Coding problems with test cases |
| `GET /jobs/:id/rankings`, `GET /jobs/:id/rankings.csv` | Ranked candidates and a CSV export |

Problem reads for recruiters include full test cases. Candidates only ever receive cases marked
`isSample`.

## Invitations

| Endpoint | Purpose |
| --- | --- |
| `POST /invites/jobs/:jobId` | Invite one candidate by email |
| `POST /invites/jobs/:jobId/bulk` | Invite up to 200; returns created and failed lists |
| `GET /invites/jobs/:jobId` | Invitations for a job |
| `POST /invites/:id/resend`, `DELETE /invites/:id` | Resend with a fresh token, or withdraw |
| `GET /invites/:token` | Public preview (job, organization, sections, whether an account exists) |
| `POST /invites/accept` | Accept; creates the account if needed, creates the interview, signs the candidate in |

Accepting an invitation signs the candidate in because possessing the token proves control of the
invited mailbox. Tokens are random 256-bit values; only a SHA-256 hash is stored.

## Interviews

### State machine

```
ready ──(consent, start)──▶ in_progress ──(last section done | finish)──▶ submitted ──(report job)──▶ completed
                              │
                              └──(deadline passed; sweep job)──▶ expired ──(report job)──▶ completed
ready ──(window passed | recruiter cancels)──▶ expired | cancelled
```

Each interview snapshots the job's plan at creation, so editing the job later does not change a
running interview. Starting the interview activates section 0 and computes its deadline; completing
a section activates the next one. Writes to a section are accepted until its deadline plus the
plan's `graceSeconds`; after that the API answers `410 Gone` and the client is expected to call the
section-complete endpoint, which is always allowed. A sweep job runs every minute and closes
anything that overran.

### Candidate endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /interviews/mine` | The candidate's interviews (never includes scores) |
| `GET /interviews/:id` | Interview with sections, deadlines and the server time for clock-skew correction |
| `GET /interviews/disclosure` | Current AI-disclosure text and version |
| `POST /interviews/:id/consent` | Record consent; required before start; `409` if the version is stale |
| `POST /interviews/:id/start` | Start section 0 |
| `GET /interviews/:id/room` | Conversation state: turns so far and questions remaining |
| `POST /interviews/:id/next-question` | Server-sent events stream (see below) |
| `POST /interviews/:id/answers` | `{ turnId, answer, inputMode, answerDurationSeconds? }` |
| `POST /interviews/:id/skip` | Skip the open question |
| `POST /interviews/:id/transcript` | Append free text (used for spoken explanations of code) |
| `POST /interviews/:id/sections/:index/complete` | Finish the active section and move on |
| `POST /interviews/:id/finish` | End the interview early |
| `POST /interviews/:id/events` | Batched interface telemetry (focus, paste, full screen) |

### The question stream

`POST /interviews/:id/next-question` responds with `Content-Type: text/event-stream`. Each event is a
line `data: <json>` followed by a blank line. Event types:

- `{ "type": "token", "text": "…" }` while the interviewer's question is being generated;
- `{ "type": "question", "turn": CandidateTurnDto, "remaining": n }` once the turn is saved;
- `{ "type": "section_complete", "sectionIndex": i }` when the question budget is exhausted;
- `{ "type": "error", "message": "…" }` if generation failed after headers were sent.

Calling the endpoint while a question is still unanswered returns that question again without
creating a new turn, so a client that reconnects never loses its place. Questions from the job's
bank are asked before generated ones; generated questions target the competency with the least
coverage so far, weighted by rubric weight.

### Coding endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /coding/languages` | Languages and whether the runner can execute them right now |
| `GET /interviews/:id/coding` | Problems (sample cases only), drafts, submissions, allowed languages |
| `PUT /interviews/:id/coding/draft` | Autosave |
| `POST /interviews/:id/coding/run` | Run the sample cases (and an optional custom input) synchronously |
| `POST /interviews/:id/coding/submit` | Queue grading against all cases; returns `202` with the submission |
| `GET /interviews/:id/coding/submissions/:sid` | Poll until `status` is `graded` or `error` |
| `POST /interviews/:id/coding/submissions/:sid/review` | AI feedback plus follow-up questions |

Hidden cases come back with a verdict and timing only; `input`, `expectedOutput`, `stdout` and
`stderr` are `null` for candidates and populated for recruiters.

### Recruiter endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /interviews` | Filter by job, status, free text; sort by recency or score |
| `GET /interviews/:id/detail` | Everything: turns with evaluations, transcript, submissions with full results, telemetry, report, decision, consent record |
| `POST /interviews/:id/cancel`, `/force-finish` | Owner/admin controls |
| `GET /interviews/:id/report`, `POST /interviews/:id/report/regenerate` | Report access and regeneration |
| `PUT /interviews/:id/decision` | `{ decision: advance|hold|reject|hire, reason }`; flags when it contradicts a definite recommendation |

Reading a report or a detail page writes an audit entry.

## Resumes

`POST /resumes` (multipart field `resume`, PDF/DOCX/TXT, 5 MB), `GET /resumes/me`, `GET /resumes`,
`POST /resumes/:id/reparse`, `DELETE /resumes/:id`. Text is extracted synchronously; the structured
profile is produced by a background job and `parseStatus` moves through `pending`, `parsing`,
`parsed` or `failed`.

## Users

`GET/PATCH /users/me` for the profile and `POST /users/me/delete` for candidate-initiated erasure
(see [COMPLIANCE.md](COMPLIANCE.md)).

## AI and operations

| Endpoint | Purpose |
| --- | --- |
| `GET /ai/status` | Provider, model, enabled features, runner availability, email transport |
| `POST /ai/transcribe` | Multipart audio to text, when the provider supports audio |
| `POST /ai/speak` | Text to MP3, when the provider supports audio |
| `GET /admin/dashboard` | Pipeline statistics for the caller's organization |
| `GET /admin/audit` | Audit log, optionally filtered by `targetId` |
| `GET /admin/outbox` | Stored emails; development only unless superadmin |
| `GET /health/live`, `GET /health/ready` | Probes; readiness checks the database |
| `GET /metrics` | Prometheus exposition |

## Rate limits

Global limit of 300 requests per minute per IP (per user when signed in), with stricter limits on
authentication (10/min), code runs (20/min), submissions (10/min) and AI audio (30/min). Limited
responses are `429` with a `Retry-After`-style message in the body.
