/** Platform-wide enumerations. Keep values stable: they are persisted in the database. */

export const USER_ROLES = ['candidate', 'recruiter', 'superadmin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const JOB_STATUSES = ['draft', 'open', 'closed', 'archived'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SECTION_TYPES = ['conversation', 'coding'] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const INTERVIEW_STATUSES = [
  'invited',
  'ready',
  'in_progress',
  'submitted',
  'completed',
  'expired',
  'cancelled',
] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

/** Statuses in which a candidate may still write to the interview. */
export const ACTIVE_INTERVIEW_STATUSES: readonly InterviewStatus[] = ['in_progress'];
/** Statuses that count as finished for recruiter views. */
export const FINISHED_INTERVIEW_STATUSES: readonly InterviewStatus[] = [
  'submitted',
  'completed',
  'expired',
];

export const QUESTION_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type QuestionDifficulty = (typeof QUESTION_DIFFICULTIES)[number];

export const SPEAKERS = ['interviewer', 'candidate', 'system'] as const;
export type Speaker = (typeof SPEAKERS)[number];

export const SUBMISSION_STATUSES = ['queued', 'running', 'graded', 'error'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Per-test-case verdicts; mirrors Judge0 categories so adapters map 1:1. */
export const VERDICTS = [
  'passed',
  'wrong_answer',
  'time_limit',
  'memory_limit',
  'runtime_error',
  'compile_error',
  'internal_error',
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const RECOMMENDATIONS = [
  'strong_hire',
  'hire',
  'borderline',
  'no_hire',
  'insufficient_evidence',
] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const DECISIONS = ['advance', 'hold', 'reject', 'hire'] as const;
export type Decision = (typeof DECISIONS)[number];

export const PROCTORING_EVENT_TYPES = [
  'focus_lost',
  'focus_gained',
  'tab_hidden',
  'tab_visible',
  'paste',
  'copy',
  'fullscreen_exit',
  'fullscreen_enter',
  'devtools_suspected',
  'network_offline',
  'network_online',
  'multiple_monitors_suspected',
] as const;
export type ProctoringEventType = (typeof PROCTORING_EVENT_TYPES)[number];

export const REPORT_STATUSES = ['pending', 'generating', 'ready', 'failed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const RESUME_PARSE_STATUSES = ['pending', 'parsing', 'parsed', 'failed'] as const;
export type ResumeParseStatus = (typeof RESUME_PARSE_STATUSES)[number];

/**
 * Supported programming languages. `id` is persisted; runner adapters map it to their own
 * identifiers (Judge0 language ids, Docker images, …).
 */
export const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript (Node.js)', monaco: 'javascript', ext: 'js' },
  { id: 'typescript', label: 'TypeScript', monaco: 'typescript', ext: 'ts' },
  { id: 'python', label: 'Python 3', monaco: 'python', ext: 'py' },
  { id: 'cpp', label: 'C++ (GCC)', monaco: 'cpp', ext: 'cpp' },
  { id: 'c', label: 'C (GCC)', monaco: 'c', ext: 'c' },
  { id: 'java', label: 'Java 21', monaco: 'java', ext: 'java' },
  { id: 'go', label: 'Go', monaco: 'go', ext: 'go' },
  { id: 'rust', label: 'Rust', monaco: 'rust', ext: 'rs' },
] as const;
export type LanguageId = (typeof LANGUAGES)[number]['id'];
export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id) as unknown as readonly [
  LanguageId,
  ...LanguageId[],
];
export const languageById = (id: string) => LANGUAGES.find((l) => l.id === id);
