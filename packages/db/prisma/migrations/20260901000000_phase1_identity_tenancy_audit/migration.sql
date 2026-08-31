-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipScope" AS ENUM ('SELF', 'DEPARTMENT', 'ENTITY', 'ORGANISATION');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'PROVIDER');

-- CreateEnum
CREATE TYPE "MfaFactorType" AS ENUM ('TOTP');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'MFA_ENROLLED', 'MFA_CHALLENGE_FAILED', 'SESSION_REVOKED', 'ROLE_CHANGED', 'MEMBERSHIP_DEACTIVATED', 'TENANT_MISMATCH_ATTEMPTED', 'STEP_UP_FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "base_currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 1,
    "country_code" CHAR(2) NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "active_membership_id" UUID,
    "token_hash" BYTEA NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "stepped_up_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "MfaFactorType" NOT NULL DEFAULT 'TOTP',
    "secret_encrypted" BYTEA NOT NULL,
    "backup_code_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confirmed_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "department_id" UUID,
    "manager_membership_id" UUID,
    "scope" "MembershipScope" NOT NULL DEFAULT 'SELF',
    "entity_scope" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "deactivated_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "registration_number" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "functional_currency" CHAR(3) NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "head_membership_id" UUID,
    "path" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "entity_id" UUID,
    "department_id" UUID,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "starts_on" DATE,
    "ends_on" DATE,
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "parent_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "department_id" UUID,
    "invited_by_membership_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "resent_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_membership_id" UUID,
    "actor_type" "ActorType" NOT NULL DEFAULT 'USER',
    "actor_label" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" INET,
    "user_agent" TEXT,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "user_id" UUID,
    "membership_id" UUID,
    "ip_address" INET,
    "user_agent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_id_organization_id_key" ON "roles"("id", "organization_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_active_membership_id_idx" ON "sessions"("active_membership_id");

-- CreateIndex
CREATE INDEX "sessions_absolute_expires_at_idx" ON "sessions"("absolute_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_factors_user_id_type_key" ON "mfa_factors"("user_id", "type");

-- CreateIndex
CREATE INDEX "memberships_organization_id_status_idx" ON "memberships"("organization_id", "status");

-- CreateIndex
CREATE INDEX "memberships_organization_id_department_id_idx" ON "memberships"("organization_id", "department_id");

-- CreateIndex
CREATE INDEX "memberships_organization_id_role_id_idx" ON "memberships"("organization_id", "role_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE INDEX "memberships_manager_membership_id_organization_id_idx" ON "memberships"("manager_membership_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_id_organization_id_key" ON "memberships"("id", "organization_id");

-- CreateIndex
CREATE INDEX "entities_organization_id_status_idx" ON "entities"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "entities_id_organization_id_key" ON "entities"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "entities_organization_id_name_key" ON "entities"("organization_id", "name");

-- CreateIndex
CREATE INDEX "departments_organization_id_parent_id_idx" ON "departments"("organization_id", "parent_id");

-- CreateIndex
CREATE INDEX "departments_organization_id_path_idx" ON "departments"("organization_id", "path");

-- CreateIndex
CREATE INDEX "departments_head_membership_id_organization_id_idx" ON "departments"("head_membership_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_id_organization_id_key" ON "departments"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");

-- CreateIndex
CREATE INDEX "projects_organization_id_status_idx" ON "projects"("organization_id", "status");

-- CreateIndex
CREATE INDEX "projects_entity_id_organization_id_idx" ON "projects"("entity_id", "organization_id");

-- CreateIndex
CREATE INDEX "projects_department_id_organization_id_idx" ON "projects"("department_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_organization_id_key" ON "projects"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_code_key" ON "projects"("organization_id", "code");

-- CreateIndex
CREATE INDEX "categories_organization_id_parent_id_idx" ON "categories"("organization_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_id_organization_id_key" ON "categories"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_organization_id_key_key" ON "categories"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_email_idx" ON "invitations"("organization_id", "email");

-- CreateIndex
CREATE INDEX "invitations_organization_id_expires_at_idx" ON "invitations"("organization_id", "expires_at");

-- CreateIndex
CREATE INDEX "invitations_role_id_organization_id_idx" ON "invitations"("role_id", "organization_id");

-- CreateIndex
CREATE INDEX "invitations_invited_by_membership_id_organization_id_idx" ON "invitations"("invited_by_membership_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_id_organization_id_key" ON "invitations"("id", "organization_id");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_organization_id_resource_type_resource_id_crea_idx" ON "audit_events"("organization_id", "resource_type", "resource_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_organization_id_actor_membership_id_created_at_idx" ON "audit_events"("organization_id", "actor_membership_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_organization_id_action_created_at_idx" ON "audit_events"("organization_id", "action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "security_events_organization_id_created_at_idx" ON "security_events"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "security_events_organization_id_type_created_at_idx" ON "security_events"("organization_id", "type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "security_events_organization_id_user_id_created_at_idx" ON "security_events"("organization_id", "user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_membership_id_fkey" FOREIGN KEY ("active_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_organization_id_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_department_id_organization_id_fkey" FOREIGN KEY ("department_id", "organization_id") REFERENCES "departments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_manager_membership_id_organization_id_fkey" FOREIGN KEY ("manager_membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_organization_id_fkey" FOREIGN KEY ("parent_id", "organization_id") REFERENCES "departments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_membership_id_organization_id_fkey" FOREIGN KEY ("head_membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_entity_id_organization_id_fkey" FOREIGN KEY ("entity_id", "organization_id") REFERENCES "entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_department_id_organization_id_fkey" FOREIGN KEY ("department_id", "organization_id") REFERENCES "departments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_organization_id_fkey" FOREIGN KEY ("parent_id", "organization_id") REFERENCES "categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_organization_id_fkey" FOREIGN KEY ("role_id", "organization_id") REFERENCES "roles"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_membership_id_organization_id_fkey" FOREIGN KEY ("invited_by_membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
--  Everything below this line is hand-written.
--
--  Prisma's schema language cannot express CHECK constraints or privilege
--  changes. None of them are decoration: each one makes an invariant that
--  documentation merely *states* into something the database *enforces*,
--  which is the only version that still holds when application code is wrong.
--
--  Kept in this migration rather than a separate one so that applying the
--  migrations to an empty database yields the complete schema in one step.
--  See prisma/migrations/README.md before editing.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The audit actor rule (docs/09 §7.1) ───────────────────────────────────
-- A job or a webhook legitimately has no membership. A user action never
-- does, and an audit event that cannot name its actor is not evidence.
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_actor_present"
  CHECK ("actor_type" <> 'USER' OR "actor_membership_id" IS NOT NULL);

-- ── Currency and country codes are exactly what they claim to be ──────────
-- `char(3)` permits 'us ' and ''. ISO-4217 does not. Without this, a
-- malformed code reaches the Money value object, which throws at the point of
-- use rather than at the point of entry.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_base_currency_iso4217"
  CHECK ("base_currency" ~ '^[A-Z]{3}$');

ALTER TABLE "entities"
  ADD CONSTRAINT "entities_functional_currency_iso4217"
  CHECK ("functional_currency" ~ '^[A-Z]{3}$');

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_country_code_iso3166"
  CHECK ("country_code" ~ '^[A-Z]{2}$');

ALTER TABLE "entities"
  ADD CONSTRAINT "entities_country_code_iso3166"
  CHECK ("country_code" ~ '^[A-Z]{2}$');

-- ── Ranges and counters ───────────────────────────────────────────────────
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_fiscal_month_range"
  CHECK ("fiscal_year_start_month" BETWEEN 1 AND 12);

ALTER TABLE "users"
  ADD CONSTRAINT "users_failed_login_count_non_negative"
  CHECK ("failed_login_count" >= 0);

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_resent_count_non_negative"
  CHECK ("resent_count" >= 0);

-- The optimistic-concurrency counter only moves forward, and a version below
-- 1 would make a fresh record look stale.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_version_positive" CHECK ("version" >= 1);
ALTER TABLE "memberships"   ADD CONSTRAINT "memberships_version_positive"   CHECK ("version" >= 1);
ALTER TABLE "entities"      ADD CONSTRAINT "entities_version_positive"      CHECK ("version" >= 1);
ALTER TABLE "departments"   ADD CONSTRAINT "departments_version_positive"   CHECK ("version" >= 1);
ALTER TABLE "projects"      ADD CONSTRAINT "projects_version_positive"      CHECK ("version" >= 1);
ALTER TABLE "categories"    ADD CONSTRAINT "categories_version_positive"    CHECK ("version" >= 1);

-- ── Hierarchies cannot trivially cycle ────────────────────────────────────
-- A one-node cycle is the case a database can catch cheaply. Longer cycles
-- are rejected by the service, which walks the path before writing — but
-- self-parenting is the mistake an off-by-one actually produces.
ALTER TABLE "departments"
  ADD CONSTRAINT "departments_not_own_parent"
  CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_not_own_parent"
  CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_not_own_manager"
  CHECK ("manager_membership_id" IS NULL OR "manager_membership_id" <> "id");

-- ── The materialised department path is well-formed ───────────────────────
-- Subtree reads are `path LIKE '/a/b/%'`. A path missing its delimiters makes
-- '/a/bc/' match a query for '/a/b/', which silently widens a manager's
-- scope — the exact failure this column exists to avoid.
ALTER TABLE "departments"
  ADD CONSTRAINT "departments_path_delimited"
  CHECK ("path" LIKE '/%' AND "path" LIKE '%/');

-- ── Session expiry ordering ───────────────────────────────────────────────
-- Idle expiry after absolute expiry would mean the idle timeout never fires.
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_idle_before_absolute"
  CHECK ("idle_expires_at" <= "absolute_expires_at");

-- ── An entity-scoped membership must name its entities ────────────────────
-- Otherwise the scope predicate resolves to an empty set and the member sees
-- nothing, which reads as a data bug rather than a misconfiguration.
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_entity_scope_present"
  CHECK ("scope" <> 'ENTITY' OR COALESCE(array_length("entity_scope", 1), 0) >= 1);

-- ── Immutability, enforced by the absence of a grant (docs/09 §1.5) ───────
-- `audit_events` and `security_events` have no UPDATE or DELETE path anywhere
-- in the application. Revoking the privilege means that remains true even if
-- someone writes one: the statement fails rather than succeeding quietly.
--
-- The owning role is resolved rather than hard-coded, because it differs
-- between a developer's machine, CI, and production — and a migration that
-- names one of them silently does nothing in the others, which is worse than
-- failing.
DO $$
DECLARE
  owner_role text;
  target     text;
BEGIN
  FOREACH target IN ARRAY ARRAY['audit_events', 'security_events'] LOOP
    SELECT tableowner INTO owner_role
      FROM pg_tables
     WHERE schemaname = current_schema() AND tablename = target;

    IF owner_role IS NULL THEN
      RAISE EXCEPTION 'Cannot resolve the owner of %; refusing to leave it mutable.', target;
    END IF;

    EXECUTE format('REVOKE UPDATE, DELETE ON %I.%I FROM %I', current_schema(), target, owner_role);
  END LOOP;
END $$;
