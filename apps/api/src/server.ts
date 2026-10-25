import { loadEnv } from './config/env.js';
import { buildApp } from './app.js';
import { closeDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';

async function main() {
  const e = loadEnv();
  if (e.RUN_MIGRATIONS_ON_BOOT === 'true') {
    await runMigrations();
  }
  const app = await buildApp();
  const { startJobs, stopJobs } = await import('./jobs/index.js');
  if (!e.DISABLE_JOBS) await startJobs(app);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), 15_000).unref();
    try {
      await app.close();
      await stopJobs();
      await closeDb();
    } finally {
      clearTimeout(timer);
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => app.log.error({ err: reason }, 'unhandled rejection'));

  await app.listen({ port: e.PORT, host: e.HOST });
  app.log.info(`API docs at http://localhost:${e.PORT}/docs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
