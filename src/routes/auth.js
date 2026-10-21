import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "../utils/httpError.js";
import { authenticate } from "../middleware/auth.js";
const router = Router();

function tokenFor(user) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  return jwt.sign({ sub: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "1d" });
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

router.get("/me", authenticate, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ success: true, user: publicUser(user) });
}));
export default router;
