import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { closeDb, getDb } from './client.js';

/** Resolve the migrations folder both from source (tsx) and from the bundled dist build. */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../drizzle'),
    path.resolve(here, '../drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'meta', '_journal.json'))) return c;
  }
  throw new Error('Could not locate drizzle migrations folder');
}

export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: migrationsFolder() });
}

const invokedDirectly = process.argv[1] ? /migrate\.(ts|js)$/.test(process.argv[1]) : false;
if (invokedDirectly) {
  loadEnv();
  runMigrations()
    .then(() => console.log('Migrations applied'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
