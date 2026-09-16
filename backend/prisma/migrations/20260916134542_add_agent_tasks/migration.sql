-- This migration is also replayed by the database patch workflow.
-- AlterTable
ALTER TABLE "agent_action" ADD COLUMN IF NOT EXISTS "task_id" TEXT,
ADD COLUMN IF NOT EXISTS "task_revision" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_task" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "capability_id" VARCHAR(100) NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(32) NOT NULL DEFAULT 'collecting',
    "active_slot" INTEGER,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "target_ref" JSONB,
    "target_version" TEXT,
    "active_action_id" TEXT,
    "last_accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "terminal_at" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agent_task_event" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "client_event_id" VARCHAR(100) NOT NULL,
    "task_id" TEXT NOT NULL,
    "operation" VARCHAR(40) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "accepted_revision" INTEGER NOT NULL,
    "result_action_id" TEXT,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_task_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_agent_task_owner_session" ON "agent_task"("user_id", "branch_id", "session_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_agent_task_expiry" ON "agent_task"("expires_at", "purged_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_agent_task_session_active_slot" ON "agent_task"("session_id", "active_slot");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_agent_task_event_task_accepted" ON "agent_task_event"("task_id", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_agent_task_event_owner_session_event" ON "agent_task_event"("user_id", "branch_id", "session_id", "client_event_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_agent_action_task" ON "agent_action"("task_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_action_task_id_fkey'
          AND conrelid = '"agent_action"'::regclass
    ) THEN
        ALTER TABLE "agent_action" ADD CONSTRAINT "agent_action_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_task"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_task_session_id_fkey'
          AND conrelid = '"agent_task"'::regclass
    ) THEN
        ALTER TABLE "agent_task" ADD CONSTRAINT "agent_task_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_task_user_id_fkey'
          AND conrelid = '"agent_task"'::regclass
    ) THEN
        ALTER TABLE "agent_task" ADD CONSTRAINT "agent_task_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_task_branch_id_fkey'
          AND conrelid = '"agent_task"'::regclass
    ) THEN
        ALTER TABLE "agent_task" ADD CONSTRAINT "agent_task_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_task_event_session_id_fkey'
          AND conrelid = '"agent_task_event"'::regclass
    ) THEN
        ALTER TABLE "agent_task_event" ADD CONSTRAINT "agent_task_event_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_task_event_user_id_fkey'
          AND conrelid = '"agent_task_event"'::regclass
    ) THEN
        ALTER TABLE "agent_task_event" ADD CONSTRAINT "agent_task_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_task_event_branch_id_fkey'
          AND conrelid = '"agent_task_event"'::regclass
    ) THEN
        ALTER TABLE "agent_task_event" ADD CONSTRAINT "agent_task_event_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
