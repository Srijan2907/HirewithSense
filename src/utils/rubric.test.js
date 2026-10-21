import test from "node:test";
import assert from "node:assert/strict";
import { validateRubric, calculateWeightedScore } from "./rubric.js";
import { requireOwnerOrAdmin } from "./permissions.js";

test("accepts rubric weights totaling 100", () => {
  assert.deepEqual(validateRubric({ technicalKnowledge: 60, communication: 40 }), { technicalKnowledge: 60, communication: 40 });
});
test("rejects rubric weights not totaling 100", () => {
  assert.throws(() => validateRubric({ technicalKnowledge: 50, communication: 30 }), /total 100/);
});
test("calculates weighted score", () => {
  assert.equal(calculateWeightedScore({ technicalKnowledge: 70, communication: 30 }, { technicalKnowledge: 80, communication: 60 }), 74);
});
test("candidate cannot access another candidate's resource", () => {
  assert.throws(() => requireOwnerOrAdmin("candidate-a", { id: "candidate-b", role: "user" }), /permission/);
});
test("admin can access candidate resource", () => {
  assert.doesNotThrow(() => requireOwnerOrAdmin("candidate-a", { id: "admin-1", role: "admin" }));
});
