import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FoundationMetadata1791347200000 implements MigrationInterface {
  name = 'FoundationMetadata1791347200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE TABLE "app_metadata" ("key" varchar(100) PRIMARY KEY, "value" jsonb NOT NULL DEFAULT \'{}\'::jsonb, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now())',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "app_metadata"');
  }
}
