ALTER TABLE "eformsign_doc" ADD COLUMN IF NOT EXISTS "document_kind" TEXT;
ALTER TABLE "eformsign_doc" ADD COLUMN IF NOT EXISTS "employee_schedule_id" INTEGER;
ALTER TABLE "eformsign_doc" ADD COLUMN IF NOT EXISTS "template_id" TEXT;

UPDATE "eformsign_doc" AS d
SET "document_kind" = 'contract'
FROM "client" AS c
WHERE c."e_doc_id" = d."document_id"
  AND d."document_kind" IS NULL;

WITH normalized_feedback_candidates AS (
  SELECT
    d."id" AS doc_id,
    s."id" AS schedule_id,
    COUNT(*) OVER (PARTITION BY d."id") AS match_count
  FROM "eformsign_doc" AS d
  JOIN "employee" AS e
    ON regexp_replace(COALESCE(e."phone", ''), '[^0-9]', '', 'g') =
       regexp_replace(COALESCE(d."step_recipient_sms", ''), '[^0-9]', '', 'g')
  JOIN "employee_schedule" AS s
    ON s."primary_employee_id" = e."id"
   AND s."client_id" = d."client_id"
   AND s."branch_id" IS NOT DISTINCT FROM d."branch_id"
  WHERE d."employee_schedule_id" IS NULL
    AND d."document_kind" IS NULL
    AND regexp_replace(COALESCE(d."step_recipient_sms", ''), '[^0-9]', '', 'g') <> ''
    AND (
      d."step_name" ILIKE '%제공기록%'
      OR d."step_name" ILIKE '%기록지%'
      OR d."step_name" ILIKE '%서비스%'
    )
),
unique_feedback_candidates AS (
  SELECT doc_id, schedule_id
  FROM normalized_feedback_candidates
  WHERE match_count = 1
)
UPDATE "eformsign_doc" AS d
SET
  "document_kind" = 'service_feedback_snapshot',
  "employee_schedule_id" = u.schedule_id
