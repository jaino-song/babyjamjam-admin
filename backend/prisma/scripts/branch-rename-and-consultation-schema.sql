-- Safe branch rename and consultation inquiry schema.
-- Run only after confirming the target database. This script is idempotent for
-- the intended organization -> branch cutover and preserves existing row data.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.organization') IS NOT NULL
     AND to_regclass('public.branch') IS NULL THEN
    ALTER TABLE "organization" RENAME TO "branch";
  END IF;

  IF to_regclass('public.user_organization') IS NOT NULL
     AND to_regclass('public.user_branch') IS NULL THEN
    ALTER TABLE "user_organization" RENAME TO "user_branch";
  END IF;
END $$;

ALTER TABLE "branch"
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "district" TEXT,
  ADD COLUMN IF NOT EXISTS "branch_type" TEXT,
  ADD COLUMN IF NOT EXISTS "business_hours" TEXT;

DO $$
DECLARE
  v_table_name TEXT;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'area',
    'client',
    'document',
    'document_category',
    'eformsign_doc',
    'employee',
    'employee_schedule',
    'message',
    'message_template',
    'notification',
    'alimtalk_log',
    'alimtalk_trigger_rule',
    'alimtalk_trigger_job',
    'user_branch'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table_name
        AND column_name = 'organization_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table_name
        AND column_name = 'branch_id'
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN organization_id TO branch_id', v_table_name);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_flow_state'
      AND column_name = 'requires_org_selection'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_flow_state'
      AND column_name = 'requires_branch_selection'
  ) THEN
    ALTER TABLE "auth_flow_state"
      RENAME COLUMN "requires_org_selection" TO "requires_branch_selection";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "consultation_inquiry" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "branch_id" UUID NOT NULL,
  "public_branch_slug" TEXT NOT NULL,
  "mother_name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "due_date" DATE NOT NULL,
  "birth_experience" TEXT NOT NULL,
  "voucher_type" TEXT,
  "preferred_caregiver_name" TEXT,
  "referral_source" TEXT NOT NULL,
  "privacy_accepted_at" TIMESTAMPTZ(6) NOT NULL,
  "selected_services" JSONB,
  "additional_notes" TEXT,
  "source" TEXT NOT NULL DEFAULT 'website',
  "status" TEXT NOT NULL DEFAULT 'new',
  "read_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "consultation_inquiry_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

ALTER TABLE "consultation_inquiry"
  ADD COLUMN IF NOT EXISTS "selected_services" JSONB,
  ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_branch_region"
  ON "branch" ("region");
CREATE INDEX IF NOT EXISTS "idx_consultation_inquiry_branch_created"
  ON "consultation_inquiry" ("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_consultation_inquiry_branch_status"
  ON "consultation_inquiry" ("branch_id", "status");
CREATE INDEX IF NOT EXISTS "idx_consultation_inquiry_branch_read_at"
  ON "consultation_inquiry" ("branch_id", "read_at");
CREATE INDEX IF NOT EXISTS "idx_consultation_inquiry_phone"
  ON "consultation_inquiry" ("phone");
CREATE INDEX IF NOT EXISTS "idx_consultation_inquiry_public_branch_slug"
  ON "consultation_inquiry" ("public_branch_slug");

ALTER INDEX IF EXISTS "idx_organization_is_active" RENAME TO "idx_branch_is_active";
ALTER INDEX IF EXISTS "idx_organization_owner" RENAME TO "idx_branch_owner";
ALTER INDEX IF EXISTS "idx_organization_slug" RENAME TO "idx_branch_slug";
ALTER INDEX IF EXISTS "idx_organization_sms_sender_approval_status"
  RENAME TO "idx_branch_sms_sender_approval_status";
ALTER INDEX IF EXISTS "idx_user_organization_org" RENAME TO "idx_user_branch_branch";
ALTER INDEX IF EXISTS "idx_user_organization_user" RENAME TO "idx_user_branch_user";
ALTER INDEX IF EXISTS "idx_user_organization_user_org" RENAME TO "idx_user_branch_user_branch";

COMMIT;
