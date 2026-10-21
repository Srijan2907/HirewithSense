import OpenAI from "openai";

function getClient() {
  if (!process.env.QWEN_API_KEY) return null;
  return new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
  });
}
export function aiReady() { return Boolean(process.env.QWEN_API_KEY); }

export async function chatJSON(system, user, model = process.env.QWEN_TEXT_MODEL || "qwen-plus") {
  const client = getClient();
  if (!client) return null;
  const result = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }]
  });
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned an empty response");
  try { return JSON.parse(content); }
  catch { throw new Error("AI provider did not return valid JSON"); }
}

export async function generateQuestion({ job, resume, previousQuestions, lastAnswer }) {
  const fallback = {
    question: previousQuestions.length
      ? `Follow up on your previous response: can you explain the trade-offs and give a concrete example relevant to ${job.title}?`
      : `Tell me about a project from your resume that best demonstrates your ${job.skills?.[0] || "technical"} skills. What did you build and what was your contribution?`,
    competency: "projectDepth",
    rationale: "Fallback question based on role and resume context"
  };
  const result = await chatJSON(
    "You are a fair technical interviewer. Return JSON only with question, competency, rationale. Ask one specific open-ended question. Do not infer protected traits. Ground resume questions in supplied text.",
    JSON.stringify({
      role: { title: job.title, description: job.description, skills: job.skills },
      resume: resume?.parsed || { extractedText: resume?.extractedText?.slice(0, 8000) || "" },
      previousQuestions: previousQuestions.slice(-12),
      lastAnswer: lastAnswer || ""
    })
  );
  return result?.question ? result : fallback;
}

export async function evaluateInterview({ job, interview }) {
  const transcript = interview.transcript.map((x) => `${x.speaker}: ${x.text}`).join("\n").slice(0, 20000);
  const coding = interview.submissions.map((s) => ({
    languageId: s.languageId, status: s.status, passed: s.passed, total: s.total, feedback: s.feedback
  }));
  const rubric = job.rubric || {};
  const fallbackScores = Object.fromEntries(Object.keys(rubric).map((key) => [key, 50]));
  const result = await chatJSON(
    "You evaluate technical interviews using only evidence provided. Return JSON: summary (string), categoryScores (object with numeric 0-100 values matching rubric keys), strengths (string array), improvements (string array), evidence (array of objects with category, quoteOrObservation, explanation), recommendation (one of strong-match, possible-match, needs-development, insufficient-evidence). Do not infer protected traits or treat accent/personality as competence. Mark insufficient evidence where appropriate.",
    JSON.stringify({ role: job.title, description: job.description, rubric, transcript, coding, minimumScore: job.minimumScore })
  );
  const categoryScores = result?.categoryScores || fallbackScores;
  let weightedScore = 0;
  for (const [key, weight] of Object.entries(rubric)) {
    const n = Number(categoryScores[key]);
    if (Number.isFinite(n)) weightedScore += Math.max(0, Math.min(100, n)) * Number(weight) / 100;
  }
  return {
    summary: result?.summary || "Automated evaluation unavailable. Human review is required.",
    categoryScores,
    weightedScore: Math.round(weightedScore * 100) / 100,
    strengths: result?.strengths || [],
    improvements: result?.improvements || [],
    evidence: result?.evidence || [],
    recommendation: result?.recommendation || "insufficient-evidence",
    aiGenerated: Boolean(result),
    humanReviewRequired: true,
    evaluatedAt: new Date()
  };
}

export async function evaluateAnswer({ job, question, answer }) {
  const result = await chatJSON(
    "Evaluate one technical interview answer. Return JSON with score (0-10), feedback (string), strengths (string array), gaps (string array), followUpQuestion (string). Be evidence-based, fair and concise.",
    JSON.stringify({ role: job.title, question, answer, skills: job.skills })
  );
  return result || { score: null, feedback: "AI evaluation is not configured; answer saved for later review.", strengths: [], gaps: [], followUpQuestion: "" };
}

export async function codeFollowUp({ job, question, sourceCode, resultSummary }) {
  const result = await chatJSON(
    "You are a coding interviewer. Return JSON with feedback (string), followUpQuestions (array of 1-3 strings), alternativeApproach (string). Review code for correctness, complexity and readability. Do not claim code passed unless test results say so.",
    JSON.stringify({ role: job.title, problem: question.prompt, sourceCode, resultSummary })
  );
  return result || {
    feedback: "Automated code review is not configured. Review correctness, complexity and edge cases manually.",
    followUpQuestions: ["What is the time and space complexity?", "Which edge cases could break this solution?", "How would you improve readability or performance?"],
    alternativeApproach: ""
  };
}
