import mongoose from "mongoose";
const transcriptSchema = new mongoose.Schema({
  speaker: { type: String, enum: ["candidate", "interviewer", "system"], required: true },
  text: { type: String, required: true, maxlength: 12000 },
  timestamp: { type: Date, default: Date.now }
}, { _id: true });
const answerSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  question: { type: String, required: true },
  answer: { type: String, default: "" },
  answeredAt: { type: Date, default: Date.now },
  evaluation: { type: mongoose.Schema.Types.Mixed, default: null }
}, { _id: false });
const submissionSchema = new mongoose.Schema({
  problemId: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
  languageId: { type: Number, required: true },
  sourceCode: { type: String, required: true, maxlength: 30000 },
  status: { type: String, default: "queued" },
  passed: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  results: { type: [mongoose.Schema.Types.Mixed], default: [] },
  feedback: { type: String, default: "" },
  submittedAt: { type: Date, default: Date.now }
}, { _id: true });
const interviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, index: true },
  interviewType: { type: String, enum: ["oral", "coding"], required: true },
  status: { type: String, enum: ["assigned", "in-progress", "completed", "expired"], default: "assigned", index: true },
  durationMinutes: { type: Number, min: 5, max: 30, required: true },
  startedAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  resume: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", default: null },
  questionsAsked: { type: [String], default: [] },
  answers: { type: [answerSchema], default: [] },
  transcript: { type: [transcriptSchema], default: [] },
  submissions: { type: [submissionSchema], default: [] },
  report: { type: mongoose.Schema.Types.Mixed, default: null },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true, versionKey: false });
export default mongoose.model("Interview", interviewSchema);
