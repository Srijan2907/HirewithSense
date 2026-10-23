# HireWithSenseAI Backend

MVP backend for a MERN AI interview platform. Includes JWT auth, User/Admin roles,
resume upload and parsing, job roles and weighted rubrics, interview sessions capped
at 30 minutes, transcript/answer storage, AI-generated questions and reports, Judge0
code execution, admin rankings, and API tests.

## Requirements
- Node.js 20+
- MongoDB local or Atlas
- Optional Qwen-compatible API credentials for live AI text features
- Optional Judge0-compatible API credentials for real code execution

## Install
```bash
cp .env.example .env
npm install
# edit .env and set MONGO_URL and JWT_SECRET
npm run dev
```
Health check: `GET http://localhost:4000/api/health`

## Create first admin
Set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env`, then run:
```bash
node scripts/seedAdmin.js
```
Public registration always creates a `user`, never an admin.

## Main API routes
All routes are prefixed `/api`. Send `Authorization: Bearer <token>` to protected routes.

### Auth
- `POST /auth/register` `{name, username, email, password}`
- `POST /auth/login` `{email, password}`
- `POST /auth/forgot-password` `{email}` sends a one-time reset link without revealing whether the email is registered.
- `POST /auth/reset-password` `{token, password}` consumes the reset link; tokens expire after 30 minutes.
- `GET /auth/me`

Password reset emails use SMTP. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `PASSWORD_RESET_URL` in `.env`. The reset token is stored only as a SHA-256 hash, can be used once, and resetting the password revokes existing JWT sessions.

### Profile and resume
- `GET /users/me`
- `PATCH /users/me` `{name, username}`
- `POST /resumes` multipart form field `resume` (PDF or DOCX, max 5MB)
- `GET /resumes/me`
- `POST /resumes/me/parse` parses latest uploaded resume via Qwen if configured, otherwise returns conservative text-based extraction.

### Jobs and questions (Admin)
- `POST /jobs` `{title, description, skills, interviewTypes, durationMinutes, rubric, minimumScore}`
- `GET /jobs` (authenticated; users see active jobs, admins see all)
- `GET /jobs/:id`
- `PATCH /jobs/:id`
- `POST /jobs/:id/questions` `{type, prompt, expectedSignals, difficulty, order}`
- `GET /jobs/:id/questions`
- `POST /jobs/:id/assignments` `{userId, interviewType}`

Rubric example:
```json
{
  "technicalKnowledge": 25,
  "problemSolving": 25,
  "communication": 15,
  "projectDepth": 15,
  "codingCorrectness": 20
}
```
Weights must total 100. For an oral-only role, use codingCorrectness: 0 and adjust other weights.

### Interviews
- `GET /interviews/mine`
- `POST /interviews/:id/start` candidate starts an assigned interview
- `POST /interviews/:id/answers` `{questionId, answer, transcriptChunk?}`
- `POST /interviews/:id/next-question` `{lastAnswer?}` generates next AI question if configured, otherwise uses configured question bank.
- `POST /interviews/:id/transcript` `{speaker, text, timestamp?}` appends a transcript segment
- `POST /interviews/:id/finish` closes session and generates report
- `GET /interviews/:id` candidate's own session or admin
- `GET /interviews/:id/report`

### Coding
- `GET /coding/problems` authenticated
- `POST /coding/problems` Admin `{title, statement, difficulty, languageIds, starterCode, testCases, expectedSignals}`
- `POST /interviews/:id/code/submit` `{problemId, languageId, sourceCode}`
- `POST /interviews/:id/code/follow-up` `{submissionId}` asks AI for code follow-up questions

Judge0 language IDs are provider-specific. Common Judge0 CE IDs include JavaScript (Node.js) 63, Python 3 71, C++ 17 54, but verify against your chosen instance. Never expose hidden test inputs in a public endpoint.

### Admin reports
- `GET /admin/dashboard`
- `GET /admin/interviews?jobId=&status=`
- `GET /admin/interviews/:id/transcript`
- `GET /admin/jobs/:jobId/rankings`

### AI / voice setup
- `POST /ai/interviews/:id/question` generates an interviewer question from the candidate's parsed resume and role.
- `POST /ai/interviews/:id/evaluate` evaluates a supplied answer.
- `POST /voice/session-config` returns non-secret browser connection configuration and a readiness flag.
- `POST /interviews/:id/voice/session-config` allocates temporary Qwen AOQ credentials for the authenticated candidate's active interview. The permanent API key stays on the server.

Provider roles: OpenAI handles interviewer questions, answer evaluation, final reports, and coding follow-ups; Gemini Flash parses resumes; Qwen LiveTranslate handles realtime voice. Configure `OPENAI_API_KEY` and `OPENAI_MODEL`, `GEMINI_API_KEY` and `GEMINI_RESUME_MODEL`, plus `QWEN_API_KEY`, `QWEN_WORKSPACE_ID`, and `QWEN_REGION` (`singapore` or `beijing`).

The frontend should use the returned temporary AOQ credentials with Alibaba Cloud's AOQ client SDK, wait for `session.updated` before sending microphone audio, then append recognized/interviewer text to `/interviews/:id/transcript`. Stop audio capture at `endsAt` and finish the interview. Never send provider API keys to the browser.

## Security notes
- JWT secret must be long and private.
- CORS is restricted to CLIENT_ORIGIN.
- Passwords are bcrypt-hashed; admin signup is not public.
- Resume files are stored locally under `uploads/` for development. Use private object storage and malware scanning for production.
- Candidate code is sent to Judge0, never run inside this API process.
- AI scores are advisory. Human review should be required before hiring decisions.
- Add HTTPS, refresh-token rotation, account recovery, retention policies and monitoring before production use.

## Test
```bash
npm test
```
Tests cover rubric validation, interview duration caps and role access helper behavior without requiring MongoDB.
