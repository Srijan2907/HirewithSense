import multer from "multer";
import path from "node:path";
import fs from "node:fs";

const uploadDir = path.resolve("uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  }
});
const maxMb = Number(process.env.MAX_RESUME_MB || 5);
export const resumeUpload = multer({
  storage,
  limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".pdf", ".docx"].includes(ext)) return cb(new Error("Only PDF and DOCX resumes are accepted"));
    cb(null, true);
  }
});
