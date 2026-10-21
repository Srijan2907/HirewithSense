import mongoose from "mongoose";
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  username: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 30, match: /^[a-z0-9_.-]+$/ },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["user", "admin"], default: "user", immutable: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });
userSchema.index({ username: 1 }, { unique: true });
export default mongoose.model("User", userSchema);
