-- Mutable operation state for the immutable service-record revision payload.
-- Provider work continues to use eformsign_document_job; this table records
-- the scoped operation generation and its durable local progress only.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_service_record_case_branch_client_id"
    ON "service_record_case" ("branch_id", "client_id", "id");

CREATE TABLE IF NOT EXISTS "service_record_revision_document_state" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "service_record_case_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "operation" VARCHAR(32) NOT NULL,
    "generation" VARCHAR(128) NOT NULL,
    "immutable_input" JSONB NOT NULL,
    "input_fingerprint" CHAR(64) NOT NULL,
    "document_version" INTEGER,
    "source_document_id" TEXT,
    "target_document_id" TEXT,
    "template_id" TEXT,
    "template_version" TEXT,
    "workflow_scope" JSONB,
    "mirror_generation" TEXT,
    "output_proof" JSONB,
    "step" VARCHAR(80) NOT NULL DEFAULT 'pending',
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(120),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_record_revision_document_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_record_revision_document_state_operation_check"
        CHECK ("operation" IN ('record_snapshot', 'contract_period', 'receipt_refresh')),
    CONSTRAINT "service_record_revision_document_state_status_check"
        CHECK ("status" IN (
            'not_required', 'waiting_for_completion', 'waiting_for_signature',
            'capability_unverified', 'manual_review', 'pending', 'processing',
            'unknown', 'failed', 'completed'
        )),
    CONSTRAINT "service_record_revision_document_state_branch_fkey"
        FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "service_record_revision_document_state_client_fkey"
        FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "service_record_revision_document_state_case_owner_fkey"
        FOREIGN KEY ("branch_id", "client_id", "service_record_case_id")
        REFERENCES "service_record_case"("branch_id", "client_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "service_record_revision_document_state_revision_fkey"
        FOREIGN KEY ("branch_id", "service_record_case_id", "revision_id")
        REFERENCES "service_record_revision"("branch_id", "service_record_case_id", "id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_record_revision_document_state_generation_key"
    ON "service_record_revision_document_state" ("generation");
CREATE INDEX IF NOT EXISTS "idx_service_record_revision_document_state_operation"
    ON "service_record_revision_document_state" ("branch_id", "revision_id", "operation");
CREATE INDEX IF NOT EXISTS "idx_service_record_revision_document_state_owner_status"
    ON "service_record_revision_document_state" ("branch_id", "client_id", "status");
CREATE INDEX IF NOT EXISTS "idx_service_record_revision_document_state_case_revision"
    ON "service_record_revision_document_state" ("service_record_case_id", "revision_id");
CREATE INDEX IF NOT EXISTS "idx_service_record_revision_document_state_status_retry"
    ON "service_record_revision_document_state" ("status", "next_attempt_at");
