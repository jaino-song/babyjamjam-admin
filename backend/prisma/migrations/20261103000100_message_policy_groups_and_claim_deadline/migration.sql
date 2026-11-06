-- Additive rollout: keep these columns and group identities on application rollback.
-- No rule/job identity, dedupe key, or existing default partial index is rewritten.
-- Reapply this entire file through migrate deploy OR the database-patches workflow.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "message_trigger_rule_group" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "recipient_mode" VARCHAR(32) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "message_trigger_rule_group_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "message_trigger_rule" ADD COLUMN IF NOT EXISTS "group_id" TEXT;
ALTER TABLE "message_trigger_job" ADD COLUMN IF NOT EXISTS "processing_deadline_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX IF NOT EXISTS "message_trigger_rule_group_id_branch_id_key"
    ON "message_trigger_rule_group" ("id", "branch_id");
CREATE INDEX IF NOT EXISTS "idx_message_trigger_rule_group_branch_deleted"
    ON "message_trigger_rule_group" ("branch_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_message_trigger_rule_group"
    ON "message_trigger_rule" ("group_id");
CREATE UNIQUE INDEX IF NOT EXISTS "message_trigger_rule_group_id_recipient_type_key"
    ON "message_trigger_rule" ("group_id", "recipient_type");
CREATE INDEX IF NOT EXISTS "idx_message_trigger_job_status_processing_deadline"
    ON "message_trigger_job" ("status", "processing_deadline_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'message_trigger_rule_group'::regclass
          AND conname = 'message_trigger_rule_group_branch_id_fkey'
    ) THEN
        ALTER TABLE "message_trigger_rule_group"
            ADD CONSTRAINT "message_trigger_rule_group_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branch" ("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'message_trigger_rule'::regclass
          AND conname = 'message_trigger_rule_group_id_branch_id_fkey'
    ) THEN
        ALTER TABLE "message_trigger_rule"
            ADD CONSTRAINT "message_trigger_rule_group_id_branch_id_fkey"
            FOREIGN KEY ("group_id", "branch_id")
            REFERENCES "message_trigger_rule_group" ("id", "branch_id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    -- MATCH SIMPLE would otherwise let a grouped child with a null tenant pass.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'message_trigger_rule'::regclass
          AND conname = 'message_trigger_rule_group_requires_branch_check'
    ) THEN
        ALTER TABLE "message_trigger_rule"
            ADD CONSTRAINT "message_trigger_rule_group_requires_branch_check"
            CHECK ("group_id" IS NULL OR "branch_id" IS NOT NULL);
    END IF;
END $$;

-- Only ordinary, ungrouped legacy rules get a deterministic singleton identity.
-- An existing group (including BOTH and legacy POST singleton groups) is never
-- renamed, rewritten, or reattached when an operator reruns this patch.
INSERT INTO "message_trigger_rule_group" (
    "id", "branch_id", "name", "recipient_mode", "version", "created_at", "updated_at"
)
SELECT 'legacy-rule:' || rule."id", rule."branch_id", rule."name",
       rule."recipient_type", 1, rule."created_at", rule."updated_at"
FROM "message_trigger_rule" AS rule
WHERE rule."group_id" IS NULL
  AND rule."branch_id" IS NOT NULL
  AND rule."is_default" = false
  AND rule."deleted_at" IS NULL
  AND rule."id" NOT LIKE 'system:%'
  AND rule."id" NOT LIKE 'agent-sms:%'
ON CONFLICT DO NOTHING;

UPDATE "message_trigger_rule" AS rule
SET "group_id" = 'legacy-rule:' || rule."id"
WHERE rule."group_id" IS NULL
  AND rule."branch_id" IS NOT NULL
  AND rule."is_default" = false
  AND rule."deleted_at" IS NULL
  AND rule."id" NOT LIKE 'system:%'
  AND rule."id" NOT LIKE 'agent-sms:%';

-- Preserve the snapshot of any newer claim and all pending/terminal rows.
UPDATE "message_trigger_job"
SET "processing_deadline_at" = "updated_at" + INTERVAL '10 minutes'
WHERE "processing_deadline_at" IS NULL
  AND "status" IN ('processing', 'dispatching');

COMMIT;
