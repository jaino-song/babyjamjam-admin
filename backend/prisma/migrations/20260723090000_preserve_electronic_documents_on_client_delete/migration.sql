BEGIN;

-- Customer master data may be physically deleted, while completed electronic
-- document snapshots remain branch-owned records. Both references therefore
-- become nullable and are detached by PostgreSQL during client deletion.
ALTER TABLE "eformsign_doc"
    DROP CONSTRAINT IF EXISTS "eformsign_doc_client_id_fkey";
ALTER TABLE "service_record_case"
    DROP CONSTRAINT IF EXISTS "service_record_case_client_id_fkey";

ALTER TABLE "eformsign_doc"
    ALTER COLUMN "client_id" DROP NOT NULL;
ALTER TABLE "service_record_case"
    ALTER COLUMN "client_id" DROP NOT NULL;

ALTER TABLE "eformsign_doc"
    ADD CONSTRAINT "eformsign_doc_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "client"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "service_record_case"
    ADD CONSTRAINT "service_record_case_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "client"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION NOT VALID;

ALTER TABLE "eformsign_doc"
    VALIDATE CONSTRAINT "eformsign_doc_client_id_fkey";
ALTER TABLE "service_record_case"
    VALIDATE CONSTRAINT "service_record_case_client_id_fkey";

COMMIT;
