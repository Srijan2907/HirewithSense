import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectDB } from "./src/config/db.js";
import { errorHandler, notFound } from "./src/middleware/errors.js";
import authRoutes from "./src/routes/auth.js";
import userRoutes from "./src/routes/users.js";
import resumeRoutes from "./src/routes/resumes.js";
import jobRoutes from "./src/routes/jobs.js";
import interviewRoutes from "./src/routes/interviews.js";
import codingRoutes from "./src/routes/coding.js";
import adminRoutes from "./src/routes/admin.js";
import aiRoutes from "./src/routes/ai.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((v) => v.trim()),
  credentials: false
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  service: "HireWithSenseAI API",
  timestamp: new Date().toISOString(),
  databaseConfigured: Boolean(process.env.MONGO_URL)
}));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/resumes", resumeRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/interviews", interviewRoutes);
app.use("/api", codingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai", aiRoutes);

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 4000);
if (process.env.NODE_ENV !== "test") {
  await connectDB();
  app.listen(port, () => console.log(`HireWithSenseAI API listening on http://localhost:${port}`));
}

export default app;
