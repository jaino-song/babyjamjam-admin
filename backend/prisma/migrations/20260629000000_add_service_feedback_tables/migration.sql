-- Daily Service Feedback (BJJ-247): no-login 제공기록지 capture tables.
-- Additive-only: no existing tables, columns, or indexes are dropped or altered.

-- AlterTable: employee gains an optional date-of-birth (YYMMDD), used for the no-login DOB challenge.
ALTER TABLE "employee" ADD COLUMN     "birthday" VARCHAR(6);

-- CreateTable
CREATE TABLE "employee_feedback_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "employee_id" SMALLINT NOT NULL,
    "link_token_hash" TEXT NOT NULL,
    "access_token_hash" TEXT,
    "expected_dob_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_feedback_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "mom_name" TEXT,
    "mom_birth" VARCHAR(6),
    "baby_name" TEXT,
    "baby_birth" VARCHAR(6),
    "delivery_type" TEXT,
    "baby_weight" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_record_day" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "session_index" INTEGER NOT NULL,
    "service_date" DATE NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "etc_service" TEXT,
    "notes" TEXT,
    "payment_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "mom_signature" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_record_day_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_feedback_token_link_token_hash_key" ON "employee_feedback_token"("link_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "employee_feedback_token_access_token_hash_key" ON "employee_feedback_token"("access_token_hash");

-- CreateIndex
CREATE INDEX "idx_employee_feedback_token_schedule" ON "employee_feedback_token"("schedule_id");

-- CreateIndex
CREATE INDEX "idx_employee_feedback_token_branch" ON "employee_feedback_token"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_record_schedule_id_key" ON "service_record"("schedule_id");

-- CreateIndex
CREATE INDEX "idx_service_record_branch" ON "service_record"("branch_id");

-- CreateIndex
CREATE INDEX "idx_service_record_day_branch" ON "service_record_day"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_record_day_schedule_id_session_index_key" ON "service_record_day"("schedule_id", "session_index");

-- AddForeignKey
ALTER TABLE "employee_feedback_token" ADD CONSTRAINT "employee_feedback_token_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "employee_feedback_token" ADD CONSTRAINT "employee_feedback_token_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "employee_schedule"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "employee_feedback_token" ADD CONSTRAINT "employee_feedback_token_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_record" ADD CONSTRAINT "service_record_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_record" ADD CONSTRAINT "service_record_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "employee_schedule"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_record_day" ADD CONSTRAINT "service_record_day_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_record_day" ADD CONSTRAINT "service_record_day_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "employee_schedule"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
