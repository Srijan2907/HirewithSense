import { httpError } from "./httpError.js";

export function requireOwnerOrAdmin(resourceUserId, currentUser) {
  if (currentUser.role !== "admin" && String(resourceUserId) !== String(currentUser.id)) {
    throw httpError(403, "You do not have permission to access this resource");
  }
}

export function assertInterviewActive(interview) {
  if (!interview || interview.status !== "in-progress") {
    throw httpError(409, "Interview is not in progress");
  }
  if (Date.now() >= new Date(interview.endsAt).getTime()) {
    throw httpError(410, "Interview time limit has expired. Finish the interview to view your report.");
  }
}
