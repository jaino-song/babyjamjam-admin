-- Durable atomic-confirm result for the administrator service-record draft.
--
-- The confirmation row lives on the draft so a retry can return the exact
-- server response without rereading mutable case/provider state. All DDL is
-- idempotent because the database-patches runner may replay this migration.

ALTER TABLE "service_record_edit_draft"
    ADD COLUMN IF NOT EXISTS "confirmed_by_user_id" UUID,
    ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "confirmation_idempotency_key" UUID,
    ADD COLUMN IF NOT EXISTS "confirmation_fingerprint" CHAR(64),
    ADD COLUMN IF NOT EXISTS "confirmation_response" JSONB;

ALTER TABLE "service_record_edit_draft"
    DROP CONSTRAINT IF EXISTS "service_record_edit_draft_status_check";

ALTER TABLE "service_record_edit_draft"
    ADD CONSTRAINT "service_record_edit_draft_status_check"
    CHECK ("status" IN ('ACTIVE', 'DISCARDED', 'CONFIRMED'));

ALTER TABLE "service_record_edit_draft"
    DROP CONSTRAINT IF EXISTS "service_record_edit_draft_confirmation_check";

ALTER TABLE "service_record_edit_draft"
    ADD CONSTRAINT "service_record_edit_draft_confirmation_check"
    CHECK (
        "status" <> 'CONFIRMED'
        OR (
            "confirmed_by_user_id" IS NOT NULL
            AND "confirmed_at" IS NOT NULL
            AND "confirmation_idempotency_key" IS NOT NULL
            AND "confirmation_fingerprint" IS NOT NULL
            AND "confirmation_response" IS NOT NULL
        )
    );

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_service_record_edit_draft_confirmation_key"
    ON "service_record_edit_draft" (
        "branch_id",
        "service_record_case_id",
        "confirmation_idempotency_key"
    )
    WHERE "confirmation_idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_service_record_edit_draft_confirmation_fingerprint"
    ON "service_record_edit_draft" ("branch_id", "confirmation_fingerprint")
    WHERE "confirmation_fingerprint" IS NOT NULL;
