export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://hws:hws@localhost:5433/hirewithsense_test',
  JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
  ACCESS_TOKEN_TTL_SECONDS: '900',
  DISABLE_JOBS: 'true',
  EMAIL_TRANSPORT: 'outbox',
  AI_PROVIDER: 'mock',
  CODE_RUNNER: process.env.TEST_CODE_RUNNER ?? 'none',
  UPLOAD_DIR: './.tmp/test-uploads',
  RUN_MIGRATIONS_ON_BOOT: 'false',
  COOKIE_SECURE: 'false',
  RATE_LIMIT_ENABLED: 'false',
};
export function applyTestEnv() {
  for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
}
