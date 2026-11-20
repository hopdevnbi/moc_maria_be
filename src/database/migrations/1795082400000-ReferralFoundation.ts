import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReferralFoundation1795082400000 implements MigrationInterface {
  name = 'ReferralFoundation1795082400000';
  async up(r: QueryRunner): Promise<void> {
    await r.query("SET LOCAL lock_timeout = '5s'");
    await r.query(`CREATE TABLE public.referral_codes (
      user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
      code varchar(20) NOT NULL UNIQUE DEFAULT upper(replace(gen_random_uuid()::text,'-',''))::varchar(20),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(code ~ '^[A-F0-9]{20}$')
    )`);
    await r.query(`CREATE TABLE public.referral_settings (
      id smallint PRIMARY KEY CHECK(id=1),
      reward_coins integer NOT NULL DEFAULT 100 CHECK(reward_coins BETWEEN 1 AND 100000),
      enabled boolean NOT NULL DEFAULT false,
      payout_enabled boolean NOT NULL DEFAULT false
    )`);
    await r.query('INSERT INTO public.referral_settings(id) VALUES(1)');
    await r.query(`CREATE TABLE public.referrals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      referrer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
      referred_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
      reward_coins integer NOT NULL CHECK(reward_coins BETWEEN 1 AND 100000),
      status varchar(32) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK(status IN ('PENDING_VERIFICATION','VERIFIED','REWARDED','REVERSED','CONTACT_ALREADY_REWARDED')),
      risk_score integer NOT NULL DEFAULT 0 CHECK(risk_score BETWEEN 0 AND 100),
      risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(risk_flags)='array'),
      device_hash text,
      network_hash text,
      reviewed_at timestamptz,
      reviewed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK(referrer_id<>referred_id)
    )`);
    await r.query(`CREATE TABLE public.referral_phone_claims (
      referral_id uuid PRIMARY KEY REFERENCES public.referrals(id) ON DELETE RESTRICT,
      phone_hash text NOT NULL CHECK(phone_hash ~ '^[0-9a-f]{64}$'),
      verified_at timestamptz NOT NULL DEFAULT now()
    )`);
    await r.query(
      'CREATE INDEX idx_referral_phone_claims_hash ON public.referral_phone_claims(phone_hash)',
    );
    await r.query(`CREATE TABLE public.referral_coin_ledger (
      referral_id uuid PRIMARY KEY REFERENCES public.referrals(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
      amount integer NOT NULL CHECK(amount>0),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await r.query(`CREATE TABLE public.referral_verification_challenges (
      user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
      phone_hash text NOT NULL CHECK(phone_hash ~ '^[0-9a-f]{64}$'),
      provider_sid varchar(34),
      requested_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      day date NOT NULL,
      sends integer NOT NULL CHECK(sends BETWEEN 1 AND 3),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5)
    )`);
    await r.query(
      'CREATE INDEX idx_referrals_referrer_created ON public.referrals(referrer_id,created_at DESC,id DESC)',
    );
    await r.query(
      'CREATE INDEX idx_referrals_device_recent ON public.referrals(device_hash,created_at) WHERE device_hash IS NOT NULL',
    );
    await r.query(
      'CREATE INDEX idx_referrals_network_recent ON public.referrals(network_hash,created_at) WHERE network_hash IS NOT NULL',
    );
    await r.query(
      'CREATE INDEX idx_referrals_created ON public.referrals(created_at DESC,id DESC)',
    );
    await r.query(
      'INSERT INTO public.referral_codes(user_id) SELECT id FROM public.users ON CONFLICT(user_id) DO NOTHING',
    );
    for (const table of [
      'referral_codes',
      'referral_settings',
      'referrals',
      'referral_phone_claims',
      'referral_coin_ledger',
      'referral_verification_challenges',
    ]) {
      await r.query('ALTER TABLE public.' + table + ' ENABLE ROW LEVEL SECURITY');
      await r.query('REVOKE ALL ON TABLE public.' + table + ' FROM PUBLIC, anon, authenticated');
      const [security] = (await r.query(
        `SELECT relrowsecurity AS rls,
        EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) AS role_name
        CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS permission
        WHERE has_table_privilege(role_name,oid,permission)) AS "publicAccess"
        FROM pg_class WHERE oid=$1::regclass`,
        ['public.' + table],
      )) as { rls: boolean; publicAccess: boolean }[];
      if (!security?.rls || security.publicAccess)
        throw new Error('Referral security verification failed');
    }
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error('Preserve referral attribution records; roll back application code independently.'),
    );
  }
}
