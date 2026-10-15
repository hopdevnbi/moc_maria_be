import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Prevent the same real-sale receipt being used to redeem multiple percent vouchers. */
export class GiftVoucherReceiptUniqueness1791900400000 implements MigrationInterface {
  name = 'GiftVoucherReceiptUniqueness1791900400000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE UNIQUE INDEX uq_gift_voucher_sale_reference
      ON gift_event_redemption_history ((metadata->>'saleReference'))
      WHERE action='REDEEM' AND metadata ? 'saleReference'`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX uq_gift_voucher_sale_reference');
  }
}
