BEGIN;

ALTER TABLE "employee_schedule"
  ADD COLUMN IF NOT EXISTS "incarnation_id" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS "employee_schedule_incarnation_id_key"
  ON "employee_schedule" ("incarnation_id");

CREATE OR REPLACE FUNCTION "reject_employee_schedule_incarnation_change"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."incarnation_id" IS DISTINCT FROM OLD."incarnation_id" THEN
    RAISE EXCEPTION 'Schedule incarnation identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "employee_schedule_incarnation_immutable" ON "employee_schedule";

CREATE TRIGGER "employee_schedule_incarnation_immutable"
  BEFORE UPDATE OF "incarnation_id" ON "employee_schedule"
  FOR EACH ROW EXECUTE FUNCTION "reject_employee_schedule_incarnation_change"();

COMMIT;
