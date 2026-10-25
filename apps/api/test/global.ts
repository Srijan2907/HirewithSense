import { applyTestEnv } from './env.js';

export default async function setup() {
  applyTestEnv();
  const { loadEnv } = await import('../src/config/env.js');
  loadEnv();
  const { runMigrations } = await import('../src/db/migrate.js');
  const { closeDb } = await import('../src/db/client.js');
  await runMigrations();
  await closeDb();
}
