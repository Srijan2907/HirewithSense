import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "../utils/httpError.js";
import { authenticate } from "../middleware/auth.js";
import { isEmailConfigured, sendPasswordResetEmail } from "../services/emailService.js";
const router = Router();

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
});
const RESET_RESPONSE = "If an account exists for that email, password reset instructions will be sent.";
const hashResetToken = (token) => createHash("sha256").update(token).digest("hex");

function tokenFor(user) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  return jwt.sign({ sub: String(user._id), role: user.role, ver: user.tokenVersion || 0 }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "1d" });
}
const publicUser = (u) => ({ id: String(u._id), name: u.name, username: u.username, email: u.email, role: u.role });

router.post("/register", asyncHandler(async (req, res) => {
  const { name, username, email, password } = req.body;
  if (![name, username, email, password].every((v) => typeof v === "string" && v.trim())) throw httpError(400, "name, username, email and password are required");
  if (password.length < 10 || password.length > 128) throw httpError(400, "Password must be 10-128 characters");
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) throw httpError(400, "Username must be 3-30 characters using letters, numbers, _, . or -");
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw httpError(400, "Valid email is required");
  if (await User.findOne({ $or: [{ email: normalizedEmail }, { username: username.toLowerCase() }] })) throw httpError(409, "Email or username is already registered");
  const user = await User.create({ name: name.trim(), username: username.toLowerCase(), email: normalizedEmail, passwordHash: await bcrypt.hash(password, 12), role: "user" });
  res.status(201).json({ success: true, user: publicUser(user), token: tokenFor(user) });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw httpError(401, "Invalid email or password");
  res.json({ success: true, user: publicUser(user), token: tokenFor(user) });
}));

router.post("/forgot-password", passwordResetLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Valid email is required");
  if (!isEmailConfigured()) throw httpError(503, "Password reset email is not configured");

  const user = await User.findOne({ email });
  if (user) {
    const resetToken = randomBytes(32).toString("hex");
    user.passwordResetTokenHash = hashResetToken(resetToken);
    user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    try {
      await sendPasswordResetEmail({ email: user.email, name: user.name, token: resetToken });
    } catch (error) {
      user.passwordResetTokenHash = undefined;
      user.passwordResetExpiresAt = undefined;
      await user.save();
      throw error;
    }
  }
  res.json({ success: true, message: RESET_RESPONSE });
}));

router.post("/reset-password", passwordResetLimiter, asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) throw httpError(400, "A valid reset token is required");
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw httpError(400, "Password must be 10-128 characters");
  }

  const resetTokenHash = hashResetToken(token);
  const tokenFilter = {
    passwordResetTokenHash: resetTokenHash,
    passwordResetExpiresAt: { $gt: new Date() }
  };
  const user = await User.findOne(tokenFilter).select("_id");
  if (!user) throw httpError(400, "Reset token is invalid or expired");

  const passwordHash = await bcrypt.hash(password, 12);
  const update = await User.updateOne(
    { _id: user._id, ...tokenFilter },
    {
      $set: { passwordHash },
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
      $inc: { tokenVersion: 1 }
    }
  );
  if (!update.modifiedCount) throw httpError(400, "Reset token is invalid or expired");
  res.json({ success: true, message: "Password has been reset. Please log in again." });
}));

router.get("/me", authenticate, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ success: true, user: publicUser(user) });
}));
export default router;
