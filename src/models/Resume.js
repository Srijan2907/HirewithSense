import mongoose from "mongoose";
const resumeSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  originalName: { type: String, required: true },
  storagePath: { type: String, required: true },
  mimeType: { type: String, required: true },
  extractedText: { type: String, default: "" },
  parsed: {
    summary: { type: String, default: "" },
    skills: { type: [String], default: [] },
    experience: { type: [mongoose.Schema.Types.Mixed], default: [] },
    projects: { type: [mongoose.Schema.Types.Mixed], default: [] },
    education: { type: [mongoose.Schema.Types.Mixed], default: [] },
    rawModelOutput: { type: mongoose.Schema.Types.Mixed, default: null }
  }
}, { timestamps: true, versionKey: false });
export default mongoose.model("Resume", resumeSchema);
