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
- `GET /auth/me`

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

**Voice note:** this backend provides the session configuration boundary and transcript ingestion. Real-time Qwen audio streaming protocols/model identifiers can differ by region and API release. Do not expose the provider API key to the browser. Implement the official WebSocket/realtime handshake in a server-side adapter after confirming the exact model ID and protocol in your Alibaba Cloud console/docs. For the demo, browser speech APIs can supply audio/transcript events to the transcript endpoint while the Qwen adapter is finalized.

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
