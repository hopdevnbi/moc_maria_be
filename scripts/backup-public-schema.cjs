// Application schema backup over verified TLS and encrypted SSH; no credentials printed or saved.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const privateRoot = path.resolve('C:/Users/User/.codex/private/moc-maria-backups');
const filename = process.argv[2];
if (!/^public-[a-z0-9-]+\.dump$/.test(filename || '')) throw new Error('Expected private backup filename');
const output = path.join(privateRoot, filename);
if (!fs.existsSync(privateRoot) || fs.existsSync(output)) throw new Error('Private folder must exist; backups are never overwritten');
const name = 'moc-maria-backup-' + randomBytes(4).toString('hex');
const kubectl = 'kubectl --kubeconfig=/etc/kubernetes/admin.conf -n moc-maria';
function remote(command, input, binary = false) {
  const r = spawnSync('ssh', ['-p','8686','-o','BatchMode=yes','-o','ConnectTimeout=10','root@163.128.42.101',command],
    { input, encoding: binary ? undefined : 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('Scoped backup step failed; sensitive diagnostics suppressed');
  return r.stdout;
}
try {
  const pod = { apiVersion:'v1',kind:'Pod',metadata:{name,namespace:'moc-maria',labels:{purpose:'application-backup'}},spec:{
    restartPolicy:'Never',terminationGracePeriodSeconds:5,dnsConfig:{options:[{name:'ndots',value:'1'}]},
    securityContext:{runAsNonRoot:true,runAsUser:1000,runAsGroup:1000,fsGroup:1000},
    containers:[{name:'backup',image:'postgres:17-alpine',command:['sh','-c'],args:[
      'set -eu; umask 077; case "$DATABASE_URL" in *"?"*) exit 1;; esac; pg_dump --dbname="$DATABASE_URL" --schema=public --format=custom --no-owner --no-privileges --file=/backup/public.dump; touch /backup/ready; sleep 300'
    ],env:[{name:'DATABASE_URL',valueFrom:{secretKeyRef:{name:'moc-maria-api-secrets',key:'DATABASE_URL'}}},
      {name:'PGSSLMODE',value:'verify-full'},{name:'PGSSLROOTCERT',value:'/etc/moc-maria-ca/supabase.crt'}],
    readinessProbe:{exec:{command:['test','-f','/backup/ready']},periodSeconds:2},
    resources:{requests:{cpu:'50m',memory:'64Mi'},limits:{cpu:'300m',memory:'256Mi'}},
    securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:['ALL']},seccompProfile:{type:'RuntimeDefault'}},
    volumeMounts:[{name:'backup',mountPath:'/backup'},{name:'database-ca',mountPath:'/etc/moc-maria-ca',readOnly:true}]}],
    volumes:[{name:'backup',emptyDir:{sizeLimit:'256Mi'}},{name:'database-ca',configMap:{name:'moc-maria-database-ca'}}]
  }};
  remote(kubectl+' apply -f -',JSON.stringify(pod));
  remote(kubectl+' wait --for=condition=Ready pod/'+name+' --timeout=60s');
  const dump = remote(kubectl+' exec '+name+' -- cat /backup/public.dump',undefined,true);
  if (dump.subarray(0,5).toString() !== 'PGDMP') throw new Error('Invalid PostgreSQL dump');
  fs.writeFileSync(output,dump,{flag:'wx',mode:0o600});
  const metadata = { path:output, bytes:dump.length, sha256:createHash('sha256').update(dump).digest('hex'), scope:'public application schema', transport:'PG_VERIFY_FULL_TLS_AND_SSH' };
  fs.writeFileSync(output+'.json',JSON.stringify(metadata,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(metadata));
} finally {
  remote(kubectl+' delete pod/'+name+' --ignore-not-found --wait=false');
  console.log('Temporary backup pod removed.');
}
