-- Durable administrator service-record editing foundation.
--
-- This migration is also executed by the database-patches workflow, which does
-- not maintain Prisma's _prisma_migrations ledger. Every DDL operation is
-- therefore idempotent so a retry cannot stop later patches. Existing cases,
-- service-record days, and snapshot chunks are left untouched.

ALTER TABLE "service_record_case"
    ADD COLUMN IF NOT EXISTS "planned_sessions" JSONB,
    ADD COLUMN IF NOT EXISTS "current_content" JSONB,
    ADD COLUMN IF NOT EXISTS "current_usable_document_pointer" VARCHAR(255);

CREATE TABLE IF NOT EXISTS "service_record_edit_draft" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "service_record_case_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "discarded_by_user_id" UUID,
    "source_case_version" INTEGER NOT NULL,
    "source_fingerprint" TEXT NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "draft_version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discarded_at" TIMESTAMPTZ(6),
    CONSTRAINT "service_record_edit_draft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_record_revision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "service_record_case_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "confirmed_by_user_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "planned_sessions" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "form_version_at_confirm" INTEGER NOT NULL,
    "snapshot_reference" VARCHAR(255),
    CONSTRAINT "service_record_revision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_service_record_edit_draft_branch_case_status"
    ON "service_record_edit_draft" ("branch_id", "service_record_case_id", "status");
CREATE INDEX IF NOT EXISTS "idx_service_record_edit_draft_case_status"
    ON "service_record_edit_draft" ("service_record_case_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_service_record_edit_draft_active_case"
    ON "service_record_edit_draft" ("service_record_case_id")
    WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_service_record_revision_case_number"
    ON "service_record_revision" ("service_record_case_id", "revision_number");
CREATE INDEX IF NOT EXISTS "idx_service_record_revision_branch_case"
    ON "service_record_revision" ("branch_id", "service_record_case_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_edit_draft_branch_id_fkey'
          AND conrelid = 'public.service_record_edit_draft'::regclass
    ) THEN
        ALTER TABLE "service_record_edit_draft"
            ADD CONSTRAINT "service_record_edit_draft_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_edit_draft_service_record_case_id_fkey'
          AND conrelid = 'public.service_record_edit_draft'::regclass
    ) THEN
        ALTER TABLE "service_record_edit_draft"
            ADD CONSTRAINT "service_record_edit_draft_service_record_case_id_fkey"
            FOREIGN KEY ("service_record_case_id") REFERENCES "service_record_case"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_edit_draft_status_check'
          AND conrelid = 'public.service_record_edit_draft'::regclass
    ) THEN
        ALTER TABLE "service_record_edit_draft"
            ADD CONSTRAINT "service_record_edit_draft_status_check"
            CHECK ("status" IN ('ACTIVE', 'DISCARDED'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_edit_draft_version_check'
          AND conrelid = 'public.service_record_edit_draft'::regclass
    ) THEN
        ALTER TABLE "service_record_edit_draft"
            ADD CONSTRAINT "service_record_edit_draft_version_check"
            CHECK ("draft_version" > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_revision_branch_id_fkey'
          AND conrelid = 'public.service_record_revision'::regclass
    ) THEN
        ALTER TABLE "service_record_revision"
            ADD CONSTRAINT "service_record_revision_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_revision_service_record_case_id_fkey'
          AND conrelid = 'public.service_record_revision'::regclass
    ) THEN
        ALTER TABLE "service_record_revision"
            ADD CONSTRAINT "service_record_revision_service_record_case_id_fkey"
            FOREIGN KEY ("service_record_case_id") REFERENCES "service_record_case"("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_revision_number_check'
          AND conrelid = 'public.service_record_revision'::regclass
    ) THEN
        ALTER TABLE "service_record_revision"
            ADD CONSTRAINT "service_record_revision_number_check"
            CHECK ("revision_number" > 0);
    END IF;
END $$;

-- Source provenance is the baseline against which a later confirmation will
-- compare. Keep it immutable at the database boundary as well as in the
-- repository update API; only draft changes, actor fields, status, and server
-- timestamps may evolve after creation.
CREATE OR REPLACE FUNCTION prevent_service_record_edit_draft_source_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.source_case_version IS DISTINCT FROM OLD.source_case_version
       OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint
       OR NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot THEN
        RAISE EXCEPTION 'service_record_edit_draft source provenance is immutable';
    END IF;
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'service_record_edit_draft_source_immutable'
          AND tgrelid = 'public.service_record_edit_draft'::regclass
    ) THEN
        CREATE TRIGGER service_record_edit_draft_source_immutable
            BEFORE UPDATE ON "service_record_edit_draft"
            FOR EACH ROW
            EXECUTE FUNCTION prevent_service_record_edit_draft_source_mutation();
    END IF;
END $$;

-- A revision is a forensic copy, not mutable generation state. Keep that
-- invariant at the database boundary as well as in the repository API.
CREATE OR REPLACE FUNCTION prevent_service_record_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'service_record_revision is append-only';
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'service_record_revision_append_only'
          AND tgrelid = 'public.service_record_revision'::regclass
    ) THEN
        CREATE TRIGGER service_record_revision_append_only
            BEFORE UPDATE OR DELETE ON "service_record_revision"
            FOR EACH ROW
            EXECUTE FUNCTION prevent_service_record_revision_mutation();
    END IF;
END $$;
