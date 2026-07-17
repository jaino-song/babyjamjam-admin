-- Allow consultation-only clients to use the pre-booking service status.
-- This is backward compatible with the previous application version.
BEGIN;

ALTER TABLE "client"
  DROP CONSTRAINT IF EXISTS "client_service_status_allowed";

ALTER TABLE "client"
  ADD CONSTRAINT "client_service_status_allowed"
  CHECK (
    "service_status" IS NULL OR
    "service_status" IN (
      'pre_booking',
      'waiting',
      'replacement_requested',
      'active',
      'completed',
      'terminated'
    )
  ) NOT VALID;

ALTER TABLE "client"
  VALIDATE CONSTRAINT "client_service_status_allowed";

COMMIT;
