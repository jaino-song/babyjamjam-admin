ALTER TABLE "message_trigger_job"  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "message_trigger_job"  ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ(6);
ALTER TABLE "message_trigger_rule" ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "message_trigger_rule" ADD COLUMN IF NOT EXISTS "jobs_stale" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_message_trigger_rule_default"
ON "message_trigger_rule" ("branch_id", "template_key") WHERE "is_default" = true;
