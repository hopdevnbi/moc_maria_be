import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import { CatalogTranslationsService } from '../src/modules/catalog-translations/catalog-translations.service';
import { ProviderShowcaseTranslationsService } from '../src/modules/catalog-translations/provider-showcase-translations.service';
import { ProviderDisplayService } from '../src/modules/provider-display/provider-display.service';
import { KtvChatMonitorService } from '../src/modules/ktv-chat/ktv-chat-monitor.service';
import { ReferralsService } from '../src/modules/referrals/referrals.service';
import { ReferralVerificationService } from '../src/modules/referrals/referral-verification.service';
import { ReferralEmailVerificationService } from '../src/modules/referrals/referral-email-verification.service';
import { recordReferral } from '../src/modules/referrals/referral-attribution';
import type { AuthUserContext } from '../src/modules/identity/identity.types';

async function main(): Promise<void> {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw Error('Disposable loopback *_test database required');
  const db = await new DataSource(buildDatabaseOptionsFromEnv(process.env)).initialize();
  try {
    const [existing] = await db.query<{ present: boolean }[]>(
      'SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=$1) AS present',
      ['public'],
    );
    if (existing?.present) throw Error('Empty database required');
    for (const role of ['anon', 'authenticated']) {
      const [row] = await db.query<{ rolname: string }[]>(
        'SELECT rolname FROM pg_roles WHERE rolname=$1',
        [role],
      );
      if (!row) await db.query('CREATE ROLE "' + role + '" NOLOGIN');
    }
    // Mirror legacy Supabase default table grants in this disposable database.
    await db.query(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated',
    );
    const migrations = await db.runMigrations({ transaction: 'all' });
    console.log('Applied ' + migrations.length + ' migrations');
    const [metadataSecurity] = await db.query<
      { rls: boolean; anon: boolean; authenticated: boolean }[]
    >(
      "SELECT relrowsecurity AS rls,has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') AS anon,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') AS authenticated FROM pg_class WHERE oid='public.app_metadata'::regclass",
    );
    assert.deepEqual(metadataSecurity, { rls: true, anon: false, authenticated: false });
    console.log('Private application metadata grants verified');
    const id = randomUUID(),
      category = randomUUID(),
      variant = randomUUID(),
      user = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,display_name,password_hash,is_active,must_change_password) VALUES($1,$2,'Isolated QA','not-a-login-password',true,false)",
      [user, 'i18n@example.invalid'],
    );
    await db.query(
      "INSERT INTO service_categories(id,name,slug,is_published) VALUES($1,'Original category','i18n-qa-cat',true)",
      [category],
    );
    await db.query(
      "INSERT INTO services(id,category_id,name,slug,description,is_published) VALUES($1,$2,'Original name','i18n-qa-service','Original description',true)",
      [id, category],
    );
    await db.query(
      "INSERT INTO service_variants(id,service_id,name,duration_minutes,price_vnd,is_active) VALUES($1,$2,'Original variant',60,100000,true)",
      [variant, id],
    );
    const actor = { id: user, roles: ['SUPER_ADMIN'] } as AuthUserContext;
    const service = new CatalogTranslationsService(db);
    const read = await service.adminDetail(actor, 'service', id, 'en');
    const dto = {
      name: 'English name',
      description: 'English description',
      status: 'DRAFT' as const,
      expectedVersion: read.version,
      sourceFingerprint: read.sourceFingerprint,
    };
    assert.equal((await service.publicDetail('service', id, 'en')).locale, 'vi');
    const draft = await service.save(actor, 'service', id, 'en', dto);
    assert.equal(draft.version, 1);
    assert.equal((await service.publicDetail('service', id, 'en')).locale, 'vi');
    const publish = { ...dto, status: 'PUBLISHED' as const, expectedVersion: 1 };
    const results = await Promise.allSettled([
      service.save(actor, 'service', id, 'en', publish),
      service.save(actor, 'service', id, 'en', publish),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await service.publicDetail('service', id, 'en')).name, 'English name');
    await db.query("UPDATE services SET name='Changed source' WHERE id=$1", [id]);
    assert.equal((await service.publicDetail('service', id, 'en')).name, 'Changed source');
    assert.equal((await service.adminDetail(actor, 'service', id, 'en')).translation?.stale, true);
    await db.query('UPDATE service_categories SET is_published=false WHERE id=$1', [category]);
    await assert.rejects(service.publicDetail('service', id, 'en'));
    await assert.rejects(service.publicDetail('variant', variant, 'en'));
    const [security] = await db.query<{ rls: boolean; anon: boolean; authenticated: boolean }[]>(
      "SELECT relrowsecurity AS rls,has_table_privilege('anon',oid,'SELECT') AS anon,has_table_privilege('authenticated',oid,'INSERT') AS authenticated FROM pg_class WHERE relname='moc_service_translations'",
    );
    assert.deepEqual(security, { rls: true, anon: false, authenticated: false });
    const [audit] = await db.query<{ count: string }[]>(
      "SELECT count(*)::text AS count FROM audit_logs WHERE event='catalog.translation.save' AND actor_user_id=$1",
      [user],
    );
    assert.equal(audit.count, '2');
    const providerId = randomUUID();
    await db.query(
      "INSERT INTO staff_profiles(user_id,public_name,is_active) VALUES($1,'Isolated KTV',true)",
      [user],
    );
    await db.query(
      "INSERT INTO provider_applications(id,user_id,public_name,status) VALUES($1,$2,'Isolated KTV','APPROVED')",
      [providerId, user],
    );
    const metadataKey = 'mocmaria.ktv.showcase.v1.' + providerId;
    const text = {
      headline: 'Original headline',
      biography: 'Original biography',
      scheduleNote: 'Original note',
    };
    await db.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
      metadataKey,
      JSON.stringify(text),
    ]);
    const profiles = new ProviderShowcaseTranslationsService(db, new ProviderDisplayService(db));
    const profileSource = await profiles.adminDetail(actor, providerId, 'en');
    const profileDto = {
      headline: 'English headline',
      biography: 'English biography',
      scheduleNote: 'English note',
      status: 'DRAFT' as const,
      expectedVersion: 0,
      sourceFingerprint: profileSource.sourceFingerprint,
    };
    await profiles.save(actor, providerId, 'en', profileDto);
    assert.equal((await profiles.publicDetail(providerId, 'en')).locale, 'vi');
    const published = await Promise.allSettled([
      profiles.save(actor, providerId, 'en', {
        ...profileDto,
        status: 'PUBLISHED',
        expectedVersion: 1,
      }),
      profiles.save(actor, providerId, 'en', {
        ...profileDto,
        status: 'PUBLISHED',
        expectedVersion: 1,
      }),
    ]);
    assert.equal(published.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      (await profiles.publicDetail(providerId, 'en')).translation?.biography,
      'English biography',
    );
    await assert.rejects(profiles.adminDetail({ ...actor, roles: ['ADMIN'] }, providerId, 'en'));
    await db.query('UPDATE app_metadata SET value=$2::jsonb WHERE key=$1', [
      metadataKey,
      JSON.stringify({ ...text, biography: 'Changed original' }),
    ]);
    assert.equal((await profiles.publicDetail(providerId, 'en')).locale, 'vi');
    assert.equal((await profiles.adminDetail(actor, providerId, 'en')).translation?.stale, true);
    await db.query("UPDATE provider_applications SET status='SUSPENDED' WHERE id=$1", [providerId]);
    await assert.rejects(profiles.publicDetail(providerId, 'en'));
    const [profileSecurity] = await db.query<
      { rls: boolean; anon: boolean; authenticated: boolean }[]
    >(
      "SELECT relrowsecurity AS rls,has_table_privilege('anon',oid,'SELECT') AS anon,has_table_privilege('authenticated',oid,'INSERT') AS authenticated FROM pg_class WHERE relname='moc_provider_showcase_translations'",
    );
    assert.deepEqual(profileSecurity, { rls: true, anon: false, authenticated: false });
    const monitor = new KtvChatMonitorService(db);
    const customerId = randomUUID(),
      threadId = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,display_name,password_hash,is_active,must_change_password) VALUES($1,'chat-customer@example.invalid','Isolated customer','not-a-login-password',true,false)",
      [customerId],
    );
    await db.query(
      'INSERT INTO ktv_chat_threads(id,customer_user_id,provider_user_id,provider_application_id) VALUES($1,$2,$3,$4)',
      [threadId, customerId, user, providerId],
    );
    const first = await db.query<{ id: string }[]>(
      "INSERT INTO ktv_chat_messages(thread_id,sender_user_id,client_message_id,body) VALUES($1,$2,$3,'Customer message') RETURNING id",
      [threadId, customerId, randomUUID()],
    );
    await db.query(
      "INSERT INTO ktv_chat_messages(thread_id,sender_user_id,client_message_id,body) VALUES($1,$2,$3,'Therapist reply')",
      [threadId, user, randomUUID()],
    );
    await db.query(
      "INSERT INTO app_metadata(key,value) VALUES($1,jsonb_build_object('url','https://example.invalid/qa.webp'))",
      ['mocmaria.chat.image.' + first[0].id],
    );
    const monitorActor = {
      ...actor,
      isActive: true,
      permissions: ['admin.portal', 'customers.manage'],
    };
    const feed = await monitor.list(monitorActor);
    assert.deepEqual(
      feed.items.map((m) => m.senderRole),
      ['provider', 'customer'],
    );
    assert.equal(feed.items[0].body, 'Therapist reply');
    assert.equal(feed.items[1].imageUrl, 'https://example.invalid/qa.webp');
    assert.equal((await monitor.list(monitorActor, feed.items[0].seq, threadId)).items.length, 1);
    await assert.rejects(monitor.list({ ...monitorActor, roles: ['ADMIN'] }));
    await assert.rejects(
      monitor.list({ ...monitorActor, roles: ['CUSTOMER'] }, undefined, threadId),
    );
    await db.query(
      "INSERT INTO app_metadata(key,value) VALUES($1,jsonb_build_object('passwordHash','test-only'))",
      ['mocmaria.chat.privacy.' + threadId],
    );
    const locked = await monitor.list(monitorActor, undefined, threadId);
    assert.ok(locked.items.every((m) => m.protected && m.body === null && m.imageUrl === null));
    const [logged] = await db.query<{ count: number }[]>(
      "SELECT count(*)::int AS count FROM audit_logs WHERE event='KTV_CHAT_MONITOR_ACCESSED' AND actor_user_id=$1",
      [user],
    );
    assert.equal(logged.count, 1);
    for (const table of [
      'ktv_chat_threads',
      'ktv_chat_messages',
      'ktv_chat_blocks',
      'audit_logs',
      'users',
      'roles',
      'permissions',
      'user_roles',
      'role_permissions',
      'refresh_sessions',
      'password_reset_tokens',
    ]) {
      const [security] = await db.query<{ rls: boolean; anon: boolean; authenticated: boolean }[]>(
        "SELECT relrowsecurity AS rls,has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') AS anon,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') AS authenticated FROM pg_class WHERE oid=$1::regclass",
        ['public.' + table],
      );
      assert.deepEqual(security, { rls: true, anon: false, authenticated: false });
    }
    console.log(
      'Chat monitor integration PASS: both senders, history, password mask, roles, audit, RLS.',
    );
    console.log(
      'Provider showcase i18n integration PASS: publish, version conflict, source fallback, visibility and RLS.',
    );
    console.log(
      'Catalog i18n PostgreSQL integration PASS: draft/publish, concurrent update, stale fallback, hidden parents, RLS, audit.',
    );
    const referrals = new ReferralsService(db);
    const verifier = new ReferralVerificationService(db);
    const emailVerifier = new ReferralEmailVerificationService(db);
    const originalFetch = global.fetch;
    const envKeys = [
      'REFERRAL_TWILIO_VERIFY_SERVICE_SID',
      'REFERRAL_TWILIO_API_KEY',
      'REFERRAL_TWILIO_API_SECRET',
      'REFERRAL_IDENTITY_SECRET',
      'REFERRAL_SIGNAL_SECRET',
      'REFERRAL_SMS_OTP_ENABLED',
      'REFERRAL_TWILIO_TRIAL_MODE',
      'REFERRAL_EMAIL_OTP_ENABLED',
      'QUEUE_SERVICE_URL',
      'QUEUE_API_KEY',
    ] as const;
    const originalEnv = envKeys.map((k) => process.env[k]);
    const serviceSid = 'VA' + '1'.repeat(32),
      verificationSid = 'VE' + '2'.repeat(32);
    try {
      Object.assign(process.env, {
        REFERRAL_TWILIO_VERIFY_SERVICE_SID: serviceSid,
        REFERRAL_TWILIO_API_KEY: 'SK' + '3'.repeat(32),
        REFERRAL_TWILIO_API_SECRET: 'test-only-provider-secret',
        REFERRAL_IDENTITY_SECRET: 'test-only-identity-secret-'.repeat(2),
        REFERRAL_SIGNAL_SECRET: 'test-only-signal-secret-'.repeat(2),
        REFERRAL_SMS_OTP_ENABLED: 'true',
        REFERRAL_TWILIO_TRIAL_MODE: 'false',
      });
      const config = await referrals.settings(monitorActor);
      assert.equal(config.rewardCoins, 100);
      assert.equal(config.payoutEnabled, false);
      const mine = await referrals.mine(monitorActor);
      assert.match(mine.code, /^[A-F0-9]{20}$/);
      assert.equal((await referrals.mine(monitorActor)).code, mine.code);
      await assert.rejects(referrals.list({ ...monitorActor, roles: ['ADMIN'] }, 1));
      await referrals.saveSettings(monitorActor, {
        enabled: true,
        rewardCoins: 100,
        payoutEnabled: true,
      });
      const device = randomUUID();
      const firstId = randomUUID(),
        secondId = randomUUID();
      const phone = '+84900000001';
      await db.query(
        "INSERT INTO users(id,email,phone,display_name,password_hash,is_active) VALUES($1,'ref-first@example.invalid',$2,'First isolated member','test-only',true),($3,'ref-second@example.invalid',NULL,'Second isolated member','test-only',true)",
        [firstId, phone, secondId],
      );
      await db.transaction((m) => recordReferral(m, firstId, mine.code, device));
      await db.transaction((m) => recordReferral(m, secondId, mine.code, device));
      await db.transaction((m) => recordReferral(m, secondId, mine.code, device));
      await db.transaction((m) => recordReferral(m, user, mine.code, device));
      const rows = await referrals.list(monitorActor, 1);
      assert.equal(rows.items.length, 2);
      assert.equal(
        rows.items.find((r) => r.referredName === 'Second isolated member')?.riskScore,
        35,
      );
      assert.ok(rows.items.every((r) => r.status === 'PENDING_VERIFICATION'));
      global.fetch = async (input, init) => {
        assert.equal(typeof input, 'string');
        const path = input as string;
        assert.ok(path.startsWith('https://verify.twilio.com/v2/Services/' + serviceSid + '/'));
        assert.ok(init?.body instanceof URLSearchParams);
        const fields = init.body;
        const status = path.endsWith('/Verifications')
          ? 'pending'
          : fields.get('Code') === '123456'
            ? 'approved'
            : 'pending';
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sid: verificationSid,
              to: phone,
              service_sid: serviceSid,
              channel: 'sms',
              status,
            }),
            { status: 200 },
          ),
        );
      };
      const firstActor = {
        ...monitorActor,
        id: firstId,
        roles: ['CUSTOMER'],
        phone,
      } as AuthUserContext;
      await verifier.start(firstActor);
      await assert.rejects(verifier.start(firstActor));
      await assert.rejects(verifier.confirm(firstActor, '000000'));
      await db.query('UPDATE referrals SET risk_score=100 WHERE referred_id=$1', [firstId]);
      const firstResult = await verifier.confirm(firstActor, '123456');
      assert.equal(firstResult.rewarded, true);
      await assert.rejects(verifier.confirm(firstActor, '123456'));
      // A reused verified phone could be reassigned to a genuine new person.
      // It is an advisory flag, not a duplicate verdict or payout gate.
      await db.query('UPDATE users SET phone=NULL WHERE id=$1', [firstId]);
      await db.query('UPDATE users SET phone=$2 WHERE id=$1', [secondId, phone]);
      const secondActor = { ...firstActor, id: secondId };
      await verifier.start(secondActor);
      const secondResult = await verifier.confirm(secondActor, '123456');
      assert.equal(secondResult.rewarded, true);
      const history = await referrals.history(monitorActor, 1);
      assert.equal(history.items.length, 2);
      assert.ok(history.items.every((r) => r.earnedCoins === 100 && r.awardedAt));
      assert.ok(
        history.items.every(
          (r) => !('referredName' in r) && !('riskScore' in r) && !('phone' in r),
        ),
      );
      assert.deepEqual(await referrals.history(firstActor, 1), { items: [], hasMore: false });
      assert.deepEqual(await referrals.history(monitorActor, 2), { items: [], hasMore: false });
      const updatedMine = await referrals.mine(monitorActor);
      assert.equal(updatedMine.coins, 200);
      assert.equal(updatedMine.latestReward?.amount, 100);
      assert.deepEqual(await referrals.community(firstActor), { url: null });
      await assert.rejects(referrals.saveCommunity(firstActor, 'https://zalo.me/g/IsolatedQA'));
      await assert.rejects(
        referrals.saveCommunity(monitorActor, 'https://zalo.me.evil.example/g/IsolatedQA'),
      );
      assert.deepEqual(
        await referrals.saveCommunity(monitorActor, 'https://zalo.me/g/IsolatedQA'),
        { url: 'https://zalo.me/g/IsolatedQA' },
      );
      assert.deepEqual(await referrals.community(firstActor), {
        url: 'https://zalo.me/g/IsolatedQA',
      });
      await referrals.saveCommunity(monitorActor, '');
      assert.deepEqual(await referrals.community(firstActor), { url: null });
      const [wallet] = await db.query<{ balance: number; total_earned: number }[]>(
        'SELECT balance,total_earned FROM staff_coin_wallets WHERE user_id=$1',
        [user],
      );
      assert.deepEqual(wallet, { balance: 200, total_earned: 200 });
      const [ledger] = await db.query<{ count: number; amount: number }[]>(
        'SELECT count(*)::int AS count,sum(amount)::int AS amount FROM referral_coin_ledger WHERE user_id=$1',
        [user],
      );
      assert.deepEqual(ledger, { count: 2, amount: 200 });
      const reviewed = await referrals.list(monitorActor, 1);
      assert.ok(
        reviewed.items
          .find((r) => r.referredName === 'Second isolated member')
          ?.riskFlags.includes('VERIFIED_PHONE_PREVIOUSLY_USED'),
      );
      assert.ok(reviewed.items.every((r) => r.status === 'REWARDED'));
      // Email must remain fully independent from Twilio. These are isolated
      // synthetic members and a mocked Queue: no live email or Coin is sent.
      Object.assign(process.env, {
        REFERRAL_SMS_OTP_ENABLED: 'false',
        REFERRAL_EMAIL_OTP_ENABLED: 'true',
        QUEUE_SERVICE_URL: 'http://127.0.0.1:65432',
        QUEUE_API_KEY: 'test-queue-key',
      });
      assert.equal((await referrals.settings(monitorActor)).verificationConfigured, true);
      const emailId = randomUUID();
      await db.query(
        "INSERT INTO users(id,email,phone,display_name,password_hash,is_active) VALUES($1,'mail-ref@example.invalid',NULL,'Email isolated member','test-only',true)",
        [emailId],
      );
      await db.transaction((m) => recordReferral(m, emailId, mine.code, randomUUID()));
      const emailActor = {
        ...firstActor,
        id: emailId,
        email: 'mail-ref@example.invalid',
        phone: null,
      };
      let emailCode = '';
      global.fetch = (input, init) => {
        assert.equal(input, 'http://127.0.0.1:65432/jobs');
        if (typeof init?.body !== 'string') throw new Error('Invalid synthetic queue body');
        const job = JSON.parse(init.body) as {
          queue: string;
          name: string;
          data: { text: string; to: string; purpose: string };
          options: { attempts: number };
        };
        assert.equal(job.queue, 'email');
        assert.equal(job.name, 'email.send');
        assert.equal(job.data.purpose, 'moc-maria-referral-email-otp');
        assert.equal(job.data.to, 'mail-ref@example.invalid');
        assert.equal(job.options.attempts, 1);
        const match = job.data.text.match(/\b\d{6}\b/);
        assert.ok(match);
        emailCode = match[0];
        return Promise.resolve(new Response(JSON.stringify({ id: randomUUID() }), { status: 202 }));
      };
      assert.deepEqual(await emailVerifier.start(emailActor, 'en'), {
        sent: true,
        channel: 'email',
      });
      assert.match(emailCode, /^\d{6}$/);
      await assert.rejects(emailVerifier.start(emailActor, 'en'));
      await assert.rejects(
        emailVerifier.confirm(emailActor, '999999' === emailCode ? '999998' : '999999'),
      );
      const [attempt] = await db.query<{ attempts: number; code_hash: string }[]>(
        'SELECT attempts,code_hash FROM referral_email_challenges WHERE user_id=$1',
        [emailId],
      );
      assert.equal(attempt.attempts, 1);
      assert.notEqual(attempt.code_hash, emailCode);
      await db.query('UPDATE referrals SET risk_score=100 WHERE referred_id=$1', [emailId]);
      assert.deepEqual(await emailVerifier.confirm(emailActor, emailCode), {
        rewarded: true,
        status: 'REWARDED',
      });
      await assert.rejects(emailVerifier.confirm(emailActor, emailCode));
      const [emailReward] = await db.query<{ amount: number }[]>(
        'SELECT amount FROM referral_coin_ledger WHERE referral_id=(SELECT id FROM referrals WHERE referred_id=$1)',
        [emailId],
      );
      assert.equal(emailReward.amount, 100);
      const [emailChallengeCount] = await db.query<{ count: number }[]>(
        'SELECT count(*)::int AS count FROM referral_email_challenges WHERE user_id=$1',
        [emailId],
      );
      assert.equal(emailChallengeCount.count, 0);
      const [finalWallet] = await db.query<{ balance: number }[]>(
        'SELECT balance FROM staff_coin_wallets WHERE user_id=$1',
        [user],
      );
      assert.equal(finalWallet.balance, 300);
      for (const table of [
        'referral_codes',
        'referral_settings',
        'referrals',
        'referral_phone_claims',
        'referral_coin_ledger',
        'referral_verification_challenges',
        'referral_email_challenges',
        'referral_email_claims',
      ]) {
        const [security] = await db.query<
          { rls: boolean; anon: boolean; authenticated: boolean }[]
        >(
          "SELECT relrowsecurity AS rls,has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') AS anon,has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') AS authenticated FROM pg_class WHERE oid=$1::regclass",
          ['public.' + table],
        );
        assert.deepEqual(security, { rls: true, anon: false, authenticated: false });
      }
      console.log(
        'Referral integration PASS: roles, attribution, SMS and email OTP mocked, 100 Coin email award, wrong OTP persistence, replay rejection, risk-only score, reused phone advisory and RLS.',
      );
    } finally {
      global.fetch = originalFetch;
      envKeys.forEach((k, i) => {
        if (originalEnv[i] === undefined) delete process.env[k];
        else process.env[k] = originalEnv[i];
      });
    }
  } finally {
    await db.destroy();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Integration failed');
  process.exitCode = 1;
});
