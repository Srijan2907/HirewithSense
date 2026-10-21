import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../server.js";

test("health endpoint returns service status", async () => {
  const response = await request(app).get("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
});

test("unknown routes return JSON 404", async () => {
  const response = await request(app).get("/api/does-not-exist");
  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
});
