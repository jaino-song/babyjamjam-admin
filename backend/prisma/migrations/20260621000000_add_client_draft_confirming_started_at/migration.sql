-- Track when a client_draft transitions PENDING -> CONFIRMING so the stuck-CONFIRMING
-- sweep can compare against that moment instead of the draft's createdAt. With createdAt,
-- a draft created N minutes ago that just now entered CONFIRMING is immediately eligible
-- for reset, opening a race where an in-flight confirm can be reverted to PENDING and
-- re-applied (duplicate client / duplicate update).
-- Additive-only: nullable column, no default, no backfill required. Pre-existing rows in
-- CONFIRMING (if any) fall through the sweep's null-branch which retains the old createdAt
-- behavior so they are not stranded.
ALTER TABLE "client_draft"
    ADD COLUMN "confirming_started_at" TIMESTAMPTZ(6);
