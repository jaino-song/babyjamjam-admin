CREATE TABLE IF NOT EXISTS "auth_flow_state" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" VARCHAR NOT NULL,
  "token_hash" VARCHAR NOT NULL UNIQUE,
  "user_id" UUID,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "requires_org_selection" BOOLEAN NOT NULL DEFAULT FALSE,
  "kakao_id" VARCHAR,
  "email" VARCHAR,
  "name" VARCHAR,
  "profile_image" VARCHAR,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "consumed_at" TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "idx_auth_flow_state_kind_expires_at"
ON "auth_flow_state" ("kind", "expires_at");

ALTER TABLE "auth_flow_state"
ADD COLUMN IF NOT EXISTS "user_id" UUID;
