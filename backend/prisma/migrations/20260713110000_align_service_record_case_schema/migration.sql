BEGIN;

ALTER TABLE "service_record_case"
    ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "service_record_assignment"
    ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "service_record_snapshot_chunk"
    ALTER COLUMN "updated_at" DROP DEFAULT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_assignment_case_id_fkey'
          AND conrelid = 'service_record_assignment'::regclass
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_assignment_service_record_case_id_fkey'
          AND conrelid = 'service_record_assignment'::regclass
    ) THEN
        ALTER TABLE "service_record_assignment"
            RENAME CONSTRAINT "service_record_assignment_case_id_fkey"
            TO "service_record_assignment_service_record_case_id_fkey";
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_snapshot_chunk_case_id_fkey'
          AND conrelid = 'service_record_snapshot_chunk'::regclass
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_snapshot_chunk_service_record_case_id_fkey'
          AND conrelid = 'service_record_snapshot_chunk'::regclass
    ) THEN
        ALTER TABLE "service_record_snapshot_chunk"
            RENAME CONSTRAINT "service_record_snapshot_chunk_case_id_fkey"
            TO "service_record_snapshot_chunk_service_record_case_id_fkey";
    END IF;
END $$;

COMMIT;
