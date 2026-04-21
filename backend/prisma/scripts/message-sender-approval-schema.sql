ALTER TABLE "branch"
ADD COLUMN IF NOT EXISTS "sms_sender_phone" VARCHAR(20),
ADD COLUMN IF NOT EXISTS "sms_sender_approval_status" VARCHAR(20) NOT NULL DEFAULT 'not_requested',
ADD COLUMN IF NOT EXISTS "sms_sender_approval_requested_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "sms_sender_approval_requested_by" UUID,
ADD COLUMN IF NOT EXISTS "sms_sender_approval_approved_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "sms_sender_approval_approved_by" UUID;

CREATE INDEX IF NOT EXISTS "idx_branch_sms_sender_approval_status"
ON "branch" ("sms_sender_approval_status");
