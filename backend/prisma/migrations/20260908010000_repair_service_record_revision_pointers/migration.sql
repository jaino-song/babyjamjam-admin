-- Repair the editor foundation's revision pointers without touching legacy
-- content. The old JSON/pointer columns were never authoritative; if a
-- deployment populated either one, fail closed so an operator can migrate it
-- deliberately instead of silently deleting history.

ALTER TABLE "service_record_case"
    ADD COLUMN IF NOT EXISTS "current_revision_id" UUID,
    ADD COLUMN IF NOT EXISTS "current_usable_revision_id" UUID,
    ADD COLUMN IF NOT EXISTS "current_usable_document_version" INTEGER;

DO $$
DECLARE
    has_legacy_content BOOLEAN;
    has_legacy_pointer BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'service_record_case'
          AND column_name = 'current_content'
    ) INTO has_legacy_content;
    IF has_legacy_content THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM "service_record_case" WHERE "current_content" IS NOT NULL)'
            INTO has_legacy_content;
        IF has_legacy_content THEN
            RAISE EXCEPTION 'service_record_case.current_content contains legacy values; refusing destructive pointer migration';
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'service_record_case'
          AND column_name = 'current_usable_document_pointer'
    ) INTO has_legacy_pointer;
    IF has_legacy_pointer THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM "service_record_case" WHERE "current_usable_document_pointer" IS NOT NULL)'
            INTO has_legacy_pointer;
        IF has_legacy_pointer THEN
            RAISE EXCEPTION 'service_record_case.current_usable_document_pointer contains legacy values; refusing destructive pointer migration';
        END IF;
    END IF;
END $$;

ALTER TABLE "service_record_case"
    DROP COLUMN IF EXISTS "current_content",
    DROP COLUMN IF EXISTS "current_usable_document_pointer";

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_service_record_case_branch_id"
    ON "service_record_case" ("branch_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_service_record_revision_branch_case_id"
    ON "service_record_revision" ("branch_id", "service_record_case_id", "id");

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "service_record_edit_draft" draft
        LEFT JOIN "service_record_case" service_case
          ON service_case."id" = draft."service_record_case_id"
         AND service_case."branch_id" = draft."branch_id"
        WHERE service_case."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'service_record_edit_draft has a cross-branch case reference; refusing pointer migration';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "service_record_revision" revision
        LEFT JOIN "service_record_case" service_case
          ON service_case."id" = revision."service_record_case_id"
         AND service_case."branch_id" = revision."branch_id"
        WHERE service_case."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'service_record_revision has a cross-branch case reference; refusing pointer migration';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "service_record_case" service_case
        LEFT JOIN "service_record_revision" revision
          ON revision."id" = service_case."current_revision_id"
         AND revision."branch_id" = service_case."branch_id"
         AND revision."service_record_case_id" = service_case."id"
        WHERE service_case."current_revision_id" IS NOT NULL
          AND revision."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'service_record_case.current_revision_id is not a branch-owned revision';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "service_record_case" service_case
        LEFT JOIN "service_record_revision" revision
          ON revision."id" = service_case."current_usable_revision_id"
         AND revision."branch_id" = service_case."branch_id"
         AND revision."service_record_case_id" = service_case."id"
        WHERE service_case."current_usable_revision_id" IS NOT NULL
          AND revision."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'service_record_case.current_usable_revision_id is not a branch-owned revision';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "service_record_case"
        WHERE ("current_usable_revision_id" IS NULL) <> ("current_usable_document_version" IS NULL)
           OR ("current_usable_document_version" IS NOT NULL AND "current_usable_document_version" <= 0)
    ) THEN
        RAISE EXCEPTION 'service_record_case usable document pointer must be null or a positive revision/version pair';
    END IF;

    ALTER TABLE "service_record_edit_draft"
        DROP CONSTRAINT IF EXISTS "service_record_edit_draft_service_record_case_id_fkey";
    ALTER TABLE "service_record_revision"
        DROP CONSTRAINT IF EXISTS "service_record_revision_service_record_case_id_fkey";

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_edit_draft_case_branch_fkey'
          AND conrelid = 'public.service_record_edit_draft'::regclass
    ) THEN
        ALTER TABLE "service_record_edit_draft"
            ADD CONSTRAINT "service_record_edit_draft_case_branch_fkey"
            FOREIGN KEY ("branch_id", "service_record_case_id")
            REFERENCES "service_record_case" ("branch_id", "id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_revision_case_branch_fkey'
          AND conrelid = 'public.service_record_revision'::regclass
    ) THEN
        ALTER TABLE "service_record_revision"
            ADD CONSTRAINT "service_record_revision_case_branch_fkey"
            FOREIGN KEY ("branch_id", "service_record_case_id")
            REFERENCES "service_record_case" ("branch_id", "id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_case_current_revision_fkey'
          AND conrelid = 'public.service_record_case'::regclass
    ) THEN
        ALTER TABLE "service_record_case"
            ADD CONSTRAINT "service_record_case_current_revision_fkey"
            FOREIGN KEY ("branch_id", "id", "current_revision_id")
            REFERENCES "service_record_revision" ("branch_id", "service_record_case_id", "id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_case_current_usable_revision_fkey'
          AND conrelid = 'public.service_record_case'::regclass
    ) THEN
        ALTER TABLE "service_record_case"
            ADD CONSTRAINT "service_record_case_current_usable_revision_fkey"
            FOREIGN KEY ("branch_id", "id", "current_usable_revision_id")
            REFERENCES "service_record_revision" ("branch_id", "service_record_case_id", "id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'service_record_case_usable_document_pointer_check'
          AND conrelid = 'public.service_record_case'::regclass
    ) THEN
        ALTER TABLE "service_record_case"
            ADD CONSTRAINT "service_record_case_usable_document_pointer_check"
            CHECK (
                ("current_usable_revision_id" IS NULL AND "current_usable_document_version" IS NULL)
                OR (
                    "current_usable_revision_id" IS NOT NULL
                    AND "current_usable_document_version" IS NOT NULL
                    AND "current_usable_document_version" > 0
                )
            );
    END IF;
END $$;
