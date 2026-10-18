-- This migration is also replayed by the database patch workflow.
-- The database-patches workflow re-executes this whole file on every push, so
-- every statement below must be safe to run again: a bare CREATE would fail every
-- run after the first and block the later patches from ever applying.
--
-- BJJ-454 machine export: hash-only credentials, fixed snapshots and their
-- candidate rows. Export-owned evidence; no branchId, so not tenant models.

-- CreateTable
CREATE TABLE IF NOT EXISTS "eformsign_backup_export_credential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "principal_id" VARCHAR(64) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "company_ids" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "eformsign_backup_export_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "eformsign_backup_export_snapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "principal_id" VARCHAR(64) NOT NULL,
    "company_id" VARCHAR(256) NOT NULL,
    "scope_revision" VARCHAR(64) NOT NULL,
    "policy_revision" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "counts" JSONB,
    "failure_code" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "eformsign_backup_export_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "eformsign_backup_export_candidate" (
    "snapshot_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "document_id" TEXT NOT NULL,
    "classification" VARCHAR(24) NOT NULL,
    "reasons" TEXT[],
    "status_type" TEXT NOT NULL,
    "document_kind" VARCHAR(32),
    "metadata_revision" CHAR(64) NOT NULL,
    "document_sha256" CHAR(64),
    "document_byte_size" INTEGER,
    "document_artifact_identity" CHAR(64),
    "audit_trail_sha256" CHAR(64),
    "audit_trail_byte_size" INTEGER,
    "audit_trail_artifact_identity" CHAR(64),

    CONSTRAINT "eformsign_backup_export_candidate_pkey" PRIMARY KEY ("snapshot_id","ordinal")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_eformsign_backup_export_credential_principal" ON "eformsign_backup_export_credential"("principal_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_eformsign_backup_export_credential_token_hash" ON "eformsign_backup_export_credential"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_eformsign_backup_export_snapshot_principal_idempotency" ON "eformsign_backup_export_snapshot"("principal_id", "idempotency_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_eformsign_backup_export_candidate_document_artifact" ON "eformsign_backup_export_candidate"("snapshot_id", "document_artifact_identity");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_eformsign_backup_export_candidate_audit_trail_artifact" ON "eformsign_backup_export_candidate"("snapshot_id", "audit_trail_artifact_identity");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_eformsign_backup_export_candidate_snapshot_document" ON "eformsign_backup_export_candidate"("snapshot_id", "document_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_backup_export_candidate_snapshot_id_fkey'
          AND conrelid = '"eformsign_backup_export_candidate"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_candidate" ADD CONSTRAINT "eformsign_backup_export_candidate_snapshot_id_fkey"
            FOREIGN KEY ("snapshot_id") REFERENCES "eformsign_backup_export_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Constraints Prisma cannot express. Each is guarded so a replay is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_credential_token_hash_hex'
          AND conrelid = '"eformsign_backup_export_credential"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_credential" ADD CONSTRAINT "chk_export_credential_token_hash_hex"
            CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_credential_company_ids_nonempty'
          AND conrelid = '"eformsign_backup_export_credential"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_credential" ADD CONSTRAINT "chk_export_credential_company_ids_nonempty"
            CHECK ("company_ids" IS NOT NULL AND cardinality("company_ids") >= 1);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_snapshot_request_hash_hex'
          AND conrelid = '"eformsign_backup_export_snapshot"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_snapshot" ADD CONSTRAINT "chk_export_snapshot_request_hash_hex"
            CHECK ("request_hash" ~ '^[0-9a-f]{64}$');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_snapshot_status'
          AND conrelid = '"eformsign_backup_export_snapshot"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_snapshot" ADD CONSTRAINT "chk_export_snapshot_status"
            CHECK ("status" IN ('building', 'ready', 'failed'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_snapshot_ready_fields'
          AND conrelid = '"eformsign_backup_export_snapshot"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_snapshot" ADD CONSTRAINT "chk_export_snapshot_ready_fields"
            CHECK ("status" <> 'ready' OR ("ready_at" IS NOT NULL AND "expires_at" IS NOT NULL AND "counts" IS NOT NULL));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_candidate_classification'
          AND conrelid = '"eformsign_backup_export_candidate"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_candidate" ADD CONSTRAINT "chk_export_candidate_classification"
            CHECK ("classification" IN ('inaccessible', 'unknown_template', 'policy_pending', 'excluded_by_policy', 'included'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_candidate_ordinal_positive'
          AND conrelid = '"eformsign_backup_export_candidate"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_candidate" ADD CONSTRAINT "chk_export_candidate_ordinal_positive"
            CHECK ("ordinal" >= 1);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_candidate_reasons_present'
          AND conrelid = '"eformsign_backup_export_candidate"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_candidate" ADD CONSTRAINT "chk_export_candidate_reasons_present"
            CHECK ("reasons" IS NOT NULL);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_candidate_metadata_revision_hex'
          AND conrelid = '"eformsign_backup_export_candidate"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_candidate" ADD CONSTRAINT "chk_export_candidate_metadata_revision_hex"
            CHECK ("metadata_revision" ~ '^[0-9a-f]{64}$');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_candidate_document_all_or_none'
          AND conrelid = '"eformsign_backup_export_candidate"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_candidate" ADD CONSTRAINT "chk_export_candidate_document_all_or_none"
            CHECK (("document_sha256" IS NULL AND "document_byte_size" IS NULL AND "document_artifact_identity" IS NULL) OR ("document_sha256" IS NOT NULL AND "document_byte_size" IS NOT NULL AND "document_artifact_identity" IS NOT NULL));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_candidate_audit_trail_all_or_none'
          AND conrelid = '"eformsign_backup_export_candidate"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_candidate" ADD CONSTRAINT "chk_export_candidate_audit_trail_all_or_none"
            CHECK (("audit_trail_sha256" IS NULL AND "audit_trail_byte_size" IS NULL AND "audit_trail_artifact_identity" IS NULL) OR ("audit_trail_sha256" IS NOT NULL AND "audit_trail_byte_size" IS NOT NULL AND "audit_trail_artifact_identity" IS NOT NULL));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_candidate_sha256_hex'
          AND conrelid = '"eformsign_backup_export_candidate"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_candidate" ADD CONSTRAINT "chk_export_candidate_sha256_hex"
            CHECK (("document_sha256" IS NULL OR "document_sha256" ~ '^[0-9a-f]{64}$') AND ("audit_trail_sha256" IS NULL OR "audit_trail_sha256" ~ '^[0-9a-f]{64}$') AND ("document_artifact_identity" IS NULL OR "document_artifact_identity" ~ '^[0-9a-f]{64}$') AND ("audit_trail_artifact_identity" IS NULL OR "audit_trail_artifact_identity" ~ '^[0-9a-f]{64}$'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_export_candidate_byte_size_nonneg'
          AND conrelid = '"eformsign_backup_export_candidate"'::regclass
    ) THEN
        ALTER TABLE "eformsign_backup_export_candidate" ADD CONSTRAINT "chk_export_candidate_byte_size_nonneg"
            CHECK (("document_byte_size" IS NULL OR "document_byte_size" >= 0) AND ("audit_trail_byte_size" IS NULL OR "audit_trail_byte_size" >= 0));
    END IF;
END $$;

-- General API roles get no access to the export tables (design v0.3 section 14.1 D-08).
-- Supabase default privileges may otherwise grant them; a no-op where a role does
-- not exist, and harmless to replay.
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format(
                'REVOKE ALL ON TABLE public.eformsign_backup_export_credential, public.eformsign_backup_export_snapshot, public.eformsign_backup_export_candidate FROM %I',
                api_role
            );
        END IF;
    END LOOP;
END $$;
