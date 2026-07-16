BEGIN;

CREATE TABLE IF NOT EXISTS "service_record_case" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING_FOR_DETAILS',
    "start_date" DATE,
    "end_date" DATE,
    "required_session_count" SMALLINT,
    "form_version" INTEGER NOT NULL DEFAULT 1,
    "mom_name" TEXT,
    "mom_birth" VARCHAR(6),
    "baby_name" TEXT,
    "baby_birth" VARCHAR(6),
    "delivery_type" TEXT,
    "baby_weight" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "finalization_due_at" TIMESTAMPTZ(6),
    "finalization_started_at" TIMESTAMPTZ(6),
    "finalized_at" TIMESTAMPTZ(6),
    "documents_completed_at" TIMESTAMPTZ(6),
    "finalization_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_record_case_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_record_assignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "service_record_case_id" UUID NOT NULL,
    "schedule_id" INTEGER,
    "employee_id" SMALLINT,
    "employee_name_snapshot" TEXT NOT NULL,
    "employee_phone_snapshot" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_record_assignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_record_snapshot_chunk" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "service_record_case_id" UUID NOT NULL,
    "assignment_id" UUID,
    "snapshot_version" INTEGER NOT NULL DEFAULT 1,
    "chunk_index" INTEGER NOT NULL,
    "chunk_count" INTEGER NOT NULL,
    "first_session_index" INTEGER NOT NULL,
    "last_session_index" INTEGER NOT NULL,
    "employee_name_snapshot" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "claimed_at" TIMESTAMPTZ(6),
    "create_attempted_at" TIMESTAMPTZ(6),
    "document_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_record_snapshot_chunk_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "service_record"
    ADD COLUMN IF NOT EXISTS "service_record_case_id" UUID;

ALTER TABLE "service_record_day"
    ADD COLUMN IF NOT EXISTS "service_record_case_id" UUID,
    ADD COLUMN IF NOT EXISTS "case_session_index" INTEGER,
    ADD COLUMN IF NOT EXISTS "employee_id" SMALLINT,
    ADD COLUMN IF NOT EXISTS "employee_name_snapshot" TEXT,
    ADD COLUMN IF NOT EXISTS "form_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "service_record_day"
    ALTER COLUMN "schedule_id" DROP NOT NULL;

-- Guarded for rerunnability: after 20260716090000 renames this table to
-- service_record_token, re-runs of this patch must no-op instead of failing.
DO $$ BEGIN
    IF to_regclass('public.employee_feedback_token') IS NOT NULL THEN
        ALTER TABLE "employee_feedback_token" ADD COLUMN IF NOT EXISTS "service_record_case_id" UUID;
    END IF;
END $$;

