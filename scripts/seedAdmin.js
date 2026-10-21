import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../src/models/User.js";

const { MONGO_URL, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!MONGO_URL || !ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Set MONGO_URL, ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 12) {
  console.error("ADMIN_PASSWORD must be at least 12 characters");
  process.exit(1);
}
try {
  await mongoose.connect(MONGO_URL);
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`Account already exists for ${email}; no changes made.`);
  } else {
    const username = `admin_${email.split("@")[0].replace(/[^a-z0-9_.-]/g, "").slice(0, 20) || "root"}`;
    const user = await User.create({
      name: ADMIN_NAME.trim(), username,
      email, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), role: "admin"
    });
    console.log(`Admin created: ${user.email} (${user.username}).`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
