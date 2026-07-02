-- CreateTable
CREATE TABLE "schedule_change_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "session_index" INTEGER NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "old_end_date" DATE NOT NULL,
    "new_end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "decided_by" UUID,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "schedule_change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_schedule_change_request_schedule" ON "schedule_change_request"("schedule_id");

-- CreateIndex
CREATE INDEX "idx_schedule_change_request_client" ON "schedule_change_request"("client_id");

-- CreateIndex
CREATE INDEX "idx_schedule_change_request_branch" ON "schedule_change_request"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_schedule_change_request_pending" ON "schedule_change_request"("schedule_id") WHERE status = 'pending';

-- AddForeignKey
ALTER TABLE "schedule_change_request" ADD CONSTRAINT "schedule_change_request_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "schedule_change_request" ADD CONSTRAINT "schedule_change_request_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "employee_schedule"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "schedule_change_request" ADD CONSTRAINT "schedule_change_request_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