ALTER TABLE "eformsign_doc"
    ADD COLUMN IF NOT EXISTS "service_record_case_id" UUID,
    ADD COLUMN IF NOT EXISTS "snapshot_version" INTEGER,
    ADD COLUMN IF NOT EXISTS "snapshot_chunk_index" INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_case_branch_id_fkey') THEN
        ALTER TABLE "service_record_case" ADD CONSTRAINT "service_record_case_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_case_client_id_fkey') THEN
        ALTER TABLE "service_record_case" ADD CONSTRAINT "service_record_case_client_id_fkey"
            FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_assignment_branch_id_fkey') THEN
        ALTER TABLE "service_record_assignment" ADD CONSTRAINT "service_record_assignment_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_assignment_case_id_fkey') THEN
        ALTER TABLE "service_record_assignment" ADD CONSTRAINT "service_record_assignment_case_id_fkey"
            FOREIGN KEY ("service_record_case_id") REFERENCES "service_record_case"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_assignment_schedule_id_fkey') THEN
        ALTER TABLE "service_record_assignment" ADD CONSTRAINT "service_record_assignment_schedule_id_fkey"
            FOREIGN KEY ("schedule_id") REFERENCES "employee_schedule"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_assignment_employee_id_fkey') THEN
        ALTER TABLE "service_record_assignment" ADD CONSTRAINT "service_record_assignment_employee_id_fkey"
            FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_snapshot_chunk_branch_id_fkey') THEN
        ALTER TABLE "service_record_snapshot_chunk" ADD CONSTRAINT "service_record_snapshot_chunk_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_snapshot_chunk_case_id_fkey') THEN
        ALTER TABLE "service_record_snapshot_chunk" ADD CONSTRAINT "service_record_snapshot_chunk_case_id_fkey"
            FOREIGN KEY ("service_record_case_id") REFERENCES "service_record_case"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_snapshot_chunk_assignment_id_fkey') THEN
        ALTER TABLE "service_record_snapshot_chunk" ADD CONSTRAINT "service_record_snapshot_chunk_assignment_id_fkey"
            FOREIGN KEY ("assignment_id") REFERENCES "service_record_assignment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_snapshot_chunk_document_id_fkey') THEN
        ALTER TABLE "service_record_snapshot_chunk" ADD CONSTRAINT "service_record_snapshot_chunk_document_id_fkey"
            FOREIGN KEY ("document_id") REFERENCES "eformsign_doc"("document_id") ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_case_status_check') THEN
        ALTER TABLE "service_record_case" ADD CONSTRAINT "service_record_case_status_check" CHECK ("status" IN (
            'WAITING_FOR_DETAILS', 'WAITING_FOR_ASSIGNMENT', 'SCHEDULED', 'IN_PROGRESS',
            'WAITING_FOR_END', 'AWAITING_COMPLETION', 'READY_TO_FINALIZE', 'FINALIZING',
            'DOCUMENTS_CREATED', 'COMPLETED', 'FINALIZATION_FAILED',
            'TERMINATED_REVIEW_REQUIRED', 'MIGRATION_REVIEW_REQUIRED'
        ));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_snapshot_chunk_status_check') THEN
        ALTER TABLE "service_record_snapshot_chunk" ADD CONSTRAINT "service_record_snapshot_chunk_status_check" CHECK ("status" IN (
            'PENDING', 'CLAIMED', 'CREATE_REQUESTED', 'RECONCILING', 'CREATED', 'FAILED', 'MANUAL_REVIEW'
        ));
    END IF;
END $$;

ALTER TABLE "service_record_day" DROP CONSTRAINT IF EXISTS "service_record_day_schedule_id_fkey";
ALTER TABLE "service_record_day" ADD CONSTRAINT "service_record_day_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "employee_schedule"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_service_record_case_id_fkey') THEN
        ALTER TABLE "service_record" ADD CONSTRAINT "service_record_service_record_case_id_fkey"
            FOREIGN KEY ("service_record_case_id") REFERENCES "service_record_case"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_day_service_record_case_id_fkey') THEN
        ALTER TABLE "service_record_day" ADD CONSTRAINT "service_record_day_service_record_case_id_fkey"
            FOREIGN KEY ("service_record_case_id") REFERENCES "service_record_case"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_record_day_employee_id_fkey') THEN
        ALTER TABLE "service_record_day" ADD CONSTRAINT "service_record_day_employee_id_fkey"
            FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
    IF to_regclass('public.employee_feedback_token') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_feedback_token_service_record_case_id_fkey') THEN
        ALTER TABLE "employee_feedback_token" ADD CONSTRAINT "employee_feedback_token_service_record_case_id_fkey"
            FOREIGN KEY ("service_record_case_id") REFERENCES "service_record_case"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eformsign_doc_service_record_case_id_fkey') THEN
        ALTER TABLE "eformsign_doc" ADD CONSTRAINT "eformsign_doc_service_record_case_id_fkey"
            FOREIGN KEY ("service_record_case_id") REFERENCES "service_record_case"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "service_record_case_client_id_key" ON "service_record_case"("client_id");
