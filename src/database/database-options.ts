import type { DataSourceOptions } from 'typeorm';

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid numeric environment value: ' + value);
  }
  return parsed;
}

export function buildDatabaseOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  useMigrationUrl = false,
): DataSourceOptions {
  const runtimeUrl = env['DATABASE_URL']?.trim();
  const migrationUrl = env['DATABASE_MIGRATION_URL']?.trim();
  const connectionUrl = useMigrationUrl ? migrationUrl || runtimeUrl : runtimeUrl;

  const sslEnabled = readBoolean(env['DATABASE_SSL'], true);
  const rejectUnauthorized = readBoolean(env['DATABASE_SSL_REJECT_UNAUTHORIZED'], true);
  const poolMax = readNumber(env['DATABASE_POOL_MAX'], 10);

  const common: DataSourceOptions = {
    type: 'postgres',
    synchronize: false,
    migrationsRun: false,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    ssl: sslEnabled ? { rejectUnauthorized } : false,
    extra: {
      max: poolMax,
      application_name: 'moc-maria-api',
    },
  };

  if (connectionUrl) {
    return {
      ...common,
      url: connectionUrl,
    };
  }

  const host = env['DATABASE_HOST']?.trim();
  const password = env['DATABASE_PASSWORD'] ?? '';
  if (!host) {
    throw new Error('DATABASE_HOST or DATABASE_URL is required.');
  }
  if (!password) {
    throw new Error('DATABASE_PASSWORD is required when DATABASE_URL is not set.');
  }

  return {
    ...common,
    host,
    port: readNumber(env['DATABASE_PORT'], 5432),
    database: env['DATABASE_NAME']?.trim() || 'postgres',
    username: env['DATABASE_USER']?.trim() || 'postgres',
    password,
  };
}
