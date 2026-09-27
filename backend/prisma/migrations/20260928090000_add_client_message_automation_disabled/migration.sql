-- Durable per-client opt-out for all automatic message materialization and delivery.
-- The additive default preserves existing behavior for every existing client.
ALTER TABLE "client"
    ADD COLUMN IF NOT EXISTS "message_automation_disabled" BOOLEAN NOT NULL DEFAULT false;
