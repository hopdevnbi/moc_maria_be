import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingAvailabilityFoundation1791646000000 implements MigrationInterface {
  name = 'BookingAvailabilityFoundation1791646000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE booking_variant_settings(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),variant_id uuid NOT NULL REFERENCES service_variants(id) ON DELETE RESTRICT,
      branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      mode varchar(16) NOT NULL CHECK(mode IN ('AT_BRANCH','AT_HOME')),is_enabled boolean NOT NULL DEFAULT false,
      slot_step_minutes smallint NOT NULL CHECK(slot_step_minutes BETWEEN 5 AND 60),
      lead_minutes integer NOT NULL CHECK(lead_minutes BETWEEN 0 AND 43200),
      horizon_days smallint NOT NULL CHECK(horizon_days BETWEEN 1 AND 90),
      request_ttl_minutes smallint NOT NULL CHECK(request_ttl_minutes BETWEEN 5 AND 120),
      resource_requirements jsonb NOT NULL CHECK(jsonb_typeof(resource_requirements)='array'),
      reviewed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_at timestamptz NOT NULL DEFAULT now(),reason varchar(500) NOT NULL,
      UNIQUE(variant_id,branch_id,mode))`);
    await q.query(`CREATE TABLE appointments(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      mode varchar(16) NOT NULL CHECK(mode IN ('AT_BRANCH','AT_HOME')),
      status varchar(24) NOT NULL CHECK(status IN ('REQUESTED','ACCEPTED','CUSTOMER_CONFIRMED','CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED','CANCELLED','DECLINED','EXPIRED','NO_SHOW')),
      starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,blocked_starts_at timestamptz NOT NULL,blocked_ends_at timestamptz NOT NULL,
      request_expires_at timestamptz NOT NULL,current_quote_revision integer NOT NULL DEFAULT 1 CHECK(current_quote_revision>0),
      idempotency_key varchar(80) NOT NULL,request_fingerprint char(64) NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),
      source varchar(16) NOT NULL CHECK(source IN ('WEB','ADMIN')),notes varchar(500),destination jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(customer_user_id,idempotency_key),
      CHECK(blocked_starts_at<=starts_at AND starts_at<ends_at AND ends_at<=blocked_ends_at),
      CHECK((mode='AT_BRANCH' AND destination IS NULL) OR (mode='AT_HOME' AND destination IS NOT NULL)))`);
    await q.query(`CREATE TABLE appointment_items(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
      service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,variant_id uuid NOT NULL REFERENCES service_variants(id) ON DELETE RESTRICT,
      service_name varchar(160) NOT NULL,variant_name varchar(160) NOT NULL,
      duration_minutes integer NOT NULL CHECK(duration_minutes>0),
      buffer_before_minutes integer NOT NULL CHECK(buffer_before_minutes>=0),buffer_after_minutes integer NOT NULL CHECK(buffer_after_minutes>=0),
      price_vnd bigint NOT NULL CHECK(price_vnd>=0),UNIQUE(appointment_id))`);
    await q.query(`CREATE TABLE appointment_staff(
      appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
      provider_application_id uuid NOT NULL REFERENCES provider_applications(id) ON DELETE RESTRICT,
      PRIMARY KEY(appointment_id,provider_application_id))`);
    await q.query(
      `CREATE INDEX ix_appointment_staff_provider ON appointment_staff(provider_application_id,appointment_id)`,
    );
    await q.query(`CREATE TABLE appointment_resources(
      appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
      resource_id uuid NOT NULL REFERENCES branch_resources(id) ON DELETE RESTRICT,
      units smallint NOT NULL CHECK(units BETWEEN 1 AND 100),PRIMARY KEY(appointment_id,resource_id))`);
    await q.query(
      `CREATE INDEX ix_appointment_resource ON appointment_resources(resource_id,appointment_id)`,
    );
    await q.query(
      `CREATE INDEX ix_appointment_interval ON appointments(blocked_starts_at,blocked_ends_at)`,
    );
    await q.query(
      `CREATE INDEX ix_appointment_customer ON appointments(customer_user_id,created_at DESC)`,
    );
    await q.query(`CREATE TABLE appointment_quotes(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
      revision integer NOT NULL CHECK(revision>0),service_price_vnd bigint NOT NULL CHECK(service_price_vnd>=0),
      travel_fee_vnd bigint NOT NULL CHECK(travel_fee_vnd>=0),extra_fee_vnd bigint NOT NULL CHECK(extra_fee_vnd>=0),
      discount_vnd bigint NOT NULL CHECK(discount_vnd>=0),total_vnd bigint NOT NULL CHECK(total_vnd>=0),
      snapshot jsonb NOT NULL,reason varchar(500) NOT NULL,created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),accepted_by uuid REFERENCES users(id) ON DELETE RESTRICT,accepted_at timestamptz,
      UNIQUE(appointment_id,revision),CHECK(total_vnd=service_price_vnd+travel_fee_vnd+extra_fee_vnd-discount_vnd),
      CHECK((accepted_by IS NULL)=(accepted_at IS NULL)))`);
    await q.query(`CREATE TABLE appointment_status_history(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
      previous_status varchar(24),next_status varchar(24) NOT NULL,
      actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,reason varchar(500) NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(
      `CREATE INDEX ix_appointment_history ON appointment_status_history(appointment_id,created_at)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'appointment_status_history',
      'appointment_quotes',
      'appointment_resources',
      'appointment_staff',
      'appointment_items',
      'appointments',
      'booking_variant_settings',
    ])
      await q.query('DROP TABLE ' + table);
  }
}
