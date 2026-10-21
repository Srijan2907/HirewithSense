import { Router } from "express";
import mongoose from "mongoose";
import { authenticate, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "../utils/httpError.js";
import Interview from "../models/Interview.js";
import Job from "../models/Job.js";
import User from "../models/User.js";
const router = Router();
router.use(authenticate, authorize("admin"));

router.get("/dashboard", asyncHandler(async (_req, res) => {
  const [users, jobs, totalInterviews, completedInterviews, recent] = await Promise.all([
    User.countDocuments({ role: "user" }),
    Job.countDocuments({ isActive: true }),
    Interview.countDocuments(),
    Interview.countDocuments({ status: { $in: ["completed", "expired"] } }),
    Interview.find().populate("user", "name email username").populate("job", "title").sort({ createdAt: -1 }).limit(10).select("status interviewType createdAt report")
  ]);
  res.json({ success: true, stats: { users, activeJobs: jobs, totalInterviews, completedInterviews }, recentInterviews: recent });
}));

router.get("/interviews", asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.jobId) {
    if (!mongoose.isValidObjectId(req.query.jobId)) throw httpError(400, "Invalid jobId");
    filter.job = req.query.jobId;
  }
  if (req.query.status) filter.status = req.query.status;
  const interviews = await Interview.find(filter)
    .populate("user", "name username email").populate("job", "title rubric minimumScore")
    .sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, interviews });
}));

router.get("/interviews/:id/transcript", asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id).populate("user", "name email").populate("job", "title");
  if (!interview) throw httpError(404, "Interview not found");
  res.json({ success: true, candidate: interview.user, job: interview.job, status: interview.status, transcript: interview.transcript, answers: interview.answers, submissions: interview.submissions.map(s => ({
    id: String(s._id), problemId: s.problemId, languageId: s.languageId, status: s.status, passed: s.passed, total: s.total, feedback: s.feedback, submittedAt: s.submittedAt
  })) });
}));

router.get("/jobs/:jobId/rankings", asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.jobId)) throw httpError(400, "Invalid job id");
  const job = await Job.findById(req.params.jobId);
  if (!job) throw httpError(404, "Job not found");
  const interviews = await Interview.find({ job: job._id, status: { $in: ["completed", "expired"] } })
    .populate("user", "name username email")
    .select("user report status interviewType completedAt")
    .lean();
  const ranked = interviews.map(i => ({
    candidate: i.user,
    interviewId: String(i._id),
    status: i.status,
    interviewType: i.interviewType,
    score: i.report?.weightedScore ?? null,
    recommendation: i.report?.recommendation ?? "insufficient-evidence",
    humanReviewRequired: i.report?.humanReviewRequired !== false,
    completedAt: i.completedAt
  })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  res.json({ success: true, job: { id: job.id, title: job.title, minimumScore: job.minimumScore }, rankings: ranked });
}));
export default router;
