-- BJJ-260: account approval workflow + token versioning + shared rate-limit store.
-- Idempotent by construction — this file is re-executed on every database-patches run.

-- 1) approval_status.
--    Add NULLABLE first so we can distinguish pre-existing rows (NULL) from new
--    self-registrations (the app always writes an explicit 'pending'). Backfill only
--    the legacy NULL rows to 'approved' (never lock out existing users), THEN enforce
--    default + NOT NULL. On re-run there are no NULL rows, so the UPDATE is a no-op and
--    new 'pending' applicants are never flipped to 'approved'.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR;
UPDATE "user" SET "approval_status" = 'approved' WHERE "approval_status" IS NULL;
ALTER TABLE "user" ALTER COLUMN "approval_status" SET DEFAULT 'pending';
ALTER TABLE "user" ALTER COLUMN "approval_status" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_approval_status_check') THEN
        ALTER TABLE "user" ADD CONSTRAINT "user_approval_status_check"
            CHECK ("approval_status" IN ('pending', 'approved', 'rejected'));
    END IF;
END $$;

-- 2) Approval metadata + the (non-authoritative) role the applicant requested at signup.
--    requested_role is display-only for the approving owner; it is NEVER used for authz.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ(6);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "approved_by" UUID;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "requested_role" VARCHAR;

-- 3) token_version. Embedded in every issued JWT; bumping it invalidates all prior tokens
--    for that user (password reset, rejection, role/membership change). Existing tokens carry
--    no version claim and are rejected fail-closed by the strategy, forcing a one-time re-login.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "token_version" INTEGER NOT NULL DEFAULT 0;

-- 4) auth_rate_limit — atomic, shared (multi-instance) rate-limit counter keyed by a hashed
--    identity/IP key and a fixed time window. Replaces the per-process in-memory Map.
CREATE TABLE IF NOT EXISTS "auth_rate_limit" (
    "key_hash"     VARCHAR NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count"        INTEGER NOT NULL DEFAULT 0,
    "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "auth_rate_limit_pkey" PRIMARY KEY ("key_hash")
);
CREATE INDEX IF NOT EXISTS "idx_auth_rate_limit_window" ON "auth_rate_limit" ("window_start");
