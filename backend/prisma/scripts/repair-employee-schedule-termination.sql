-- Schedule-only repairs from 20260903000000 for replay after the baby-case key stage.
-- Sibling service-record assignments retain their own date bounds.
ALTER TABLE "employee_schedule"
    ADD COLUMN IF NOT EXISTS "terminated_at" timestamptz(6);

-- Recover the termination date before restoring a valid schedule interval.
UPDATE "employee_schedule"
SET "terminated_at" = COALESCE("terminated_at", "end_date"::timestamptz),
    "end_date"      = GREATEST("start_date", "end_date")
WHERE "start_date" > "end_date";

UPDATE "employee_schedule" s
SET "terminated_at" = c."end_date"::timestamptz
FROM "client" c
WHERE s."client_id" = c."id"
  AND c."service_status" = 'terminated'
  AND c."end_date" IS NOT NULL
  AND s."replaced" = false
  AND s."terminated_at" IS NULL;
