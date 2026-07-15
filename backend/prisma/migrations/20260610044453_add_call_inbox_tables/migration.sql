-- Add three tables for the 통화 인박스 (Call Inbox) Phase 1 feature.
-- Additive-only: no existing tables, columns, or indexes are dropped or altered.

-- CreateTable: call_ingest_token
CREATE TABLE "call_ingest_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_ingest_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable: call_record
CREATE TABLE "call_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(6),
    "transcript" JSONB NOT NULL,
    "summary" JSONB,
    "category" TEXT,
    "caller_name" TEXT,
    "caller_phone" TEXT,
    "matched_client_id" INTEGER,
    "processing_status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "extraction_retry_count" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable: client_draft
CREATE TABLE "client_draft" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_record_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "client_id" INTEGER,
    "proposals" JSONB NOT NULL,
    "request_summary" TEXT NOT NULL,
    "extraction_meta" JSONB,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "discard_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: call_ingest_token
CREATE UNIQUE INDEX "call_ingest_token_token_hash_key" ON "call_ingest_token"("token_hash");
CREATE INDEX "idx_call_ingest_token_branch" ON "call_ingest_token"("branch_id");

-- CreateIndex: call_record
CREATE UNIQUE INDEX "call_record_drive_file_id_key" ON "call_record"("drive_file_id");
CREATE INDEX "idx_call_record_branch_created" ON "call_record"("branch_id", "created_at");
CREATE INDEX "idx_call_record_branch_category" ON "call_record"("branch_id", "category");
CREATE INDEX "idx_call_record_processing_status" ON "call_record"("processing_status");

-- CreateIndex: client_draft
CREATE UNIQUE INDEX "client_draft_call_record_id_key" ON "client_draft"("call_record_id");
CREATE INDEX "idx_client_draft_branch_status" ON "client_draft"("branch_id", "status");
CREATE INDEX "idx_client_draft_client" ON "client_draft"("client_id");

-- AddForeignKey: call_ingest_token
ALTER TABLE "call_ingest_token" ADD CONSTRAINT "call_ingest_token_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey: call_record
ALTER TABLE "call_record" ADD CONSTRAINT "call_record_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "call_record" ADD CONSTRAINT "call_record_matched_client_id_fkey" FOREIGN KEY ("matched_client_id") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey: client_draft
ALTER TABLE "client_draft" ADD CONSTRAINT "client_draft_call_record_id_fkey" FOREIGN KEY ("call_record_id") REFERENCES "call_record"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "client_draft" ADD CONSTRAINT "client_draft_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "client_draft" ADD CONSTRAINT "client_draft_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "client_draft" ADD CONSTRAINT "client_draft_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
