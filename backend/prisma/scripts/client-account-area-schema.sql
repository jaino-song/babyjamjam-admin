BEGIN;

ALTER TABLE "client"
  ADD COLUMN IF NOT EXISTS "area_id" TEXT;

DO $$
BEGIN
  ALTER TABLE "client"
    ADD CONSTRAINT "client_area_id_fkey"
    FOREIGN KEY ("area_id") REFERENCES "area"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_client_area"
  ON "client" ("area_id");

COMMIT;
