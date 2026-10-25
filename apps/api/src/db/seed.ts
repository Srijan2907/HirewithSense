/**
 * Demo seed: one organization with a recruiter, two jobs (one fully configured with questions and
 * coding problems), and a candidate with a pending invitation. Safe to re-run: it skips when the
 * demo organization already exists.
 *
 *   pnpm db:seed
 *
 * Accounts (password for all: DemoPassword123!)
 *   recruiter@demo.hirewithsense.local   (owner of "Northwind Labs")
 *   candidate@demo.hirewithsense.local   (candidate with a ready-to-start interview)
 */
import { eq } from 'drizzle-orm';
import { DEFAULT_COMPETENCIES } from '@hws/shared';
import { loadEnv } from '../config/env.js';
import { closeDb, getDb } from './client.js';
import { codingProblems, interviewInvites, interviews, jobs, memberships, organizations, questions, users } from './schema.js';
import { hashPassword, randomToken, sha256 } from '../lib/crypto.js';
import { addDays } from '../lib/util.js';
import { sectionsFromPlan } from '../modules/interviews/service.js';

const PASSWORD = 'DemoPassword123!';

async function main() {
  loadEnv();
  const db = getDb();
  const [existing] = await db.select().from(organizations).where(eq(organizations.slug, 'northwind-labs')).limit(1);
  if (existing) {
    console.log('Demo data already present; nothing to do.');
    return;
  }
  const passwordHash = await hashPassword(PASSWORD);
  const [org] = await db.insert(organizations).values({ name: 'Northwind Labs', slug: 'northwind-labs', website: 'https://northwind.example', retentionDays: 365 }).returning();
  const [recruiter] = await db.insert(users).values({ name: 'Riya Recruiter', username: 'riya', email: 'recruiter@demo.hirewithsense.local', passwordHash, role: 'recruiter', emailVerifiedAt: new Date() }).returning();
  await db.insert(memberships).values({ organizationId: org!.id, userId: recruiter!.id, role: 'owner' });
  const [candidate] = await db.insert(users).values({ name: 'Arjun Candidate', username: 'arjun', email: 'candidate@demo.hirewithsense.local', passwordHash, role: 'candidate', emailVerifiedAt: new Date(), headline: 'Backend engineer, 3 years' }).returning();

  const [job] = await db
    .insert(jobs)
    .values({
      organizationId: org!.id,
      title: 'Backend Engineer (Node.js)',
      slug: 'backend-engineer-node-js',
      department: 'Engineering',
      location: 'Remote (India)',
      employmentType: 'full_time',
      seniority: 'mid',
      description: `We are hiring a backend engineer to build and operate the services behind our logistics platform.\n\nYou will design REST APIs in Node.js and TypeScript, model data in PostgreSQL, ship with CI/CD to Kubernetes, and own reliability for your services. We value clear communication, pragmatic trade-offs and a habit of measuring before optimising.\n\nMust-have: 2+ years with Node.js, SQL, HTTP APIs. Nice-to-have: event streaming, observability, cloud infrastructure.`,
      skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'REST', 'Docker', 'Kubernetes'],
      status: 'open',
      competencies: DEFAULT_COMPETENCIES,
      interviewPlan: { sections: [], graceSeconds: 15, completionWindowDays: 7 },
      minimumScore: 65,
      createdBy: recruiter!.id,
    })
    .returning();

  await db.insert(questions).values([
    { jobId: job!.id, prompt: 'Walk me through a backend system you built or significantly changed. What was the hardest design decision and why?', competencyKey: 'project_depth', difficulty: 'medium', expectedSignals: ['trade-offs', 'alternatives considered', 'measurable outcome'], followUpHints: ['Ask what they would do differently today'], order: 1, createdBy: recruiter!.id },
    { jobId: job!.id, prompt: 'A production API suddenly returns 5xx errors for 10% of requests. Describe, step by step, how you would investigate and resolve it.', competencyKey: 'problem_solving', difficulty: 'medium', expectedSignals: ['logs/metrics/traces', 'recent deploys', 'rollback', 'root cause', 'postmortem'], followUpHints: [], order: 2, createdBy: recruiter!.id },
    { jobId: job!.id, prompt: 'How would you design the database schema and indexes for an order-tracking service that must answer "all orders for a customer in a date range" quickly?', competencyKey: 'technical_knowledge', difficulty: 'hard', expectedSignals: ['composite index', 'normalisation', 'pagination', 'query plan'], followUpHints: ['Probe about write amplification'], order: 3, createdBy: recruiter!.id },
  ]);

  const [p1] = await db
    .insert(codingProblems)
    .values({
      jobId: job!.id,
      title: 'Merge overlapping intervals',
      statement: `You are given N intervals. Merge all overlapping intervals and print the result sorted by start.\n\n**Input**\nThe first line contains an integer N (1 ≤ N ≤ 10^5). Each of the next N lines contains two integers \`start end\` (0 ≤ start ≤ end ≤ 10^9).\n\n**Output**\nPrint the merged intervals, one per line, as \`start end\`.\n\n**Example**\n\`\`\`\n3\n1 3\n2 6\n8 10\n\`\`\`\nOutput:\n\`\`\`\n1 6\n8 10\n\`\`\``,
      difficulty: 'medium',
      languageIds: ['javascript', 'typescript', 'python', 'cpp', 'java', 'go'],
      starterCode: {
        javascript: "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst n = Number(lines[0]);\nconst intervals = lines.slice(1, n + 1).map((l) => l.trim().split(/\\s+/).map(Number));\n\n// TODO: merge and print\n",
        python: 'import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    n = int(data[0])\n    intervals = [(int(data[1 + 2*i]), int(data[2 + 2*i])) for i in range(n)]\n    # TODO: merge and print\n\nmain()\n',
        cpp: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){int n;cin>>n;vector<pair<long long,long long>> v(n);for(auto&p:v)cin>>p.first>>p.second;\n// TODO\n}\n',
      },
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      tags: ['arrays', 'sorting'],
      testCases: [
        { input: '3\n1 3\n2 6\n8 10\n', expectedOutput: '1 6\n8 10\n', isSample: true, weight: 1, label: 'Example' },
        { input: '1\n5 5\n', expectedOutput: '5 5\n', isSample: true, weight: 1, label: 'Single point' },
        { input: '4\n1 4\n4 5\n0 0\n6 7\n', expectedOutput: '0 0\n1 5\n6 7\n', isSample: false, weight: 2, label: 'Touching intervals' },
        { input: '5\n1 10\n2 3\n4 5\n6 7\n8 9\n', expectedOutput: '1 10\n', isSample: false, weight: 2, label: 'Nested' },
        { input: '6\n10 12\n1 2\n3 4\n5 6\n7 8\n9 10\n', expectedOutput: '1 2\n3 4\n5 6\n7 8\n9 12\n', isSample: false, weight: 3, label: 'Unsorted input' },
      ],
      createdBy: recruiter!.id,
    })
    .returning();

  const [p2] = await db
    .insert(codingProblems)
    .values({
      jobId: job!.id,
      title: 'Rate limiter window',
      statement: `Implement a fixed-window rate limiter check.\n\n**Input**\nFirst line: two integers \`limit window\` (requests allowed per window of \`window\` seconds). Second line: integer M. Then M lines each with \`timestamp clientId\` in non-decreasing timestamp order.\n\n**Output**\nFor each request print \`ALLOW\` or \`DENY\`. A request is allowed if the client has made fewer than \`limit\` allowed requests in the current window \`[floor(t / window) * window, +window)\`.\n\n**Example**\n\`\`\`\n2 10\n4\n1 a\n2 a\n3 a\n11 a\n\`\`\`\nOutput:\n\`\`\`\nALLOW\nALLOW\nDENY\nALLOW\n\`\`\``,
      difficulty: 'easy',
      languageIds: ['javascript', 'typescript', 'python', 'cpp', 'java', 'go'],
      starterCode: {
        javascript: "const lines = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\n// TODO\n",
        python: 'import sys\nlines = sys.stdin.read().strip().split("\\n")\n# TODO\n',
      },
      timeLimitMs: 2000,
      memoryLimitMb: 256,
      tags: ['hash map', 'simulation'],
      testCases: [
        { input: '2 10\n4\n1 a\n2 a\n3 a\n11 a\n', expectedOutput: 'ALLOW\nALLOW\nDENY\nALLOW\n', isSample: true, weight: 1, label: 'Example' },
        { input: '1 5\n4\n0 x\n1 y\n2 x\n5 x\n', expectedOutput: 'ALLOW\nALLOW\nDENY\nALLOW\n', isSample: false, weight: 2, label: 'Two clients' },
        { input: '3 1\n3\n0 a\n0 a\n0 a\n', expectedOutput: 'ALLOW\nALLOW\nALLOW\n', isSample: false, weight: 1, label: 'Exactly at limit' },
      ],
      createdBy: recruiter!.id,
    })
    .returning();

  const plan = {
    sections: [
      { type: 'conversation' as const, title: 'Conversation with the AI interviewer', durationMinutes: 20, questionCount: 6, allowGeneratedQuestions: true },
      { type: 'coding' as const, title: 'Coding round', durationMinutes: 40, problemIds: [p1!.id, p2!.id], languageIds: ['javascript', 'typescript', 'python', 'cpp'] as const },
    ],
    graceSeconds: 15,
    completionWindowDays: 7,
  };
  await db.update(jobs).set({ interviewPlan: plan as any }).where(eq(jobs.id, job!.id));

  await db.insert(jobs).values({
    organizationId: org!.id,
    title: 'Frontend Engineer (React)',
    slug: 'frontend-engineer-react',
    department: 'Engineering',
    location: 'Bengaluru',
    employmentType: 'full_time',
    seniority: 'junior',
    description: 'Build accessible, fast interfaces in React and TypeScript for our customer portal. You will work closely with design and backend engineers, own component quality, and care about performance budgets and accessibility.',
    skills: ['React', 'TypeScript', 'CSS', 'Testing'],
    status: 'draft',
    competencies: [
      { key: 'technical_knowledge', label: 'Technical knowledge', description: 'React, TypeScript, browser fundamentals.', weight: 35 },
      { key: 'problem_solving', label: 'Problem solving', description: 'Decomposes UI problems; reasons about state and data flow.', weight: 30 },
      { key: 'communication', label: 'Communication', description: 'Explains decisions clearly.', weight: 20 },
      { key: 'project_depth', label: 'Project depth', description: 'Depth on own projects.', weight: 15 },
      { key: 'coding_correctness', label: 'Coding correctness', description: 'From tests.', weight: 0 },
    ],
    interviewPlan: { sections: [{ type: 'conversation', title: 'Conversation', durationMinutes: 25, questionCount: 6, allowGeneratedQuestions: true }], graceSeconds: 15, completionWindowDays: 7 },
    minimumScore: 60,
    createdBy: recruiter!.id,
  });

  // A ready-to-start interview for the demo candidate.
  const token = randomToken();
  const [invite] = await db.insert(interviewInvites).values({ jobId: job!.id, organizationId: org!.id, email: candidate!.email, candidateName: candidate!.name, message: 'Looking forward to learning about your backend work!', tokenHash: sha256(token), status: 'accepted', acceptedAt: new Date(), expiresAt: addDays(new Date(), 14), invitedBy: recruiter!.id }).returning();
  const [interview] = await db.insert(interviews).values({ jobId: job!.id, organizationId: org!.id, candidateId: candidate!.id, inviteId: invite!.id, status: 'ready', plan: plan as any, sections: sectionsFromPlan(plan as any), completeBy: addDays(new Date(), 7) }).returning();
  await db.update(interviewInvites).set({ interviewId: interview!.id }).where(eq(interviewInvites.id, invite!.id));

  console.log('Seeded demo data.');
  console.log(`  Recruiter: recruiter@demo.hirewithsense.local / ${PASSWORD}`);
  console.log(`  Candidate: candidate@demo.hirewithsense.local / ${PASSWORD}`);
  console.log(`  Interview ready to start: ${interview!.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
