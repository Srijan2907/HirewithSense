import { Router } from "express";
import mongoose from "mongoose";
import Job from "../models/Job.js";
import Question from "../models/Question.js";
import Interview from "../models/Interview.js";
import Resume from "../models/Resume.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "../utils/httpError.js";
import { validateRubric, DEFAULT_RUBRIC } from "../utils/rubric.js";
const router = Router();
router.use(authenticate);
router.get("/", asyncHandler(async (req, res) => {
  const filter = req.user.role === "admin" ? {} : { isActive: true };
  res.json({ success: true, jobs: await Job.find(filter).sort({ createdAt: -1 }) });
}));
router.post("/", authorize("admin"), asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  if (!title?.trim() || !description?.trim()) throw httpError(400, "title and description are required");
  const rubric = req.body.rubric || DEFAULT_RUBRIC;
  try { validateRubric(rubric); } catch (e) { throw httpError(400, e.message); }
  const job = await Job.create({
    title: title.trim(), description: description.trim(),
    skills: Array.isArray(req.body.skills) ? req.body.skills.slice(0, 50) : [],
    interviewTypes: Array.isArray(req.body.interviewTypes) ? req.body.interviewTypes : ["oral", "coding"],
    durationMinutes: Math.max(5, Math.min(30, Number(req.body.durationMinutes) || 25)),
    rubric, minimumScore: req.body.minimumScore ?? 70, createdBy: req.user.id
  });
  res.status(201).json({ success: true, job });
}));
router.get("/:id", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, "Invalid job id");
  const job = await Job.findById(req.params.id);
  if (!job || (!job.isActive && req.user.role !== "admin")) throw httpError(404, "Job not found");
  res.json({ success: true, job });
}));
router.patch("/:id", authorize("admin"), asyncHandler(async (req, res) => {
  const allowed = ["title", "description", "skills", "interviewTypes", "durationMinutes", "rubric", "minimumScore", "isActive"];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (updates.rubric) { try { validateRubric(updates.rubric); } catch (e) { throw httpError(400, e.message); } }
  if (updates.durationMinutes !== undefined) updates.durationMinutes = Math.max(5, Math.min(30, Number(updates.durationMinutes)));
  const job = await Job.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
  if (!job) throw httpError(404, "Job not found");
  res.json({ success: true, job });
}));
router.post("/:id/questions", authorize("admin"), asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw httpError(404, "Job not found");
  const { type, prompt } = req.body;
  if (!["oral", "coding"].includes(type) || !prompt?.trim()) throw httpError(400, "type and prompt are required");
  const question = await Question.create({
    job: job.id, type, prompt: prompt.trim(),
    expectedSignals: Array.isArray(req.body.expectedSignals) ? req.body.expectedSignals : [],
    difficulty: req.body.difficulty || "medium", order: Number(req.body.order) || 0,
    starterCode: req.body.starterCode || "", languageIds: req.body.languageIds || [63],
    testCases: type === "coding" && Array.isArray(req.body.testCases) ? req.body.testCases : [],
    createdBy: req.user.id
  });
  res.status(201).json({ success: true, question: { ...question.toObject(), testCases: question.testCases.map(t => ({ hidden: t.hidden })) } });
}));
router.get("/:id/questions", authorize("admin"), asyncHandler(async (req, res) => {
  const filter = { job: req.params.id };
  const questions = await Question.find(filter).sort({ order: 1 }).lean();
  res.json({ success: true, questions: questions.map(q => ({ ...q, testCases: q.testCases?.map(t => ({ hidden: t.hidden })) })) });
}));
router.post("/:id/assignments", authorize("admin"), asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw httpError(404, "Job not found");
  const { userId, interviewType } = req.body;
  if (!mongoose.isValidObjectId(userId) || !["oral", "coding"].includes(interviewType)) throw httpError(400, "Valid userId and interviewType are required");
  const resume = await Resume.findOne({ user: userId }).sort({ createdAt: -1 });
  const interview = await Interview.create({
    user: userId, job: job.id, interviewType, durationMinutes: job.durationMinutes,
    resume: resume?._id || null, assignedBy: req.user.id
  });
  res.status(201).json({ success: true, interview });
}));
export default router;
