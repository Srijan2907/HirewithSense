import { Router } from "express";
import mongoose from "mongoose";
import Question from "../models/Question.js";
import Interview from "../models/Interview.js";
import Job from "../models/Job.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "../utils/httpError.js";
import { assertInterviewActive, requireOwnerOrAdmin } from "../utils/permissions.js";
import { executeCode } from "../services/judge0Service.js";
import { codeFollowUp } from "../services/aiService.js";
const router = Router();
router.use(authenticate);

router.get("/coding/problems", asyncHandler(async (req, res) => {
  let filter = { type: "coding" };
  if (req.user.role !== "admin") {
    const assigned = await Interview.find({ user: req.user.id }).distinct("job");
    filter.job = { $in: assigned };
  }
  const questions = await Question.find(filter).populate("job", "title").sort({ createdAt: -1 }).lean();
  res.json({ success: true, problems: questions.map(q => ({
    id: String(q._id), job: q.job, prompt: q.prompt, difficulty: q.difficulty,
    languageIds: q.languageIds, starterCode: q.starterCode,
    testCases: q.testCases.map(t => ({ hidden: t.hidden }))
  })) });
}));

router.post("/coding/problems", authorize("admin"), asyncHandler(async (req, res) => {
  const { jobId, prompt } = req.body;
  if (!mongoose.isValidObjectId(jobId) || !prompt?.trim()) throw httpError(400, "jobId and prompt are required");
  if (!await Job.findById(jobId)) throw httpError(404, "Job not found");
  const question = await Question.create({
    job: jobId, type: "coding", prompt: prompt.trim(),
    difficulty: req.body.difficulty || "medium",
    languageIds: Array.isArray(req.body.languageIds) ? req.body.languageIds : [63],
    starterCode: req.body.starterCode || "",
    expectedSignals: req.body.expectedSignals || [],
    testCases: Array.isArray(req.body.testCases) ? req.body.testCases.map(t => ({
      input: String(t.input ?? ""), expectedOutput: String(t.expectedOutput ?? ""), hidden: Boolean(t.hidden)
    })) : [],
    createdBy: req.user.id
  });
  res.status(201).json({ success: true, problem: { id: question.id, prompt: question.prompt } });
}));

export async function submitCodeHandler(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, "Invalid interview id");
  const interview = await Interview.findById(req.params.id);
  if (!interview) throw httpError(404, "Interview not found");
  requireOwnerOrAdmin(interview.user, req.user);
  if (req.user.role !== "user") throw httpError(403, "Candidate account required");
  assertInterviewActive(interview);
  if (interview.interviewType !== "coding") throw httpError(400, "This is not a coding interview");
  const { problemId, languageId, sourceCode } = req.body;
  if (!mongoose.isValidObjectId(problemId) || !Number.isInteger(Number(languageId)) || typeof sourceCode !== "string" || !sourceCode.trim()) throw httpError(400, "problemId, languageId and sourceCode are required");
  if (sourceCode.length > 30000) throw httpError(413, "Source code exceeds 30KB");
  const problem = await Question.findOne({ _id: problemId, job: interview.job, type: "coding" });
  if (!problem) throw httpError(404, "Coding problem not found for this job");
  if (problem.languageIds.length && !problem.languageIds.includes(Number(languageId))) throw httpError(400, "Language is not allowed for this problem");
  const cases = problem.testCases.length ? problem.testCases.slice(0, 20) : [{ input: "", expectedOutput: "", hidden: false }];
  const allResults = [];
  for (const test of cases) {
    const result = await executeCode({ sourceCode, languageId: Number(languageId), stdin: test.input, expectedOutput: test.expectedOutput });
    allResults.push({
      hidden: Boolean(test.hidden), status: result.status, passed: result.passed,
      stdout: result.stdout, stderr: result.stderr, compileOutput: result.compileOutput,
      time: result.time, memory: result.memory
    });
  }
  const total = allResults.length;
  const passed = allResults.filter(r => r.passed).length;
  const pending = allResults.some(r => r.status === "processing");
  // Never persist hidden-case inputs, expected outputs, stdout or stderr in the candidate-visible response.
  const publicResults = allResults.filter(r => !r.hidden).map(({ hidden, ...result }) => result);
  const submission = {
    problemId: problem._id, languageId: Number(languageId), sourceCode,
    status: pending ? "processing" : (passed === total ? "accepted" : "failed"),
    passed, total, results: publicResults,
    feedback: `${passed}/${total} total test cases passed. Hidden test details are withheld.`
  };
  interview.submissions.push(submission);
  interview.transcript.push({ speaker: "system", text: `Coding submission: ${submission.status}, ${passed}/${total} visible tests passed.` });
  await interview.save();
  const saved = interview.submissions.at(-1);
  res.status(201).json({
    success: true,
    submission: { id: String(saved._id), problemId: String(problem._id), status: saved.status, passed, total, results, feedback: saved.feedback }
  });
}

router.post("/interviews/:id/code/submit", asyncHandler(submitCodeHandler));

router.post("/interviews/:id/code/follow-up", asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) throw httpError(404, "Interview not found");
  requireOwnerOrAdmin(interview.user, req.user);
  if (req.user.role !== "user") throw httpError(403, "Candidate account required");
  assertInterviewActive(interview);
  const submission = interview.submissions.id(req.body.submissionId);
  if (!submission) throw httpError(404, "Submission not found");
  const [job, question] = await Promise.all([Job.findById(interview.job), Question.findById(submission.problemId)]);
  const followUp = await codeFollowUp({
    job, question, sourceCode: submission.sourceCode,
    resultSummary: { status: submission.status, passed: submission.passed, total: submission.total, feedback: submission.feedback }
  });
  submission.feedback = `${submission.feedback}\n${followUp.feedback}`;
  interview.transcript.push({ speaker: "interviewer", text: followUp.followUpQuestions.join("\n") });
  await interview.save();
  res.json({ success: true, followUp });
}));
export default router;
