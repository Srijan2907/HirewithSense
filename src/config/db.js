import mongoose from "mongoose";

export async function connectDB() {
  if (!process.env.MONGO_URL) throw new Error("MONGO_URL is required");
  await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 });
  console.log("MongoDB connected");
}
