import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import Resume from "../models/Resume.js";
import { authenticate } from "../middleware/auth.js";
import { resumeUpload } from "../middleware/upload.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "../utils/httpError.js";
import { extractResumeText, parseResume } from "../services/resumeService.js";
const router = Router();
router.use(authenticate);
router.post("/", resumeUpload.single("resume"), asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, "Upload a PDF or DOCX in the 'resume' field");
  const ext = path.extname(req.file.originalname).toLowerCase();
  let extractedText = "";
  try { extractedText = await extractResumeText(req.file.path, ext); }
  catch (error) { await fs.unlink(req.file.path).catch(() => {}); throw httpError(400, `Could not read resume: ${error.message}`); }
  if (!extractedText.trim()) throw httpError(400, "No readable text found in resume. Scanned PDFs need OCR.");
  const resume = await Resume.create({
    user: req.user.id, originalName: path.basename(req.file.originalname),
    storagePath: req.file.path, mimeType: req.file.mimetype, extractedText: extractedText.slice(0, 50000)
  });
  res.status(201).json({ success: true, resume: { id: resume.id, originalName: resume.originalName, createdAt: resume.createdAt, parsed: resume.parsed } });
}));
router.get("/me", asyncHandler(async (req, res) => {
  const resume = await Resume.findOne({ user: req.user.id }).sort({ createdAt: -1 }).select("-extractedText -storagePath");
  res.json({ success: true, resume });
}));
router.post("/me/parse", asyncHandler(async (req, res) => {
  const resume = await Resume.findOne({ user: req.user.id }).sort({ createdAt: -1 });
  if (!resume) throw httpError(404, "Upload a resume first");
  resume.parsed = await parseResume(resume.extractedText);
  await resume.save();
  res.json({ success: true, parsed: resume.parsed });
}));
export default router;
