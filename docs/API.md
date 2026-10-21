# API reference quick sheet

Use `Authorization: Bearer <JWT>` on protected endpoints. JSON body unless marked multipart.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Health |
| POST | `/api/auth/register` | Public | Candidate signup |
| POST | `/api/auth/login` | Public | Login |
| GET | `/api/auth/me` | Authenticated | Current identity |
| GET/PATCH | `/api/users/me` | Authenticated | Profile |
| POST | `/api/resumes` | User | Multipart `resume` upload |
| GET | `/api/resumes/me` | User | Latest resume metadata |
| POST | `/api/resumes/me/parse` | User | Parse latest resume |
| GET | `/api/jobs` | Authenticated | List active jobs (admin sees all) |
| POST | `/api/jobs` | Admin | Create job |
| PATCH | `/api/jobs/:id` | Admin | Update job |
| POST | `/api/jobs/:id/questions` | Admin | Add oral/coding question |
| GET | `/api/jobs/:id/questions` | Authenticated | List question prompts |
| POST | `/api/jobs/:id/assignments` | Admin | Assign interview |
| GET | `/api/interviews/mine` | User/Admin | Own interviews / all interviews for admin |
| POST | `/api/interviews/:id/start` | Owner | Start timed interview |
| POST | `/api/interviews/:id/answers` | Owner | Save and evaluate answer |
| POST | `/api/interviews/:id/next-question` | Owner | Get next question |
| POST | `/api/interviews/:id/transcript` | Owner | Append voice transcript segment |
| POST | `/api/interviews/:id/finish` | Owner/Admin | Finish and score |
| GET | `/api/interviews/:id` | Owner/Admin | Interview detail |
| GET | `/api/interviews/:id/report` | Owner/Admin | Report |
| GET | `/api/coding/problems` | Authenticated | Coding problem list |
| POST | `/api/coding/problems` | Admin | Create coding problem |
| POST | `/api/interviews/:id/code/submit` | Owner | Submit code to Judge0 |
| POST | `/api/interviews/:id/code/follow-up` | Owner | AI code follow-up |
| GET | `/api/admin/dashboard` | Admin | Dashboard metrics |
| GET | `/api/admin/interviews` | Admin | Interview list/filter |
| GET | `/api/admin/interviews/:id/transcript` | Admin | Transcript and submission summary |
| GET | `/api/admin/jobs/:jobId/rankings` | Admin | Role ranking |
| POST | `/api/ai/interviews/:id/question` | Owner/Admin | AI question |
| POST | `/api/ai/interviews/:id/evaluate` | Owner/Admin | Evaluate answer |
| GET | `/api/ai/status` | Authenticated | AI readiness |
| POST | `/api/ai/voice/session-config` | Authenticated | Safe voice adapter config |

Admin-only routes must use the role created by the secure seed script. Do not add `role` to public registration input.