CREATE INDEX IF NOT EXISTS "idx_service_record_case_branch_status" ON "service_record_case"("branch_id", "status");
CREATE INDEX IF NOT EXISTS "idx_service_record_case_finalization_due" ON "service_record_case"("status", "finalization_due_at");
CREATE UNIQUE INDEX IF NOT EXISTS "service_record_assignment_schedule_id_key" ON "service_record_assignment"("schedule_id");
CREATE INDEX IF NOT EXISTS "idx_service_record_assignment_branch" ON "service_record_assignment"("branch_id");
CREATE INDEX IF NOT EXISTS "idx_service_record_assignment_case" ON "service_record_assignment"("service_record_case_id");
CREATE INDEX IF NOT EXISTS "idx_service_record_assignment_employee" ON "service_record_assignment"("employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_service_record_snapshot_chunk"
    ON "service_record_snapshot_chunk"("service_record_case_id", "snapshot_version", "chunk_index");
CREATE UNIQUE INDEX IF NOT EXISTS "service_record_snapshot_chunk_document_id_key"
    ON "service_record_snapshot_chunk"("document_id");
CREATE INDEX IF NOT EXISTS "idx_service_record_snapshot_chunk_branch" ON "service_record_snapshot_chunk"("branch_id");
CREATE INDEX IF NOT EXISTS "idx_service_record_snapshot_chunk_retry" ON "service_record_snapshot_chunk"("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "idx_service_record_service_record_case_id" ON "service_record"("service_record_case_id");
CREATE INDEX IF NOT EXISTS "idx_service_record_day_case" ON "service_record_day"("service_record_case_id");
CREATE INDEX IF NOT EXISTS "idx_service_record_day_employee" ON "service_record_day"("employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_service_record_day_case_session"
    ON "service_record_day"("service_record_case_id", "case_session_index");
DO $$ BEGIN
    IF to_regclass('public.employee_feedback_token') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS "idx_employee_feedback_token_service_record_case_id" ON "employee_feedback_token"("service_record_case_id");
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_eformsign_doc_service_record_case_id" ON "eformsign_doc"("service_record_case_id");

INSERT INTO "service_record_case" (
    "branch_id", "client_id", "start_date", "end_date", "required_session_count",
    "finalization_due_at", "status"
)
SELECT
    resolved."branch_id",
    c."id",
    c."start_date",
    c."end_date",
    c."duration",
    CASE
        WHEN c."end_date" IS NULL THEN NULL
        ELSE (c."end_date"::date + TIME '20:00') AT TIME ZONE 'Asia/Seoul'
    END,
    CASE
        WHEN c."start_date" IS NULL OR c."end_date" IS NULL OR c."duration" IS NULL OR c."duration" <= 0
            THEN 'WAITING_FOR_DETAILS'
        WHEN NOT EXISTS (SELECT 1 FROM "employee_schedule" s WHERE s."client_id" = c."id" AND s."replaced" = false)
            THEN 'WAITING_FOR_ASSIGNMENT'
        WHEN c."start_date" > CURRENT_DATE THEN 'SCHEDULED'
        ELSE 'IN_PROGRESS'
    END
FROM "client" c
LEFT JOIN LATERAL (
    SELECT COALESCE(
        c."branch_id",
        (
            SELECT s."branch_id"
            FROM "employee_schedule" s
            WHERE s."client_id" = c."id" AND s."branch_id" IS NOT NULL
            ORDER BY s."replaced" ASC, s."start_date" DESC, s."id" DESC
            LIMIT 1
        ),
        (
            SELECT d."branch_id"
            FROM "eformsign_doc" d
            WHERE d."client_id" = c."id"
              AND d."document_kind" = 'service_feedback_snapshot'
              AND d."branch_id" IS NOT NULL
            ORDER BY d."created_date" DESC, d."id" DESC
            LIMIT 1
        )
    ) AS "branch_id"
) resolved ON true
WHERE resolved."branch_id" IS NOT NULL
  AND (
      c."start_date" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "employee_schedule" s WHERE s."client_id" = c."id")
      OR EXISTS (SELECT 1 FROM "eformsign_doc" d WHERE d."client_id" = c."id" AND d."document_kind" = 'service_feedback_snapshot')
  )
ON CONFLICT ("client_id") DO UPDATE SET
    "branch_id" = EXCLUDED."branch_id",
    "start_date" = EXCLUDED."start_date",
    "end_date" = EXCLUDED."end_date",
    "required_session_count" = EXCLUDED."required_session_count",
    "finalization_due_at" = EXCLUDED."finalization_due_at",
    "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "service_record_assignment" (
    "branch_id", "service_record_case_id", "schedule_id", "employee_id",
    "employee_name_snapshot", "employee_phone_snapshot", "start_date", "end_date"
)
SELECT
    COALESCE(s."branch_id", rc."branch_id"),
    rc."id",
    s."id",
    s."primary_employee_id",
    e."name",
    e."phone",
    s."start_date",
    s."end_date"
FROM "employee_schedule" s
JOIN "service_record_case" rc ON rc."client_id" = s."client_id"
JOIN "employee" e ON e."id" = s."primary_employee_id"
ON CONFLICT ("schedule_id") DO UPDATE SET
    "service_record_case_id" = EXCLUDED."service_record_case_id",
    "employee_id" = EXCLUDED."employee_id",
    "employee_name_snapshot" = EXCLUDED."employee_name_snapshot",
    "employee_phone_snapshot" = EXCLUDED."employee_phone_snapshot",
    "start_date" = EXCLUDED."start_date",
    "end_date" = EXCLUDED."end_date",
    "updated_at" = CURRENT_TIMESTAMP;

UPDATE "service_record" r
SET "service_record_case_id" = rc."id"
FROM "employee_schedule" s
JOIN "service_record_case" rc ON rc."client_id" = s."client_id"
WHERE r."schedule_id" = s."id"
  AND r."service_record_case_id" IS DISTINCT FROM rc."id";

WITH latest_header AS (
    SELECT DISTINCT ON (rc."id")
        rc."id" AS "case_id",
        r."mom_name", r."mom_birth", r."baby_name", r."baby_birth", r."delivery_type", r."baby_weight"
    FROM "service_record_case" rc
    JOIN "employee_schedule" s ON s."client_id" = rc."client_id"
    JOIN "service_record" r ON r."schedule_id" = s."id"
    ORDER BY rc."id", r."updated_at" DESC, r."id" DESC
)
UPDATE "service_record_case" rc
SET
    "mom_name" = COALESCE(rc."mom_name", h."mom_name"),
    "mom_birth" = COALESCE(rc."mom_birth", h."mom_birth"),
    "baby_name" = COALESCE(rc."baby_name", h."baby_name"),
    "baby_birth" = COALESCE(rc."baby_birth", h."baby_birth"),
    "delivery_type" = COALESCE(rc."delivery_type", h."delivery_type"),
    "baby_weight" = COALESCE(rc."baby_weight", h."baby_weight"),
    "updated_at" = CURRENT_TIMESTAMP
FROM latest_header h
WHERE rc."id" = h."case_id";

WITH missing_days AS (
    SELECT
        d."id",
        rc."id" AS "case_id",
        s."primary_employee_id" AS "employee_id",
        e."name" AS "employee_name",
        ROW_NUMBER() OVER (
            PARTITION BY rc."id"
            ORDER BY d."service_date", s."start_date", s."id", d."session_index", d."created_at", d."id"
        )::INTEGER AS "offset_index"
    FROM "service_record_day" d
    JOIN "employee_schedule" s ON s."id" = d."schedule_id"
    JOIN "service_record_case" rc ON rc."client_id" = s."client_id"
    JOIN "employee" e ON e."id" = s."primary_employee_id"
    WHERE d."service_record_case_id" IS NULL OR d."case_session_index" IS NULL
), existing_max AS (
    SELECT "service_record_case_id" AS "case_id", COALESCE(MAX("case_session_index"), 0) AS "max_index"
    FROM "service_record_day"
    WHERE "service_record_case_id" IS NOT NULL AND "case_session_index" IS NOT NULL
    GROUP BY "service_record_case_id"
)
UPDATE "service_record_day" d
SET
    "service_record_case_id" = m."case_id",
    "case_session_index" = COALESCE(x."max_index", 0) + m."offset_index",
    "employee_id" = COALESCE(d."employee_id", m."employee_id"),
    "employee_name_snapshot" = COALESCE(d."employee_name_snapshot", m."employee_name")
FROM missing_days m
LEFT JOIN existing_max x ON x."case_id" = m."case_id"
WHERE d."id" = m."id";

-- Guarded for rerunnability: skip once the table has been renamed to service_record_token
-- (the backfill + dedupe + partial unique index already carried through the rename).
DO $$ BEGIN
    IF to_regclass('public.employee_feedback_token') IS NOT NULL THEN
        UPDATE "employee_feedback_token" t
        SET "service_record_case_id" = rc."id"
        FROM "employee_schedule" s
        JOIN "service_record_case" rc ON rc."client_id" = s."client_id"
        WHERE t."schedule_id" = s."id"
          AND t."service_record_case_id" IS DISTINCT FROM rc."id";

        WITH active_tokens AS (
            SELECT
                t."id",
                ROW_NUMBER() OVER (
                    PARTITION BY t."service_record_case_id"
                    ORDER BY t."created_at" DESC, t."id" DESC
                ) AS "rank"
            FROM "employee_feedback_token" t
            WHERE t."service_record_case_id" IS NOT NULL AND t."active" = true
        )
        UPDATE "employee_feedback_token" t
        SET "active" = false, "revoked_at" = COALESCE(t."revoked_at", CURRENT_TIMESTAMP)
        FROM active_tokens a
        WHERE t."id" = a."id" AND a."rank" > 1;

        CREATE UNIQUE INDEX IF NOT EXISTS "uniq_employee_feedback_token_active_case"
            ON "employee_feedback_token"("service_record_case_id")
            WHERE "active" = true AND "service_record_case_id" IS NOT NULL;
    END IF;
END $$;

UPDATE "eformsign_doc" d
SET "service_record_case_id" = rc."id"
FROM "service_record_case" rc
WHERE d."client_id" = rc."client_id"
  AND d."document_kind" = 'service_feedback_snapshot'
  AND d."service_record_case_id" IS DISTINCT FROM rc."id";

WITH ranked_docs AS (
    SELECT
        d."id",
        ROW_NUMBER() OVER (
            PARTITION BY d."service_record_case_id"
            ORDER BY d."created_date", d."id"
        )::INTEGER AS "chunk_index"
    FROM "eformsign_doc" d
    WHERE d."document_kind" = 'service_feedback_snapshot'
      AND d."service_record_case_id" IS NOT NULL
)
UPDATE "eformsign_doc" d
SET "snapshot_version" = COALESCE(d."snapshot_version", 1),
    "snapshot_chunk_index" = COALESCE(d."snapshot_chunk_index", r."chunk_index")
FROM ranked_docs r
WHERE d."id" = r."id";

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_eformsign_doc_service_record_chunk"
    ON "eformsign_doc"("service_record_case_id", "snapshot_version", "snapshot_chunk_index");

WITH legacy_docs AS (
    SELECT
        d.*,
        COUNT(*) OVER (PARTITION BY d."service_record_case_id")::INTEGER AS "chunk_count",
        a."id" AS "assignment_id",
        COALESCE(a."employee_name_snapshot", d."step_recipient_name", '미확인 제공인력') AS "employee_name"
    FROM "eformsign_doc" d
    LEFT JOIN "service_record_assignment" a ON a."schedule_id" = d."employee_schedule_id"
    WHERE d."document_kind" = 'service_feedback_snapshot'
      AND d."service_record_case_id" IS NOT NULL
)
INSERT INTO "service_record_snapshot_chunk" (
    "branch_id", "service_record_case_id", "assignment_id", "snapshot_version",
    "chunk_index", "chunk_count", "first_session_index", "last_session_index",
    "employee_name_snapshot", "source_hash", "status", "document_id"
)
SELECT
    COALESCE(d."branch_id", rc."branch_id"),
    d."service_record_case_id",
    d."assignment_id",
    COALESCE(d."snapshot_version", 1),
    COALESCE(d."snapshot_chunk_index", 1),
    d."chunk_count",
    ((COALESCE(d."snapshot_chunk_index", 1) - 1) * 5) + 1,
    LEAST(COALESCE(rc."required_session_count", COALESCE(d."snapshot_chunk_index", 1) * 5), COALESCE(d."snapshot_chunk_index", 1) * 5),
    d."employee_name",
    'legacy:' || d."document_id",
    'CREATED',
    d."document_id"
FROM legacy_docs d
JOIN "service_record_case" rc ON rc."id" = d."service_record_case_id"
ON CONFLICT ("service_record_case_id", "snapshot_version", "chunk_index") DO NOTHING;

WITH case_progress AS (
    SELECT
        rc."id",
        COUNT(d."id") FILTER (
            WHERE d."locked" = true AND d."mom_approval" = 'approved'
        )::INTEGER AS "approved_locked_count",
        COUNT(d."id")::INTEGER AS "day_count",
        (
            NULLIF(BTRIM(rc."mom_name"), '') IS NOT NULL
            AND NULLIF(BTRIM(rc."mom_birth"), '') IS NOT NULL
            AND NULLIF(BTRIM(rc."baby_name"), '') IS NOT NULL
            AND NULLIF(BTRIM(rc."baby_birth"), '') IS NOT NULL
            AND NULLIF(BTRIM(rc."delivery_type"), '') IS NOT NULL
            AND NULLIF(BTRIM(rc."baby_weight"), '') IS NOT NULL
        ) AS "has_complete_header",
        EXISTS (
            SELECT 1 FROM "service_record_snapshot_chunk" sc
            WHERE sc."service_record_case_id" = rc."id" AND sc."status" = 'CREATED'
        ) AS "has_documents",
        EXISTS (
            SELECT 1 FROM "employee_schedule" s
            WHERE s."client_id" = rc."client_id" AND s."replaced" = false
        ) AS "has_assignment"
    FROM "service_record_case" rc
    LEFT JOIN "service_record_day" d ON d."service_record_case_id" = rc."id"
    GROUP BY rc."id"
)
UPDATE "service_record_case" rc
SET
    "completed_at" = CASE
        WHEN rc."required_session_count" > 0
             AND p."day_count" = rc."required_session_count"
             AND p."approved_locked_count" = rc."required_session_count"
             AND p."has_complete_header"
            THEN COALESCE(rc."completed_at", CURRENT_TIMESTAMP)
        ELSE NULL
    END,
    "status" = CASE
        WHEN p."has_documents" THEN 'DOCUMENTS_CREATED'
        WHEN rc."start_date" IS NULL OR rc."end_date" IS NULL OR rc."required_session_count" IS NULL OR rc."required_session_count" <= 0
            THEN 'WAITING_FOR_DETAILS'
        WHEN NOT p."has_assignment" THEN 'WAITING_FOR_ASSIGNMENT'
        WHEN rc."required_session_count" > 0
             AND p."day_count" = rc."required_session_count"
             AND p."approved_locked_count" = rc."required_session_count"
             AND p."has_complete_header"
             AND rc."finalization_due_at" <= CURRENT_TIMESTAMP THEN 'READY_TO_FINALIZE'
        WHEN rc."required_session_count" > 0
             AND p."day_count" = rc."required_session_count"
             AND p."approved_locked_count" = rc."required_session_count"
             AND p."has_complete_header" THEN 'WAITING_FOR_END'
        WHEN rc."finalization_due_at" <= CURRENT_TIMESTAMP THEN 'AWAITING_COMPLETION'
        WHEN rc."start_date" > CURRENT_DATE THEN 'SCHEDULED'
        ELSE 'IN_PROGRESS'
    END,
    "updated_at" = CURRENT_TIMESTAMP
FROM case_progress p
WHERE rc."id" = p."id"
  AND rc."status" IN ('WAITING_FOR_DETAILS', 'WAITING_FOR_ASSIGNMENT', 'SCHEDULED', 'IN_PROGRESS', 'WAITING_FOR_END', 'AWAITING_COMPLETION');

WITH ambiguous AS (
    SELECT rc."id"
    FROM "service_record_case" rc
    LEFT JOIN "service_record_day" d ON d."service_record_case_id" = rc."id"
    GROUP BY rc."id", rc."required_session_count"
    HAVING COUNT(d."id") > COALESCE(rc."required_session_count", 0) AND COALESCE(rc."required_session_count", 0) > 0
)
UPDATE "service_record_case" rc
SET "status" = 'MIGRATION_REVIEW_REQUIRED',
    "last_error" = 'Legacy service-record rows exceed the configured session count',
    "updated_at" = CURRENT_TIMESTAMP
FROM ambiguous a
WHERE rc."id" = a."id"
  AND rc."status" NOT IN ('DOCUMENTS_CREATED', 'COMPLETED');

COMMIT;
