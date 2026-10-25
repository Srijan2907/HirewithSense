import { afterAll, beforeAll } from 'vitest';
import { applyTestEnv } from './env.js';

applyTestEnv();

beforeAll(async () => {
  const { loadEnv } = await import('../src/config/env.js');
  loadEnv();
});

afterAll(async () => {
  const { closeDb } = await import('../src/db/client.js');
  await closeDb();
});
