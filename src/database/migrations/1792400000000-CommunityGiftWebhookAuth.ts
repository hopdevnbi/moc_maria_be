import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dedicated server-to-server Zalo webhook credential.
 * Never store it in public.app_metadata: anon/auth roles can SELECT that table.
 */
export class CommunityGiftWebhookAuth1792400000000 implements MigrationInterface {
  name = 'CommunityGiftWebhookAuth1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS private_integrations');
    await queryRunner.query(
      'REVOKE ALL ON SCHEMA private_integrations FROM PUBLIC, anon, authenticated',
    );
    await queryRunner.query(
      'CREATE TABLE IF NOT EXISTS private_integrations.webhook_secrets (' +
        'key text PRIMARY KEY, secret text NOT NULL CHECK (length(secret) >= 32))',
    );
    await queryRunner.query(
      'ALTER TABLE private_integrations.webhook_secrets ENABLE ROW LEVEL SECURITY',
    );
    await queryRunner.query(
      'REVOKE ALL ON private_integrations.webhook_secrets FROM PUBLIC, anon, authenticated',
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Never drop production credentials on application rollback.
  }
}
