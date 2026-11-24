BEGIN;

-- CreateTable
CREATE TABLE IF NOT EXISTS "auth_phone_challenge" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" VARCHAR(32) NOT NULL,
    "token_hash" TEXT NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "code_hash" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "user_id" UUID,
    "kakao_id" VARCHAR,
    "email" VARCHAR,
    "password_hash" VARCHAR,
    "name" VARCHAR,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_phone_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "auth_phone_challenge_token_hash_key" ON "auth_phone_challenge"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "auth_phone_challenge_phone_created_at_idx" ON "auth_phone_challenge"("phone", "created_at");


-- Backend-only evidence; preserve migration/backend owner access, add no roles or policies.
ALTER TABLE "auth_phone_challenge" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "auth_phone_challenge" FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.auth_phone_challenge FROM %I', api_role);
        END IF;
    END LOOP;
END $$;

COMMIT;
