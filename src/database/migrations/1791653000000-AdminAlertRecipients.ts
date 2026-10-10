import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminAlertRecipients1791653000000 implements MigrationInterface {
  name = 'AdminAlertRecipients1791653000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE admin_alert_recipients (
      email varchar(320) PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`INSERT INTO admin_alert_recipients(email, enabled)
      VALUES('nguyenvanhop.nbi@gmail.com', true) ON CONFLICT DO NOTHING`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE admin_alert_recipients');
  }
}
