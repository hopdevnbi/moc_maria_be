// Ephemeral PostgreSQL in Mộc Maria namespace, reached through an encrypted SSH tunnel.
// Does not read production DB credentials or create fixtures in the production database.
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const argon2 = require('argon2');
const sshBase = ['-p', '8686', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
const host = 'root@163.128.42.101';
const kubectl = 'kubectl --kubeconfig=/etc/kubernetes/admin.conf -n moc-maria';
const suffix = randomBytes(4).toString('hex');
const name = 'moc-maria-qa-' + suffix;
const password = randomBytes(40).toString('base64url');
const port = Number(process.env.QA_LOCAL_PORT || 15432);
const remotePort = port + 10000;
const url = `postgresql://qa:${password}@127.0.0.1:${port}/moc_maria_qa`;
let tunnel;
const servers = [];
let browserFixtureFile;
function remote(command, input) {
  const result = spawnSync('ssh', [...sshBase, host, command], {
    input,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('QA infrastructure command failed');
  return result.stdout;
}
function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const redact = (input) =>
      input
        .replaceAll(password, '[REDACTED]')
        .replaceAll(env.JWT_ACCESS_SECRET, '[REDACTED]')
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[DATABASE_URL]')
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[TOKEN]');
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', () => reject(new Error('QA test process failed to start')));
    child.on('exit', (code) => {
      const summary = output.split(/\r?\n/).filter((line) => !line.startsWith('query:'));
      console.log(redact(summary.join('\n')).slice(-16000));
      code === 0 ? resolve() : reject(new Error('QA test process failed'));
    });
  });
}
async function main() {
  if (!Number.isInteger(port) || port < 1024 || remotePort > 65535)
    throw new Error('Invalid QA port');
  const items = [
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name, namespace: 'moc-maria' },
      type: 'Opaque',
      stringData: { password },
    },
    {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name, namespace: 'moc-maria', labels: { app: name, purpose: 'integration-qa' } },
      spec: {
        restartPolicy: 'Never',
        terminationGracePeriodSeconds: 5,
        containers: [
          {
            name: 'postgres',
            image: 'postgres:16-alpine',
            env: [
              { name: 'POSTGRES_DB', value: 'moc_maria_qa' },
              { name: 'POSTGRES_USER', value: 'qa' },
              { name: 'POSTGRES_PASSWORD', valueFrom: { secretKeyRef: { name, key: 'password' } } },
            ],
            resources: {
              requests: { cpu: '50m', memory: '128Mi' },
              limits: { cpu: '500m', memory: '256Mi' },
            },
            readinessProbe: {
              exec: { command: ['pg_isready', '-U', 'qa', '-d', 'moc_maria_qa'] },
              initialDelaySeconds: 3,
              periodSeconds: 2,
            },
            volumeMounts: [{ name: 'database', mountPath: '/var/lib/postgresql/data' }],
          },
        ],
        volumes: [{ name: 'database', emptyDir: { sizeLimit: '512Mi' } }],
      },
    },
  ];
  try {
    remote(
      kubectl + ' apply --server-side --field-manager=moc-maria-qa -f -',
      JSON.stringify({ apiVersion: 'v1', kind: 'List', items }),
    );
    console.log('Isolated QA database created; production database untouched.');
    remote(kubectl + ` wait --for=condition=Ready pod/${name} --timeout=120s`);
    tunnel = spawn(
      'ssh',
      [
        ...sshBase,
        '-o',
        'ExitOnForwardFailure=yes',
        '-L',
        `127.0.0.1:${port}:127.0.0.1:${remotePort}`,
        host,
        kubectl + ` port-forward --address=127.0.0.1 pod/${name} ${remotePort}:5432`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    let connected = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const client = new Client({
        connectionString: url,
        ssl: false,
        connectionTimeoutMillis: 1000,
      });
      try {
        await client.connect();
        connected = true;
        await client.end();
        break;
      } catch {
        await client.end().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!connected) throw new Error('Isolated QA tunnel not ready');
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: url,
      DATABASE_MIGRATION_URL: url,
      DATABASE_SSL: 'false',
      DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
      DATABASE_POOL_MAX: '3',
      JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
      AUTH_COOKIE_SECURE: 'false',
      AUTH_COOKIE_DOMAIN: '',
      CORS_ORIGINS: 'http://localhost:3001',
      SWAGGER_ENABLED: 'false',
    };
    await runNode(
      [
        '-r',
        'ts-node/register',
        '-r',
        'tsconfig-paths/register',
        require.resolve('typeorm/cli.js'),
        'migration:run',
        '-d',
        'src/database/data-source.ts',
      ],
      env,
    );
    await runNode(
      [require.resolve('jest/bin/jest'), '--config', 'test/jest-e2e.json', '--runInBand'],
      env,
    );
    console.log('Isolated migrations and complete integration suite PASS.');
    if (process.env.QA_BROWSER === 'true') {
      const feDirectory = process.env.QA_FE_WORKDIR;
      if (!feDirectory || !fs.existsSync(path.join(feDirectory, 'node_modules/next/dist/bin/next')))
        throw new Error('QA browser frontend directory is unavailable');
      const browserPassword = randomBytes(32).toString('base64url') + '1!';
      const email = `browser-admin-${suffix}@mocmaria.test`;
      const client = new Client({ connectionString: url, ssl: false });
      await client.connect();
      try {
        const created = await client.query(
          'INSERT INTO users(email,display_name,password_hash,is_active,must_change_password) VALUES($1,$2,$3,true,false) RETURNING id',
          [email, 'Isolated QA administrator', await argon2.hash(browserPassword)],
        );
        await client.query(
          'INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2',
          [created.rows[0].id, 'SUPER_ADMIN'],
        );
      } finally {
        await client.end();
      }
      const apiServer = spawn(
        process.execPath,
        [
          '-e',
          "const {NestFactory}=require('@nestjs/core'); const {AppModule}=require('./dist/app.module'); const {configureApplication}=require('./dist/bootstrap/configure-application'); (async()=>{const app=await NestFactory.create(AppModule,{logger:false}); configureApplication(app); await app.listen(3002,'127.0.0.1');})().catch(()=>process.exit(1));",
        ],
        {
          env: { ...env, PORT: '3002', CORS_ORIGINS: 'http://localhost:3016' },
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      servers.push(apiServer);
      const frontend = spawn(
        process.execPath,
        [
          path.join(feDirectory, 'node_modules/next/dist/bin/next'),
          'dev',
          '--hostname',
          '127.0.0.1',
          '-p',
          '3016',
        ],
        {
          cwd: feDirectory,
          env: {
            ...process.env,
            NODE_ENV: 'development',
            NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3002/api/v1',
            NEXT_PUBLIC_SITE_URL: 'http://localhost:3016',
          },
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      servers.push(frontend);
      browserFixtureFile = path.join(os.tmpdir(), name + '-browser.json');
      fs.writeFileSync(
        browserFixtureFile,
        JSON.stringify({ email, password: browserPassword, url: 'http://localhost:3016' }),
        { mode: 0o600 },
      );
      console.log(
        'Isolated browser QA servers started; fixture credential file: ' + browserFixtureFile,
      );
      console.log('Send Ctrl+C to stop browser QA and remove its database/credential file.');
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 30 * 60 * 1000);
        process.once('SIGINT', () => {
          clearTimeout(timer);
          resolve();
        });
        process.once('SIGTERM', () => {
          clearTimeout(timer);
          resolve();
        });
        apiServer.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        frontend.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  } finally {
    for (const server of servers) server.kill();
    if (browserFixtureFile) fs.rmSync(browserFixtureFile, { force: true });
    if (tunnel) tunnel.kill();
    remote(kubectl + ` delete pod/${name} secret/${name} --ignore-not-found --wait=false`);
    console.log('Isolated QA pod and secret removed.');
  }
}
main().catch(() => {
  console.error('ISOLATED_INTEGRATION_FAILED; sensitive diagnostics suppressed');
  process.exitCode = 1;
});
