// Restore only into a newly-created disposable database, never a production connection.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const dump = fs.readFileSync(process.argv[2]);
if (dump.subarray(0, 5).toString() !== 'PGDMP') throw new Error('Invalid PostgreSQL backup');
const name = 'moc-maria-restore-qa-' + randomBytes(4).toString('hex');
const password = randomBytes(32).toString('base64url');
const kubectl = 'kubectl --kubeconfig=/etc/kubernetes/admin.conf -n moc-maria';
function remote(command, input) {
  const result = spawnSync('ssh', ['-p', '8686', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    'root@163.128.42.101', command], { input, encoding: 'utf8', windowsHide: true, maxBuffer: 1000000 });
  if (result.status !== 0) throw new Error('Isolated restore step failed; diagnostic data suppressed');
  return result.stdout;
}
try {
  const objects = [
    { apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace: 'moc-maria' },
      stringData: { password }, type: 'Opaque' },
    { apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: 'moc-maria', labels: { purpose: 'restore-qa' } },
      spec: { restartPolicy: 'Never', terminationGracePeriodSeconds: 5,
        securityContext: { runAsUser: 70, runAsGroup: 70, fsGroup: 70 },
        containers: [{ name: 'postgres', image: 'postgres:17-alpine',
          env: [{ name: 'POSTGRES_DB', value: 'moc_maria_restore_qa' }, { name: 'POSTGRES_USER', value: 'qa' },
            { name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' },
            { name: 'POSTGRES_PASSWORD', valueFrom: { secretKeyRef: { name, key: 'password' } } }],
          resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '300m', memory: '256Mi' } },
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } },
          readinessProbe: { exec: { command: ['pg_isready', '-U', 'qa', '-d', 'moc_maria_restore_qa'] }, periodSeconds: 2 },
          volumeMounts: [{ name: 'db', mountPath: '/var/lib/postgresql/data' }] }],
        volumes: [{ name: 'db', emptyDir: { sizeLimit: '512Mi' } }] } },
  ];
  remote(kubectl + ' apply -f -', JSON.stringify({ apiVersion: 'v1', kind: 'List', items: objects }));
  remote(kubectl + ' wait --for=condition=Ready pod/' + name + ' --timeout=90s');
  remote(kubectl + ' exec -i ' + name + ' -- pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -U qa -d moc_maria_restore_qa', dump);
  const verified = remote(kubectl + ' exec ' + name + ' -- psql -U qa -d moc_maria_restore_qa -At -c ' +
    '"SELECT count(*) FROM migrations; SELECT count(*) FROM roles; SELECT count(*) FROM permissions; SELECT count(*) FROM information_schema.tables WHERE table_schema=\x27public\x27;"');
  const [migrations, roles, permissions, tables] = verified.trim().split(/\s+/).map(Number);
  if (!migrations || roles < 7 || !permissions || tables < 20) throw new Error('Restore verification failed');
  console.log(JSON.stringify({ restore: 'PASS', migrations, roles, permissions, tables,
    backupSha256: createHash('sha256').update(dump).digest('hex') }));
} finally {
  remote(kubectl + ' delete pod,secret ' + name + ' --ignore-not-found --wait=false');
  console.log('Disposable restore pod and Secret removed.');
}
