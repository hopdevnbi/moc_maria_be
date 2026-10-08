import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthRbacIdentity1791433600000 implements MigrationInterface {
  name = 'AuthRbacIdentity1791433600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
      'CREATE TABLE "users" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "email" varchar(320), "phone" varchar(32), "display_name" varchar(160) NOT NULL, "password_hash" varchar(255) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "must_change_password" boolean NOT NULL DEFAULT false, "last_login_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "users_contact_required" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL), CONSTRAINT "uq_users_email" UNIQUE ("email"), CONSTRAINT "uq_users_phone" UNIQUE ("phone"))',
      'CREATE TABLE "roles" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" varchar(64) NOT NULL UNIQUE, "description" varchar(240), "created_at" timestamptz NOT NULL DEFAULT now())',
      'CREATE TABLE "permissions" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "code" varchar(100) NOT NULL UNIQUE, "description" varchar(240), "created_at" timestamptz NOT NULL DEFAULT now())',
      'CREATE TABLE "user_roles" ("user_id" uuid NOT NULL, "role_id" uuid NOT NULL, "assigned_at" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("user_id", "role_id"), CONSTRAINT "fk_user_roles_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE, CONSTRAINT "fk_user_roles_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE)',
      'CREATE TABLE "role_permissions" ("role_id" uuid NOT NULL, "permission_id" uuid NOT NULL, PRIMARY KEY ("role_id", "permission_id"), CONSTRAINT "fk_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE, CONSTRAINT "fk_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE)',
      'CREATE TABLE "refresh_sessions" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "token_hash" varchar(64) NOT NULL UNIQUE, "expires_at" timestamptz NOT NULL, "revoked_at" timestamptz, "replaced_by_session_id" uuid, "user_agent" varchar(500), "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "fk_refresh_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)',
      'CREATE INDEX "idx_refresh_sessions_user" ON "refresh_sessions" ("user_id")',
      'CREATE TABLE "password_reset_tokens" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "token_hash" varchar(64) NOT NULL UNIQUE, "expires_at" timestamptz NOT NULL, "used_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "fk_password_reset_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)',
      'CREATE TABLE "customers" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL UNIQUE, "birthday" date, "avatar_url" varchar(2048), "contact_preferences" jsonb NOT NULL DEFAULT \'{}\'::jsonb, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "fk_customers_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)',
      'CREATE TABLE "staff_profiles" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL UNIQUE, "public_name" varchar(160) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "is_public" boolean NOT NULL DEFAULT true, "avatar_url" varchar(2048), "bio" text, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "fk_staff_profiles_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)',
      'CREATE TABLE "audit_logs" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "event" varchar(100) NOT NULL, "actor_user_id" uuid, "target_user_id" uuid, "metadata" jsonb NOT NULL DEFAULT \'{}\'::jsonb, "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "fk_audit_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL, CONSTRAINT "fk_audit_target" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL)',
      'CREATE INDEX "idx_audit_logs_event_created" ON "audit_logs" ("event", "created_at" DESC)',
      'CREATE INDEX "idx_audit_logs_target" ON "audit_logs" ("target_user_id", "created_at" DESC)',
      "INSERT INTO \"roles\" (\"name\", \"description\") VALUES ('SUPER_ADMIN', 'Full platform administration'), ('ADMIN', 'Platform administration without super-admin elevation'), ('BRANCH_MANAGER', 'Branch management role'), ('RECEPTIONIST', 'Reception and customer operations'), ('THERAPIST', 'Therapist staff portal'), ('DOCTOR_CONSULTANT', 'Doctor or consultant staff portal'), ('CUSTOMER', 'Customer self-service portal') ON CONFLICT (\"name\") DO NOTHING",
      "INSERT INTO \"permissions\" (\"code\", \"description\") VALUES ('admin.portal', 'Access the administration portal'), ('users.manage', 'Create, enable, disable and manage user accounts'), ('roles.manage', 'Assign supported application roles'), ('staff.manage', 'Provision and manage staff identities'), ('customers.manage', 'Manage customer identities'), ('staff.portal', 'Access staff self-service portal'), ('customer.portal', 'Access customer self-service portal'), ('profile.self', 'Read and update own profile') ON CONFLICT (\"code\") DO NOTHING",
      'INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p WHERE r.name = \'SUPER_ADMIN\' ON CONFLICT DO NOTHING',
      "INSERT INTO \"role_permissions\" (\"role_id\", \"permission_id\") SELECT r.id, p.id FROM \"roles\" r JOIN \"permissions\" p ON p.code IN ('admin.portal','users.manage','roles.manage','staff.manage','customers.manage','staff.portal','profile.self') WHERE r.name = 'ADMIN' ON CONFLICT DO NOTHING",
      "INSERT INTO \"role_permissions\" (\"role_id\", \"permission_id\") SELECT r.id, p.id FROM \"roles\" r JOIN \"permissions\" p ON p.code IN ('admin.portal','staff.manage','customers.manage','staff.portal','profile.self') WHERE r.name = 'BRANCH_MANAGER' ON CONFLICT DO NOTHING",
      'INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON p.code IN (\'customers.manage\',\'staff.portal\',\'profile.self\') WHERE r.name = \'RECEPTIONIST\' ON CONFLICT DO NOTHING',
      'INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON p.code IN (\'staff.portal\',\'profile.self\') WHERE r.name IN (\'THERAPIST\',\'DOCTOR_CONSULTANT\') ON CONFLICT DO NOTHING',
      'INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON p.code IN (\'customer.portal\',\'profile.self\') WHERE r.name = \'CUSTOMER\' ON CONFLICT DO NOTHING',
    ];

    for (const statement of statements) {
      await queryRunner.query(statement);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      'DROP TABLE IF EXISTS "audit_logs"',
      'DROP TABLE IF EXISTS "staff_profiles"',
      'DROP TABLE IF EXISTS "customers"',
      'DROP TABLE IF EXISTS "password_reset_tokens"',
      'DROP TABLE IF EXISTS "refresh_sessions"',
      'DROP TABLE IF EXISTS "role_permissions"',
      'DROP TABLE IF EXISTS "user_roles"',
      'DROP TABLE IF EXISTS "permissions"',
      'DROP TABLE IF EXISTS "roles"',
      'DROP TABLE IF EXISTS "users"',
    ];

    for (const statement of statements) {
      await queryRunner.query(statement);
    }
  }
}
