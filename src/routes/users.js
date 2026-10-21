import { Router } from "express";
import User from "../models/User.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError } from "../utils/httpError.js";
const router = Router();
router.use(authenticate);
router.get("/me", asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ success: true, user: { id: String(user._id), name: user.name, username: user.username, email: user.email, role: user.role } });
}));
router.patch("/me", asyncHandler(async (req, res) => {
  const updates = {};
  if (typeof req.body.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
  if (typeof req.body.username === "string") {
    const username = req.body.username.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(username)) throw httpError(400, "Invalid username");
    if (await User.findOne({ username, _id: { $ne: req.user.id } })) throw httpError(409, "Username already exists");
    updates.username = username;
  }
  const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true, runValidators: true });
  res.json({ success: true, user: { id: String(user._id), name: user.name, username: user.username, email: user.email, role: user.role } });
}));
export default router;
