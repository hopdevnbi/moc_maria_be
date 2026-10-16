import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive eligibility setting. Every existing and new event is open to all registered customers by default. */
export class GiftEventCompletedServicePolicy1791900500000 implements MigrationInterface {
  name = 'GiftEventCompletedServicePolicy1791900500000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE gift_event_campaigns
      ADD COLUMN requires_completed_service boolean NOT NULL DEFAULT false`);
  }

  async down(q: QueryRunner): Promise<void> {
    const [enabled] = (await q.query(
      'SELECT id FROM gift_event_campaigns WHERE requires_completed_service LIMIT 1',
    )) as Array<{ id: string }>;
    if (enabled) throw new Error('Disable service-use eligibility on all events before rollback.');
    await q.query('ALTER TABLE gift_event_campaigns DROP COLUMN requires_completed_service');
  }
}
