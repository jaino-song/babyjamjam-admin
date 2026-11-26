-- Client notes: standing notes staff should see on a client. The first kind,
-- contract_info_mismatch, records contract fields changed after the client's
-- contract was completed (the contract can no longer be changed).
-- Backout: the table is additive and only read by the client badge and notes
-- code; drop the table after deploying an app that no longer reads it.
BEGIN;

CREATE TABLE IF NOT EXISTS "client_note" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'open',
    "contract_document_id" VARCHAR(255),
    "changes" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_by" UUID,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_reason" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_note_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'client_note_kind_check' AND conrelid = 'client_note'::regclass
    ) THEN
        ALTER TABLE "client_note"
            ADD CONSTRAINT "client_note_kind_check" CHECK ("kind" IN ('contract_info_mismatch'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'client_note_status_check' AND conrelid = 'client_note'::regclass
    ) THEN
        ALTER TABLE "client_note"
            ADD CONSTRAINT "client_note_status_check" CHECK ("status" IN ('open', 'resolved'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'client_note_changes_array_check' AND conrelid = 'client_note'::regclass
    ) THEN
        ALTER TABLE "client_note"
            ADD CONSTRAINT "client_note_changes_array_check" CHECK (jsonb_typeof("changes") = 'array');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'client_note_branch_id_fkey' AND conrelid = 'client_note'::regclass
    ) THEN
        ALTER TABLE "client_note"
            ADD CONSTRAINT "client_note_branch_id_fkey" FOREIGN KEY ("branch_id")
                REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'client_note_client_id_fkey' AND conrelid = 'client_note'::regclass
    ) THEN
        ALTER TABLE "client_note"
            ADD CONSTRAINT "client_note_client_id_fkey" FOREIGN KEY ("client_id")
                REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_client_note_branch_client_status"
    ON "client_note"("branch_id", "client_id", "status");

CREATE INDEX IF NOT EXISTS "idx_client_note_client_kind_status"
    ON "client_note"("client_id", "kind", "status");

-- Partial unique index (Prisma cannot model it, see the note on model client_note):
-- one open note of each kind per client.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_client_note_client_kind_open"
    ON "client_note"("client_id", "kind")
    WHERE "status" = 'open';

COMMIT;
