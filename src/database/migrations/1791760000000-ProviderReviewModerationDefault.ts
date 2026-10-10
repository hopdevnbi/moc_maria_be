import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProviderReviewModerationDefault1791760000000 implements MigrationInterface {
  name = 'ProviderReviewModerationDefault1791760000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query("ALTER TABLE provider_reviews ALTER COLUMN visibility SET DEFAULT 'HIDDEN'");
    // A past approval does not cover a more recent customer edit.
    await q.query(
      "UPDATE provider_reviews r SET visibility='HIDDEN',version=version+1,updated_at=clock_timestamp() " +
        "WHERE r.visibility='PUBLISHED' AND NOT EXISTS (" +
        'SELECT 1 FROM provider_review_history h WHERE h.review_id=r.id ' +
        "AND h.action='MODERATE' AND h.visibility='PUBLISHED' " +
        'AND h.version=(SELECT max(last.version) FROM provider_review_history last WHERE last.review_id=r.id))',
    );
  }

  async down(_q: QueryRunner): Promise<void> {
    // Intentionally do not reinstate a public-by-default policy on rollback.
  }
}
