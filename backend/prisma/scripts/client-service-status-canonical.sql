-- Canonicalize client.service_status and enforce the allowed customer filter set.
-- Allowed values: waiting, replacement_requested, active, completed, terminated.

BEGIN;

UPDATE "client"
SET "service_status" = 'waiting'
WHERE "service_status" = 'pending';

UPDATE "client"
SET "service_status" = 'terminated'
WHERE "service_status" IN ('inactive', 'cancelled');

ALTER TABLE "client"
  DROP CONSTRAINT IF EXISTS "client_service_status_allowed";

ALTER TABLE "client"
  ADD CONSTRAINT "client_service_status_allowed"
  CHECK (
    "service_status" IS NULL OR
    "service_status" IN (
      'waiting',
      'replacement_requested',
      'active',
      'completed',
      'terminated'
    )
  );

COMMIT;
