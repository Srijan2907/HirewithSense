import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { httpError } from "../utils/httpError.js";

export async function authenticate(req, _res, next) {
  try {
    const [scheme, token] = (req.headers.authorization || "").split(" ");
    if (scheme !== "Bearer" || !token) throw httpError(401, "Authentication required");
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).select("_id name username email role");
    if (!user) throw httpError(401, "Account no longer exists");
    req.user = { id: String(user._id), name: user.name, username: user.username, email: user.email, role: user.role };
    next();
  } catch (error) {
    next(error.statusCode ? error : httpError(401, "Invalid or expired token"));
  }
}
export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(httpError(403, "Insufficient permissions"));
    next();
  };
}
