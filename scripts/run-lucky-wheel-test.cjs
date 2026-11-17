// Disposable local PostgreSQL only; the TypeScript test enforces loopback *_test.
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const result = spawnSync(process.execPath, ['-r', 'ts-node/register', 'scripts/test-lucky-wheel.ts'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', SWAGGER_ENABLED: 'false', DATABASE_SSL: 'false', JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'), MOC_MARIA_WHEEL_ENABLED: 'true', MOC_MARIA_WHEEL_RESULT_KEY: randomBytes(32).toString('base64url') },
});
process.exitCode = result.status ?? 1;
