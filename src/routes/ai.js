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
import { geminiReady } from "../services/resumeService.js";
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
  interviewerAI: "openai",
  interviewerAIReady: aiReady(),
  textAIReady: aiReady(),
  resumeParser: "gemini",
  resumeParserReady: geminiReady(),
  voiceProvider: "Qwen LiveTranslate realtime via AOQ",
  voiceModel: process.env.QWEN_REALTIME_MODEL || "qwen3.8-livetranslate-flash-realtime",
  voiceReady: Boolean(process.env.QWEN_API_KEY && process.env.QWEN_WORKSPACE_ID),
  voiceCredentialsExposed: false
}));

router.post("/voice/session-config", asyncHandler(async (req, res) => {
  // Never send QWEN_API_KEY to the browser. This endpoint deliberately returns no secret.
  res.json({
    success: true,
    provider: "qwen",
    model: process.env.QWEN_REALTIME_MODEL || "qwen3.8-livetranslate-flash-realtime",
    ready: Boolean(process.env.QWEN_API_KEY && process.env.QWEN_WORKSPACE_ID),
    connectionMode: "AOQ",
    message: "Request interview-scoped temporary AOQ credentials before connecting. Do not expose provider API credentials in frontend code."
  });
}));

router.post("/interviews/:id/voice/session-config", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, "Invalid interview id");
  const interview = await Interview.findById(req.params.id);
  if (!interview) throw httpError(404, "Interview not found");
  requireOwnerOrAdmin(interview.user, req.user);
  if (req.user.role !== "user") throw httpError(403, "Candidate account required");
  assertInterviewActive(interview);

  const apiKey = process.env.QWEN_API_KEY;
  const workspaceId = process.env.QWEN_WORKSPACE_ID;
  const region = (process.env.QWEN_REGION || "singapore").toLowerCase();
  if (!apiKey || !workspaceId) throw httpError(503, "Qwen realtime voice is not configured");
  if (!["singapore", "beijing"].includes(region)) throw httpError(500, "QWEN_REGION must be singapore or beijing");

  const domain = region === "beijing"
    ? `${workspaceId}.cn-beijing.maas.aliyuncs.com`
    : `${workspaceId}.ap-southeast-1.maas.aliyuncs.com`;
  const model = process.env.QWEN_REALTIME_MODEL || "qwen3.8-livetranslate-flash-realtime";
  let upstream;
  try {
    upstream = await fetch(`https://${domain}/api/v1/webrtc/realtime?model=${encodeURIComponent(model)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "x-dashscope-rtc-transport": "moq"
      },
      body: "{}",
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw httpError(502, "Could not reach the Qwen realtime service");
  }
  if (!upstream.ok) {
    console.error("Qwen realtime credential allocation failed", upstream.status);
    throw httpError(502, "Qwen could not allocate a realtime voice session");
  }
  const credential = await upstream.json();
  if (!credential.aoqTokenForClient || !credential.sid || !credential.clientRelayEndpoints) {
    throw httpError(502, "Qwen returned incomplete realtime session credentials");
  }
  res.json({
    success: true,
    provider: "qwen",
    model,
    protocol: "aoq",
    credentials: {
      token: credential.aoqTokenForClient,
      sid: credential.sid,
      relayEndpoints: credential.clientRelayEndpoints,
      certFingerprint: credential.clientRelayCertFingerprint,
      workspaceIdHash: credential.extraInfo?.workspaceIdHash,
      expiresInSeconds: credential.sidExpiresInSecs
    }
  });
}));
export default router;
