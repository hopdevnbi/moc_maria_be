import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReferralEmailVerification1795420800000 implements MigrationInterface {
  name = 'ReferralEmailVerification1795420800000';

  async up(r: QueryRunner): Promise<void> {
    await r.query("SET LOCAL lock_timeout='5s'");
    await r.query(`CREATE TABLE public.referral_email_challenges (
      user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
      email_hash text NOT NULL CHECK(email_hash ~ '^[0-9a-f]{64}$'),
      code_hash text NOT NULL CHECK(code_hash ~ '^[0-9a-f]{64}$'),
      nonce varchar(32) NOT NULL CHECK(nonce ~ '^[0-9a-f]{32}$'),
      requested_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      day date NOT NULL,
      sends integer NOT NULL CHECK(sends BETWEEN 1 AND 3),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
      delivered boolean NOT NULL DEFAULT false
    )`);
    await r.query(`CREATE TABLE public.referral_email_claims (
      referral_id uuid PRIMARY KEY REFERENCES public.referrals(id) ON DELETE RESTRICT,
      email_hash text NOT NULL CHECK(email_hash ~ '^[0-9a-f]{64}$'),
      verified_at timestamptz NOT NULL DEFAULT now()
    )`);
    await r.query(
      'CREATE INDEX idx_referral_email_claims_hash ON public.referral_email_claims(email_hash)',
    );
    for (const table of ['referral_email_challenges', 'referral_email_claims']) {
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
        throw new Error('Referral email security verification failed');
    }
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Preserve referral proof and reward records; roll back application independently.'),
    );
  }
}
