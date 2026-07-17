-- BJJ-276: server-side rotating refresh sessions and branch membership uniqueness.
-- This patch is additive and idempotent so the database-patches workflow can re-run it.

CREATE TEMP TABLE "auth_session_cutover_state" AS
SELECT to_regclass('public.auth_session') IS NULL AS "first_cutover";

WITH ranked_memberships AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "user_id", "branch_id"
            ORDER BY ("role" IS NULL), "joined_at" ASC NULLS LAST, "id" ASC
        ) AS row_number
    FROM "user_branch"
)
DELETE FROM "user_branch"
WHERE "id" IN (
    SELECT "id"
    FROM ranked_memberships
    WHERE row_number > 1
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_branch_user_id_branch_id_key'
    ) THEN
        ALTER TABLE "user_branch"
            ADD CONSTRAINT "user_branch_user_id_branch_id_key"
            UNIQUE ("user_id", "branch_id");
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "auth_session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "selected_branch_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_session_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE,
    CONSTRAINT "auth_session_selected_branch_id_fkey"
        FOREIGN KEY ("selected_branch_id") REFERENCES "branch"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "auth_refresh_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "secret_hash" VARCHAR NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_token_id" UUID,
    "active_marker" VARCHAR DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "auth_refresh_token_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_refresh_token_session_id_fkey"
        FOREIGN KEY ("session_id") REFERENCES "auth_session"("id") ON DELETE CASCADE
);

ALTER TABLE "auth_flow_state"
    ADD COLUMN IF NOT EXISTS "session_id" UUID;
ALTER TABLE "auth_flow_state"
    DROP COLUMN IF EXISTS "access_token",
    DROP COLUMN IF EXISTS "refresh_token";

ALTER TABLE "auth_refresh_token"
    ADD COLUMN IF NOT EXISTS "active_marker" VARCHAR DEFAULT 'active';

UPDATE "auth_refresh_token"
SET "active_marker" = NULL
WHERE "used_at" IS NOT NULL OR "revoked_at" IS NOT NULL;

WITH ranked_active_tokens AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "session_id"
            ORDER BY "created_at" DESC, "id" DESC
        ) AS row_number
    FROM "auth_refresh_token"
    WHERE "used_at" IS NULL
      AND "revoked_at" IS NULL
)
UPDATE "auth_refresh_token" AS token
SET
    "active_marker" = CASE
        WHEN ranked.row_number = 1 THEN 'active'
        ELSE NULL
    END,
    "revoked_at" = CASE
        WHEN ranked.row_number = 1 THEN token."revoked_at"
        ELSE COALESCE(token."revoked_at", NOW())
    END
FROM ranked_active_tokens AS ranked
WHERE token."id" = ranked."id";

CREATE TABLE IF NOT EXISTS "auth_email_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "auth_token_id" UUID NOT NULL,
    "kind" VARCHAR NOT NULL,
    "recipient" VARCHAR NOT NULL,
    "name" VARCHAR,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "claimed_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "error_code" VARCHAR,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "auth_email_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_email_outbox_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_refresh_token_secret_hash_key"
    ON "auth_refresh_token" ("secret_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "auth_refresh_token_session_active_key"
    ON "auth_refresh_token" ("session_id", "active_marker");
CREATE INDEX IF NOT EXISTS "idx_auth_session_user_revoked"
    ON "auth_session" ("user_id", "revoked_at");
CREATE INDEX IF NOT EXISTS "idx_auth_session_expires"
    ON "auth_session" ("expires_at");
CREATE INDEX IF NOT EXISTS "idx_auth_session_selected_branch"
    ON "auth_session" ("selected_branch_id");
CREATE INDEX IF NOT EXISTS "idx_auth_refresh_token_session_created"
    ON "auth_refresh_token" ("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_auth_refresh_token_expires"
    ON "auth_refresh_token" ("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "auth_email_outbox_token_kind_key"
    ON "auth_email_outbox" ("auth_token_id", "kind");
CREATE INDEX IF NOT EXISTS "idx_auth_email_outbox_delivery"
    ON "auth_email_outbox" ("status", "next_attempt_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'auth_email_outbox_auth_token_id_fkey'
    ) THEN
        ALTER TABLE "auth_email_outbox"
            ADD CONSTRAINT "auth_email_outbox_auth_token_id_fkey"
            FOREIGN KEY ("auth_token_id") REFERENCES "auth_token"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

UPDATE "user"
SET "token_version" = "token_version" + 1
WHERE (SELECT "first_cutover" FROM "auth_session_cutover_state");
