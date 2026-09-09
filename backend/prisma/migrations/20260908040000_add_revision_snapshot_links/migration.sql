-- Bind new snapshot chunks/documents to the immutable revision that produced
-- them. Existing legacy rows stay NULL and are never backfilled.
ALTER TABLE "eformsign_doc"
    ADD COLUMN IF NOT EXISTS "revision_id" UUID;
ALTER TABLE "service_record_snapshot_chunk"
    ADD COLUMN IF NOT EXISTS "revision_id" UUID;

-- A non-null revision link is meaningful only when the document is also
-- branch/case scoped. Legacy provider rows may retain their old NULL links.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_doc_revision_scope_check'
    ) THEN
        ALTER TABLE "eformsign_doc"
            ADD CONSTRAINT "eformsign_doc_revision_scope_check"
            CHECK (
                "revision_id" IS NULL
                OR ("branch_id" IS NOT NULL AND "service_record_case_id" IS NOT NULL)
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'eformsign_doc_revision_fkey'
    ) THEN
        ALTER TABLE "eformsign_doc"
            ADD CONSTRAINT "eformsign_doc_revision_fkey"
            FOREIGN KEY ("branch_id", "service_record_case_id", "revision_id")
            REFERENCES "service_record_revision" ("branch_id", "service_record_case_id", "id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'service_record_snapshot_chunk_revision_fkey'
    ) THEN
        ALTER TABLE "service_record_snapshot_chunk"
            ADD CONSTRAINT "service_record_snapshot_chunk_revision_fkey"
            FOREIGN KEY ("branch_id", "service_record_case_id", "revision_id")
            REFERENCES "service_record_revision" ("branch_id", "service_record_case_id", "id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_eformsign_doc_revision_version"
    ON "eformsign_doc" (
        "branch_id", "service_record_case_id", "revision_id",
        "snapshot_version", "snapshot_chunk_index"
    );
CREATE INDEX IF NOT EXISTS "idx_service_record_snapshot_chunk_revision_version"
    ON "service_record_snapshot_chunk" (
        "branch_id", "service_record_case_id", "revision_id",
        "snapshot_version", "chunk_index"
    );
