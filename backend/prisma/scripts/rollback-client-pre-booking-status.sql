DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "client"
    WHERE "service_status" = 'pre_booking'
  ) THEN
    RAISE EXCEPTION 'Cannot roll back pre_booking while client rows still use it';
  END IF;
END
$$;

BEGIN;

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
  ) NOT VALID;

ALTER TABLE "client"
  VALIDATE CONSTRAINT "client_service_status_allowed";

COMMIT;
