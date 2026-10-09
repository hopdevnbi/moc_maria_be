/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit owner-authorized onboarding. Never generates training/verification evidence.
const argon2 = require('argon2');
const SEED_KEY = 'mocmaria.ktv.accounts.v1';

async function provision(client, profiles, credentials) {
  if (profiles.length !== 10 || credentials.length !== 10 ||
      new Set(credentials.map(x => x.email)).size !== 10 ||
      profiles.filter(x => x.scheduleOpen).length !== 5 ||
      credentials.some(x => !/^[0-9a-f-]{36}$/i.test(x.userId) || !/^[0-9a-f-]{36}$/i.test(x.applicationId) ||
        !/^[a-z0-9.-]+@mocmaria\.com$/.test(x.email) || x.password.length < 16)) {
    throw new Error('Invalid ten-account/five-schedule seed manifest');
  }
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(1791663000)');
    const previous = (await client.query('SELECT value FROM app_metadata WHERE key=$1 FOR UPDATE', [SEED_KEY])).rows[0]?.value;
    if (previous) {
      if (JSON.stringify(previous.accounts.map(x => x.userId)) !== JSON.stringify(credentials.map(x => x.userId)))
        throw new Error('Existing seed accounts differ; never replace identities or passwords');
      await client.query('ROLLBACK');
      return {created:false, accounts:previous.accounts, branchId:previous.branchId};
    }
    const therapist = (await client.query("SELECT id FROM roles WHERE name='THERAPIST'")).rows[0];
    if (!therapist) throw new Error('Missing THERAPIST role');
    if ((await client.query('SELECT id FROM users WHERE email=ANY($1::text[])', [credentials.map(x=>x.email)])).rowCount)
      throw new Error('Login identifier already belongs to an existing account');
    const existingBranch = (await client.query('SELECT id FROM branches WHERE is_active ORDER BY created_at,id LIMIT 1')).rows[0];
    const branch = existingBranch || (await client.query(
      "INSERT INTO branches(name,code,address) VALUES('Mộc Maria','MOC-MARIA-KTV','Hà Nội — địa chỉ đang cập nhật') RETURNING id"
    )).rows[0];
    if (!existingBranch) for (let weekday=1;weekday<=6;weekday++) await client.query(
      'INSERT INTO branch_business_hours(branch_id,weekday,opens_at_minute,closes_at_minute) VALUES($1,$2,540,1080)',[branch.id,weekday]);
    const accounts=[];
    for (let i=0;i<10;i++) {
      const p=profiles[i], c=credentials[i];
      if (c.seedId !== p.id) throw new Error('Manifest profile mismatch');
      await client.query('INSERT INTO users(id,email,display_name,password_hash,is_active,must_change_password) VALUES($1,$2,$3,$4,true,true)',
        [c.userId,c.email,p.publicName,await argon2.hash(c.password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1})]);
      await client.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)',[c.userId,therapist.id]);
      await client.query('INSERT INTO staff_profiles(user_id,public_name,avatar_url,bio,is_active,is_public) VALUES($1,$2,$3,$4,true,false)',
        [c.userId,p.publicName,p.avatarUrl,p.introduction]);
      await client.query("INSERT INTO provider_applications(id,user_id,public_name,introduction,service_area,status,review_note) VALUES($1,$2,$3,$4,$5,'APPLIED',$6)",
        [c.applicationId,c.userId,p.publicName,p.introduction,p.serviceArea,'Owner-authorized KTV account seed; operational review pending.']);
      if (p.scheduleOpen) {
        await client.query('INSERT INTO provider_branch_assignments(provider_application_id,branch_id) VALUES($1,$2)',[c.applicationId,branch.id]);
        for (let weekday=1;weekday<=6;weekday++) await client.query(
          'INSERT INTO provider_weekly_shifts(provider_application_id,branch_id,weekday,starts_at_minute,ends_at_minute) VALUES($1,$2,$3,540,1080)',
          [c.applicationId,branch.id,weekday]);
      }
      const a={seedId:p.id,userId:c.userId,applicationId:c.applicationId,scheduleOpen:p.scheduleOpen};
      accounts.push(a);
      await client.query("INSERT INTO audit_logs(event,target_user_id,metadata) VALUES('provider.seed_account.created',$1,$2::jsonb)",
        [c.userId,JSON.stringify({seedKey:SEED_KEY,...a,authorizedBy:'Owner request 2026-10-09'})]);
    }
    await client.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)',[SEED_KEY,JSON.stringify({accounts,branchId:branch.id})]);
    await client.query("INSERT INTO app_metadata(key,value) VALUES('mocmaria.demo.ktv.v1',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",
      [JSON.stringify({type:'MOC_MARIA_DEMO_KTV',purpose:'owner-seeded-catalog',notForBooking:true,profiles})]);
    const result = (await client.query('SELECT count(distinct provider_application_id)::int scheduled,count(*)::int shifts FROM provider_weekly_shifts WHERE provider_application_id=ANY($1::uuid[]) AND is_active',
      [credentials.map(x=>x.applicationId)])).rows[0];
    if (result.scheduled !== 5 || result.shifts !== 30) throw new Error('Schedule verification failed');
    await client.query('COMMIT');
    return {created:true,accounts,branchId:branch.id};
  } catch(e) { await client.query('ROLLBACK'); throw e; }
}
module.exports={provision,SEED_KEY};