FROM unique_feedback_candidates AS u
WHERE d."id" = u.doc_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "eformsign_doc" AS d
    WHERE d."document_kind" IS NOT NULL
      AND d."document_kind" NOT IN ('contract', 'service_feedback_snapshot')
  ) THEN
    RAISE EXCEPTION 'eformsign_doc contains unsupported document_kind values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "eformsign_doc" AS d
    LEFT JOIN "employee_schedule" AS s ON s."id" = d."employee_schedule_id"
    WHERE d."employee_schedule_id" IS NOT NULL
      AND (
        s."id" IS NULL
        OR (
          d."branch_id" IS NOT NULL
          AND s."branch_id" IS NOT NULL
          AND d."branch_id" <> s."branch_id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'eformsign_doc.employee_schedule_id contains missing or cross-branch schedule references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "message_trigger_rule" AS r
    LEFT JOIN "branch" AS b ON b."id" = r."branch_id"
    WHERE r."branch_id" IS NOT NULL
      AND b."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'message_trigger_rule.branch_id contains missing branch references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "message_trigger_job" AS j
    LEFT JOIN "branch" AS b ON b."id" = j."branch_id"
    WHERE j."branch_id" IS NOT NULL
      AND b."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'message_trigger_job.branch_id contains missing branch references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "message_log" AS l
    LEFT JOIN "branch" AS b ON b."id" = l."branch_id"
    WHERE l."branch_id" IS NOT NULL
      AND b."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'message_log.branch_id contains missing branch references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "message_trigger_job" AS j
    LEFT JOIN "message_trigger_rule" AS r ON r."id" = j."rule_id"
    WHERE r."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'message_trigger_job.rule_id contains missing rule references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "message_trigger_job" AS j
    LEFT JOIN "client" AS c ON c."id" = j."client_id"
    WHERE j."client_id" IS NOT NULL
      AND (
        c."id" IS NULL
        OR (
          j."branch_id" IS NOT NULL
          AND c."branch_id" IS NOT NULL
          AND j."branch_id" <> c."branch_id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'message_trigger_job.client_id contains missing or cross-branch client references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "message_trigger_job" AS j
    LEFT JOIN "employee_schedule" AS s ON s."id" = j."employee_schedule_id"
    WHERE j."employee_schedule_id" IS NOT NULL
      AND (
        s."id" IS NULL
        OR (
          j."branch_id" IS NOT NULL
          AND s."branch_id" IS NOT NULL
          AND j."branch_id" <> s."branch_id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'message_trigger_job.employee_schedule_id contains missing or cross-branch schedule references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "message_log" AS l
    LEFT JOIN "client" AS c ON c."id" = l."client_id"
    WHERE l."client_id" IS NOT NULL
      AND (
        c."id" IS NULL
        OR (
          l."branch_id" IS NOT NULL
          AND c."branch_id" IS NOT NULL
          AND l."branch_id" <> c."branch_id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'message_log.client_id contains missing or cross-branch client references';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "message_log" AS l
    LEFT JOIN "message_trigger_job" AS j ON j."id" = l."trigger_job_id"
    WHERE l."trigger_job_id" IS NOT NULL
      AND (
        j."id" IS NULL
        OR (
          l."branch_id" IS NOT NULL
          AND j."branch_id" IS NOT NULL
          AND l."branch_id" <> j."branch_id"
        )
        OR (
          l."client_id" IS NOT NULL
          AND j."client_id" IS NOT NULL
          AND l."client_id" <> j."client_id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'message_log.trigger_job_id contains missing, cross-branch, or cross-client job references';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS "idx_eformsign_doc_document_kind" ON "eformsign_doc"("document_kind");
CREATE INDEX IF NOT EXISTS "idx_eformsign_doc_employee_schedule_id" ON "eformsign_doc"("employee_schedule_id");
CREATE INDEX IF NOT EXISTS "idx_eformsign_doc_template_id" ON "eformsign_doc"("template_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eformsign_doc_document_kind_check'
  ) THEN
    ALTER TABLE "eformsign_doc"
      ADD CONSTRAINT "eformsign_doc_document_kind_check"
      CHECK ("document_kind" IS NULL OR "document_kind" IN ('contract', 'service_feedback_snapshot'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eformsign_doc_employee_schedule_id_fkey'
  ) THEN
    ALTER TABLE "eformsign_doc"
      ADD CONSTRAINT "eformsign_doc_employee_schedule_id_fkey"
      FOREIGN KEY ("employee_schedule_id") REFERENCES "employee_schedule"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_trigger_job_rule_id_fkey'
  ) THEN
    ALTER TABLE "message_trigger_job"
      ADD CONSTRAINT "message_trigger_job_rule_id_fkey"
      FOREIGN KEY ("rule_id") REFERENCES "message_trigger_rule"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_trigger_rule_branch_id_fkey'
  ) THEN
    ALTER TABLE "message_trigger_rule"
      ADD CONSTRAINT "message_trigger_rule_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_trigger_job_branch_id_fkey'
  ) THEN
    ALTER TABLE "message_trigger_job"
      ADD CONSTRAINT "message_trigger_job_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_trigger_job_client_id_fkey'
  ) THEN
    ALTER TABLE "message_trigger_job"
      ADD CONSTRAINT "message_trigger_job_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "client"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_trigger_job_employee_schedule_id_fkey'
  ) THEN
    ALTER TABLE "message_trigger_job"
      ADD CONSTRAINT "message_trigger_job_employee_schedule_id_fkey"
      FOREIGN KEY ("employee_schedule_id") REFERENCES "employee_schedule"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_log_branch_id_fkey'
  ) THEN
    ALTER TABLE "message_log"
      ADD CONSTRAINT "message_log_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "branch"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_log_client_id_fkey'
  ) THEN
    ALTER TABLE "message_log"
      ADD CONSTRAINT "message_log_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "client"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_log_trigger_job_id_fkey'
  ) THEN
    ALTER TABLE "message_log"
      ADD CONSTRAINT "message_log_trigger_job_id_fkey"
      FOREIGN KEY ("trigger_job_id") REFERENCES "message_trigger_job"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END;
$$;
