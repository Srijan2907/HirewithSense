import mongoose from "mongoose";
const questionSchema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, index: true },
  type: { type: String, enum: ["oral", "coding"], required: true },
  prompt: { type: String, required: true, maxlength: 5000 },
  expectedSignals: { type: [String], default: [] },
  difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
  order: { type: Number, default: 0 },
  starterCode: { type: String, default: "" },
  languageIds: { type: [Number], default: [63] },
  testCases: { type: [{ input: String, expectedOutput: String, hidden: { type: Boolean, default: false } }], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true, versionKey: false });
export default mongoose.model("Question", questionSchema);
