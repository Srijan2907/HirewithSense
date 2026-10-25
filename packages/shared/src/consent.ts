/**
 * AI-disclosure text shown to candidates before an interview starts. The version changes whenever
 * the wording changes; the server stores a hash of the exact text the candidate accepted.
 */
export const AI_DISCLOSURE_VERSION = '2026-10-v1';

export const AI_DISCLOSURE_TEXT = `This interview is conducted with the help of an automated system (artificial intelligence).

What happens during the interview
• An AI interviewer asks questions based on the job description and the resume you uploaded. You may answer by typing or by speaking; spoken answers are transcribed to text.
• In the coding section, your code runs against test cases inside an isolated environment.
• Your answers, transcript, code, test results and a timeline of interface events (for example when the interview tab loses focus, when text is pasted into the editor, or when full-screen mode is left) are recorded.

How your interview is evaluated
• The AI produces a report that scores job-related competencies defined by the employer, with quotes from your answers as evidence. Coding results are computed from test cases, not by the AI.
• The report assesses the content of what you said and wrote. It does not analyse your voice, accent, appearance, or any protected characteristic.
• A human recruiter reviews the report and makes every hiring decision. No decision is made automatically.

Your rights
• You may request an alternative assessment process or an accommodation using the field below before you begin.
• You may ask the employer for a copy of your data, an explanation of how the report was produced, a correction of inaccurate data, or deletion of your interview data.
• Interview data is kept for the employer's retention period and then deleted.

By continuing you confirm that you have read this notice and agree to proceed with the AI-assisted interview.`;
