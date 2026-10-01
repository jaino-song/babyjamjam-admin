-- This migration is also replayed by the database patch workflow.
-- CreateTable
CREATE TABLE IF NOT EXISTS "holiday_year_snapshot" (
    "year" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "item_count" INTEGER NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "validated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "holiday_year_snapshot_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "holiday_calendar_revision" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_calendar_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public_holiday" (
    "date" DATE NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_holiday_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "branch_holiday_override" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_holiday_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "holiday_change_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID,
    "date" DATE NOT NULL,
    "change" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100),
    "source" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "holiday_change_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "end_date_review_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "change_event_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "stored_end" DATE NOT NULL,
    "recalculated_end" DATE NOT NULL,
    "category" VARCHAR(10) NOT NULL,
    "reason" VARCHAR(200),
    "status" VARCHAR(10) NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "end_date_review_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_branch_holiday_override_branch_date" ON "branch_holiday_override"("branch_id", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_holiday_change_event_processed_created" ON "holiday_change_event"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_holiday_change_event_branch_created" ON "holiday_change_event"("branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_end_date_review_item_event_client" ON "end_date_review_item"("change_event_id", "client_id");

-- CreateIndex
-- Partial unique index (Prisma cannot model it, see the note on model end_date_review_item):
-- one open review item per client, so a client is never listed twice for review.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_end_date_review_item_client_open" ON "end_date_review_item"("client_id") WHERE "status" = 'open';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_end_date_review_item_branch_client_status" ON "end_date_review_item"("branch_id", "client_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_end_date_review_item_branch_status" ON "end_date_review_item"("branch_id", "status");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'branch_holiday_override_branch_id_fkey'
          AND conrelid = '"branch_holiday_override"'::regclass
    ) THEN
        ALTER TABLE "branch_holiday_override" ADD CONSTRAINT "branch_holiday_override_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'holiday_change_event_branch_id_fkey'
          AND conrelid = '"holiday_change_event"'::regclass
    ) THEN
        ALTER TABLE "holiday_change_event" ADD CONSTRAINT "holiday_change_event_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
-- RESTRICT: an event with review items (kept decisions included) must not be deletable.
-- Self-healing: a database that already holds the earlier CASCADE version is repaired in place.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'end_date_review_item_change_event_id_fkey'
          AND conrelid = '"end_date_review_item"'::regclass
          AND confdeltype <> 'r'
    ) THEN
        ALTER TABLE "end_date_review_item" DROP CONSTRAINT "end_date_review_item_change_event_id_fkey";
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'end_date_review_item_change_event_id_fkey'
          AND conrelid = '"end_date_review_item"'::regclass
    ) THEN
        ALTER TABLE "end_date_review_item" ADD CONSTRAINT "end_date_review_item_change_event_id_fkey" FOREIGN KEY ("change_event_id") REFERENCES "holiday_change_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'end_date_review_item_branch_id_fkey'
          AND conrelid = '"end_date_review_item"'::regclass
    ) THEN
        ALTER TABLE "end_date_review_item" ADD CONSTRAINT "end_date_review_item_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'end_date_review_item_client_id_fkey'
          AND conrelid = '"end_date_review_item"'::regclass
    ) THEN
        ALTER TABLE "end_date_review_item" ADD CONSTRAINT "end_date_review_item_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddCheckConstraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'holiday_calendar_revision_singleton_check'
          AND conrelid = '"holiday_calendar_revision"'::regclass
    ) THEN
        ALTER TABLE "holiday_calendar_revision" ADD CONSTRAINT "holiday_calendar_revision_singleton_check" CHECK ("id" = 1);
    END IF;
END $$;

-- AddCheckConstraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'branch_holiday_override_kind_check'
          AND conrelid = '"branch_holiday_override"'::regclass
    ) THEN
        ALTER TABLE "branch_holiday_override" ADD CONSTRAINT "branch_holiday_override_kind_check" CHECK ("kind" IN ('add', 'exclude'));
    END IF;
END $$;

-- AddCheckConstraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'holiday_change_event_change_check'
          AND conrelid = '"holiday_change_event"'::regclass
    ) THEN
        ALTER TABLE "holiday_change_event" ADD CONSTRAINT "holiday_change_event_change_check" CHECK ("change" IN ('added', 'removed'));
    END IF;
END $$;

-- AddCheckConstraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'end_date_review_item_category_check'
          AND conrelid = '"end_date_review_item"'::regclass
    ) THEN
        ALTER TABLE "end_date_review_item" ADD CONSTRAINT "end_date_review_item_category_check" CHECK ("category" IN ('safe', 'risk'));
    END IF;
END $$;

-- AddCheckConstraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'end_date_review_item_status_check'
          AND conrelid = '"end_date_review_item"'::regclass
    ) THEN
        ALTER TABLE "end_date_review_item" ADD CONSTRAINT "end_date_review_item_status_check" CHECK ("status" IN ('open', 'fixed', 'kept', 'obsolete'));
    END IF;
END $$;

-- Seed the single revision row.
INSERT INTO "holiday_calendar_revision" ("id", "revision") VALUES (1, 0) ON CONFLICT DO NOTHING;
