import mongoose from "mongoose";
import { DEFAULT_RUBRIC } from "../utils/rubric.js";
const jobSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 150 },
  description: { type: String, required: true, maxlength: 10000 },
  skills: { type: [String], default: [] },
  interviewTypes: { type: [String], enum: ["oral", "coding"], default: ["oral", "coding"] },
  durationMinutes: { type: Number, min: 5, max: 30, default: 25 },
  rubric: { type: mongoose.Schema.Types.Mixed, default: DEFAULT_RUBRIC },
  minimumScore: { type: Number, min: 0, max: 100, default: 70 },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true, versionKey: false });
export default mongoose.model("Job", jobSchema);
