import { Router } from "express";
import mongoose from "mongoose";
import Interview from "../models/Interview.js";
import Job from "../models/Job.js";
import Resume from "../models/Resume.js";
import Question from "../models/Question.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "../utils/httpError.js";
import { assertInterviewActive, requireOwnerOrAdmin } from "../utils/permissions.js";
import { evaluateAnswer, evaluateInterview, generateQuestion } from "../services/aiService.js";
const router = Router();
router.use(authenticate);

async function getAccessibleInterview(id, user) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, "Invalid interview id");
  const interview = await Interview.findById(id);
  if (!interview) throw httpError(404, "Interview not found");
  requireOwnerOrAdmin(interview.user, user);
  return interview;
}

router.get("/mine", asyncHandler(async (req, res) => {
  const filter = req.user.role === "admin" ? {} : { user: req.user.id };
  const interviews = await Interview.find(filter).populate("job", "title skills durationMinutes").sort({ createdAt: -1 });
  res.json({ success: true, interviews });
}));

router.post("/:id/start", asyncHandler(async (req, res) => {
  const interview = await getAccessibleInterview(req.params.id, req.user);
  if (req.user.role === "admin") throw httpError(403, "Candidates start their own assigned interviews");
  if (interview.status !== "assigned") throw httpError(409, "Interview has already started or finished");
  const now = new Date();
  interview.startedAt = now;
  interview.endsAt = new Date(now.getTime() + Math.min(30, interview.durationMinutes) * 60_000);
  interview.status = "in-progress";
  interview.transcript.push({ speaker: "system", text: `Interview started. Time limit: ${interview.durationMinutes} minutes.`, timestamp: now });
  await interview.save();
  res.json({ success: true, interviewId: interview.id, status: interview.status, startedAt: interview.startedAt, endsAt: interview.endsAt, durationMinutes: interview.durationMinutes });
}));

router.post("/:id/answers", asyncHandler(async (req, res) => {
  const interview = await getAccessibleInterview(req.params.id, req.user);
  if (req.user.role !== "user") throw httpError(403, "Candidate account required");
  assertInterviewActive(interview);
  const { questionId, answer } = req.body;
  if (!questionId || typeof answer !== "string" || !answer.trim()) throw httpError(400, "questionId and answer are required");
  const job = await Job.findById(interview.job);
  const question = await Question.findById(questionId);
  const questionText = question?.prompt || String(req.body.question || "Interview answer");
  const evaluation = await evaluateAnswer({ job, question: questionText, answer: answer.trim() });
  interview.answers.push({ questionId: String(questionId), question: questionText, answer: answer.trim().slice(0, 12000), evaluation });
  interview.transcript.push({ speaker: "candidate", text: answer.trim().slice(0, 12000) });
  await interview.save();
  res.json({ success: true, saved: true, evaluation });
}));

router.post("/:id/next-question", asyncHandler(async (req, res) => {
  const interview = await getAccessibleInterview(req.params.id, req.user);
  if (req.user.role !== "user") throw httpError(403, "Candidate account required");
  assertInterviewActive(interview);
  const [job, resume] = await Promise.all([
    Job.findById(interview.job),
    interview.resume ? Resume.findById(interview.resume) : Resume.findOne({ user: interview.user }).sort({ createdAt: -1 })
  ]);
  const configured = await Question.find({ job: job.id, type: interview.interviewType }).sort({ order: 1 });
  const unused = configured.find(q => !interview.questionsAsked.includes(String(q._id)));
  let generated;
  if (unused) {
    generated = { question: unused.prompt, questionId: String(unused._id), source: "question-bank" };
  } else {
    const result = await generateQuestion({
      job, resume,
      previousQuestions: interview.questionsAsked,
      lastAnswer: req.body.lastAnswer || interview.answers.at(-1)?.answer || ""
    });
    generated = { ...result, questionId: `ai-${Date.now()}`, source: "ai" };
  }
  interview.questionsAsked.push(generated.question);
  interview.transcript.push({ speaker: "interviewer", text: generated.question });
  await interview.save();
  res.json({ success: true, ...generated, endsAt: interview.endsAt });
}));

router.post("/:id/transcript", asyncHandler(async (req, res) => {
  const interview = await getAccessibleInterview(req.params.id, req.user);
  if (req.user.role !== "user") throw httpError(403, "Candidate account required");
  assertInterviewActive(interview);
  const { speaker, text } = req.body;
  if (!["candidate", "interviewer", "system"].includes(speaker) || typeof text !== "string" || !text.trim()) throw httpError(400, "Valid speaker and text are required");
  interview.transcript.push({ speaker, text: text.trim().slice(0, 12000), timestamp: req.body.timestamp ? new Date(req.body.timestamp) : new Date() });
  await interview.save();
  res.status(201).json({ success: true, transcriptSegments: interview.transcript.length });
}));

router.post("/:id/finish", asyncHandler(async (req, res) => {
  const interview = await getAccessibleInterview(req.params.id, req.user);
  if (req.user.role !== "user" && req.user.role !== "admin") throw httpError(403, "Not permitted");
  if (interview.status === "completed") return res.json({ success: true, status: interview.status, report: interview.report });
  if (interview.status !== "in-progress") throw httpError(409, "Interview is not in progress");
  const [job] = await Promise.all([Job.findById(interview.job)]);
  interview.status = Date.now() >= new Date(interview.endsAt).getTime() ? "expired" : "completed";
  interview.completedAt = new Date();
  interview.report = await evaluateInterview({ job, interview });
  await interview.save();
  res.json({ success: true, status: interview.status, report: interview.report });
}));

router.get("/:id/report", asyncHandler(async (req, res) => {
  const interview = await getAccessibleInterview(req.params.id, req.user);
  if (!interview.report && req.user.role !== "admin") throw httpError(404, "Report is not ready");
  res.json({ success: true, report: interview.report });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const interview = await getAccessibleInterview(req.params.id, req.user);
  res.json({ success: true, interview });
}));
export default router;
