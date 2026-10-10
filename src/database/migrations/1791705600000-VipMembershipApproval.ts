import type { MigrationInterface, QueryRunner } from 'typeorm';
export class VipMembershipApproval1791705600000 implements MigrationInterface {
  name = 'VipMembershipApproval1791705600000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE vip_membership_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
      display_name varchar(80) NOT NULL DEFAULT 'Hội viên VIP',
      description varchar(1000) NOT NULL DEFAULT 'Chương trình dành cho khách hàng thân thiết. Quyền lợi sẽ được Mộc Maria công bố.',
      benefits jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(benefits) = 'array'),
      accepting_requests boolean NOT NULL DEFAULT true,
      duration_days integer CHECK (duration_days BETWEEN 1 AND 3650),
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(`INSERT INTO vip_membership_settings (id) VALUES (1)`);
    await q.query(`CREATE TABLE vip_membership_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
      note varchar(500),
      reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
      review_note varchar(500),
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(
      `CREATE UNIQUE INDEX ux_vip_request_pending ON vip_membership_requests(customer_user_id) WHERE status='PENDING'`,
    );
    await q.query(
      `CREATE INDEX ix_vip_requests_admin ON vip_membership_requests(status,created_at DESC,id DESC)`,
    );
    await q.query(
      `CREATE INDEX ix_vip_requests_customer ON vip_membership_requests(customer_user_id,created_at DESC)`,
    );
    await q.query(`CREATE TABLE vip_memberships (
      customer_user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
      status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
      active_since timestamptz NOT NULL,
      expires_at timestamptz,
      approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
      approved_request_id uuid NOT NULL REFERENCES vip_membership_requests(id) ON DELETE RESTRICT,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await q.query(
      `CREATE INDEX ix_vip_memberships_status ON vip_memberships(status,updated_at DESC)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE vip_memberships');
    await q.query('DROP TABLE vip_membership_requests');
    await q.query('DROP TABLE vip_membership_settings');
  }
}
