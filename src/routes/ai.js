import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "../utils/httpError.js";
import Interview from "../models/Interview.js";
import Job from "../models/Job.js";
import Resume from "../models/Resume.js";
import { assertInterviewActive, requireOwnerOrAdmin } from "../utils/permissions.js";
import { aiReady, generateQuestion, evaluateAnswer } from "../services/aiService.js";
const router = Router();
router.use(authenticate);

router.post("/interviews/:id/question", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, "Invalid interview id");
  const interview = await Interview.findById(req.params.id);
  if (!interview) throw httpError(404, "Interview not found");
  requireOwnerOrAdmin(interview.user, req.user);
  assertInterviewActive(interview);
  const [job, resume] = await Promise.all([
    Job.findById(interview.job),
    interview.resume ? Resume.findById(interview.resume) : Resume.findOne({ user: interview.user }).sort({ createdAt: -1 })
  ]);
  const generated = await generateQuestion({ job, resume, previousQuestions: interview.questionsAsked, lastAnswer: req.body.lastAnswer || "" });
  interview.questionsAsked.push(generated.question);
  interview.transcript.push({ speaker: "interviewer", text: generated.question });
  await interview.save();
  res.json({ success: true, ...generated, providerReady: aiReady() });
}));

router.post("/interviews/:id/evaluate", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, "Invalid interview id");
  const interview = await Interview.findById(req.params.id);
  if (!interview) throw httpError(404, "Interview not found");
  requireOwnerOrAdmin(interview.user, req.user);
  if (req.user.role !== "admin") assertInterviewActive(interview);
  const { question, answer } = req.body;
  if (typeof question !== "string" || typeof answer !== "string" || !answer.trim()) throw httpError(400, "question and answer are required");
  const job = await Job.findById(interview.job);
  res.json({ success: true, evaluation: await evaluateAnswer({ job, question, answer }) });
}));

router.get("/status", (_req, res) => res.json({
  success: true,
  textAIReady: aiReady(),
  voiceProvider: "Qwen realtime adapter pending provider-specific WebSocket implementation",
  voiceModelConfigured: Boolean(process.env.QWEN_REALTIME_MODEL),
  voiceCredentialsExposed: false
}));

router.post("/voice/session-config", asyncHandler(async (req, res) => {
  // Never send QWEN_API_KEY to the browser. This endpoint deliberately returns no secret.
  res.json({
    success: true,
    provider: "qwen",
    model: process.env.QWEN_REALTIME_MODEL || null,
    ready: Boolean(process.env.QWEN_API_KEY && process.env.QWEN_REALTIME_MODEL),
    connectionMode: "server-side-adapter-required",
    message: "Use the official provider realtime protocol from the server. Do not expose provider credentials in frontend code."
  });
}));
export default router;
