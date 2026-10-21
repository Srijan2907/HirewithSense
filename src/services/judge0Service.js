import { setTimeout as delay } from "node:timers/promises";
import { httpError } from "../utils/httpError.js";

function config() {
  if (!process.env.JUDGE0_BASE_URL) throw httpError(503, "Judge0 is not configured");
  const headers = { "content-type": "application/json" };
  if (process.env.JUDGE0_API_KEY) headers["X-RapidAPI-Key"] = process.env.JUDGE0_API_KEY;
  if (process.env.JUDGE0_AUTH_TOKEN) headers["X-Auth-Token"] = process.env.JUDGE0_AUTH_TOKEN;
  if (process.env.JUDGE0_API_HOST) headers["X-RapidAPI-Host"] = process.env.JUDGE0_API_HOST;
  return { base: process.env.JUDGE0_BASE_URL.replace(/\/$/, ""), headers };
}
export async function executeCode({ sourceCode, languageId, stdin = "", expectedOutput }) {
  const { base, headers } = config();
  const response = await fetch(`${base}/submissions?base64_encoded=false&wait=false`, {
    method: "POST",
    headers,
    body: JSON.stringify({ source_code: sourceCode, language_id: languageId, stdin, expected_output: expectedOutput })
  });
  if (!response.ok) throw httpError(502, `Judge0 submission failed (${response.status})`);
  const { token } = await response.json();
  if (!token) throw httpError(502, "Judge0 did not return a submission token");

  const interval = Math.max(300, Number(process.env.JUDGE0_POLL_INTERVAL_MS || 1000));
  const maxPolls = Math.max(1, Math.min(30, Number(process.env.JUDGE0_MAX_POLLS || 15)));
  let result;
  for (let i = 0; i < maxPolls; i++) {
    await delay(interval);
    const poll = await fetch(`${base}/submissions/${encodeURIComponent(token)}?base64_encoded=false`, { headers });
    if (!poll.ok) throw httpError(502, `Judge0 polling failed (${poll.status})`);
    result = await poll.json();
    if (result.status?.id > 2) break;
  }
  if (!result || result.status?.id <= 2) {
    return { status: "processing", token, stdout: "", stderr: "", compileOutput: "", time: null, memory: null, passed: false };
  }
  return {
    status: result.status?.description || "Unknown",
    token,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    compileOutput: result.compile_output || "",
    time: result.time ?? null,
    memory: result.memory ?? null,
    passed: result.status?.id === 3
  };
}
