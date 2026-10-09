/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const argon2 = require('argon2');
const { provision } = require('./provision-ktv-accounts.cjs');

async function verify(url) {
  if (new URL(url).pathname !== '/moc_maria_ktv_seed_qa') throw new Error('Dedicated disposable database required');
  const ds = new DataSource({type:'postgres',url,ssl:false,entities:['dist/**/*.entity.js'],migrations:['dist/database/migrations/*.js']});
  await ds.initialize(); await ds.runMigrations(); await ds.destroy();
  const c = new Client({connectionString:url,ssl:false}); await c.connect();
  try {
    const profiles=Array.from({length:10},(_,i)=>({id:'demo-ktv-'+String(i+1).padStart(2,'0'),publicName:'KTV '+(i+1),introduction:'Owner seed test',serviceArea:'Hà Nội',avatarUrl:'/media/ktv/test.webp',scheduleOpen:i<5}));
    const credentials=profiles.map((p,i)=>({seedId:p.id,userId:randomUUID(),applicationId:randomUUID(),email:'ktv.seed'+i+'@mocmaria.com',password:'Mm9!'+randomUUID()}));
    const wrong=credentials.map(x=>({...x}));wrong[0].seedId='wrong';
    await assert.rejects(provision(c,profiles,wrong),/Manifest profile mismatch/);
    assert.equal(Number((await c.query('select count(*) n from users')).rows[0].n),0);
    assert.equal(Number((await c.query('select count(*) n from branches')).rows[0].n),0);
    const first=await provision(c,profiles,credentials);assert.equal(first.created,true);
    const again=await provision(c,profiles,credentials);assert.equal(again.created,false);
    assert.equal(Number((await c.query('select count(*) n from users')).rows[0].n),10);
    const rows=(await c.query('select password_hash,email,must_change_password from users')).rows;
    for(const u of rows){assert.equal(u.must_change_password,true);assert.equal(await argon2.verify(u.password_hash,credentials.find(x=>x.email===u.email).password),true)}
    const scheduled=(await c.query('select count(distinct provider_application_id)::int n,count(*)::int shifts from provider_weekly_shifts')).rows[0];
    assert.equal(scheduled.n,5);assert.equal(scheduled.shifts,30);
    assert.equal(Number((await c.query('select count(*) n from provider_training_certificates')).rows[0].n),0);
    await assert.rejects(provision(c,profiles,credentials.map(x=>({...x,userId:randomUUID()}))),/Existing seed accounts differ/);
    console.log('KTV_SEED_INTEGRATION_PASS: atomic rollback, idempotency, ten hashed credentials, five schedules, no certificates, identity collision refusal');
  } finally {await c.end()}
}
module.exports={verify};
if(require.main===module)verify(process.env.KTV_SEED_QA_URL).catch(()=>{console.error('KTV_SEED_INTEGRATION_FAILED');process.exitCode=1});
