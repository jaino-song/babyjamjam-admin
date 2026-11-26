-- Additive expand patch. All legacy keys and FK actions stay in place.
-- Reconciliation and preactivation reversal are operator scripts, outside deployment.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, public, pg_temp;

DO $$
BEGIN
    IF to_regtype('public.client_fetal_type') IS NULL THEN
        CREATE TYPE public."client_fetal_type" AS ENUM (
            'SINGLETON', 'SEVERE_SINGLETON', 'TWINS',
            'SEVERE_TWINS', 'TRIPLETS', 'SEVERE_TRIPLETS_PLUS', 'QUADRUPLETS_PLUS'
        );
    END IF;
    IF to_regtype('public.client_fetal_confirmation') IS NULL THEN
        CREATE TYPE public."client_fetal_confirmation" AS ENUM ('UNCONFIRMED', 'CONFIRMED');
    END IF;
END $$;

ALTER TABLE "client"
    ADD COLUMN IF NOT EXISTS "fetal_confirmation" "client_fetal_confirmation",
    ADD COLUMN IF NOT EXISTS "fetal_type" "client_fetal_type";

ALTER TABLE "message_trigger_job" ADD COLUMN IF NOT EXISTS "recipient_employee_id" SMALLINT;

ALTER TABLE "service_record_case" ADD COLUMN IF NOT EXISTS "baby_id" UUID;

CREATE TABLE IF NOT EXISTS public."client_baby" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacy_backfilled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_baby_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."service_record_team_slot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "employee_id" SMALLINT NOT NULL,
    "slot" SMALLINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacy_backfilled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_record_team_slot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."service_record_baby_assignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "baby_id" UUID NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "team_slot_id" UUID NOT NULL,
    "employee_id" SMALLINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "active_owner" BOOLEAN DEFAULT true,
    "legacy_backfilled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "service_record_baby_assignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."service_record_job_member" (
    "job_id" TEXT NOT NULL,
    "service_record_case_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "baby_id" UUID NOT NULL,
    "employee_id" SMALLINT NOT NULL,
    "assignment_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_record_job_member_pkey" PRIMARY KEY ("job_id","service_record_case_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_client_baby_ordinal" ON "client_baby"("branch_id", "client_id", "ordinal");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_client_baby_scope" ON "client_baby"("branch_id", "client_id", "id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_client_baby_active" ON "client_baby"("id", "active");

CREATE INDEX IF NOT EXISTS "idx_record_slot_employee" ON "service_record_team_slot"("branch_id", "employee_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_record_slot_scope" ON "service_record_team_slot"("branch_id", "client_id", "schedule_id", "employee_id", "id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_record_slot_active" ON "service_record_team_slot"("id", "active");

CREATE INDEX IF NOT EXISTS "idx_record_assignment_active_baby" ON "service_record_baby_assignment"("baby_id", "active_owner");

CREATE INDEX IF NOT EXISTS "idx_record_assignment_active_slot" ON "service_record_baby_assignment"("team_slot_id", "active_owner");

CREATE INDEX IF NOT EXISTS "idx_record_assignment_employee"
    ON "service_record_baby_assignment"("branch_id", "employee_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_record_assignment_version" ON "service_record_baby_assignment"("schedule_id", "baby_id", "version");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_record_assignment_member_scope" ON "service_record_baby_assignment"("branch_id", "client_id", "schedule_id", "baby_id", "employee_id", "version");

CREATE INDEX IF NOT EXISTS "idx_record_member_case" ON "service_record_job_member"("branch_id", "client_id", "baby_id", "service_record_case_id");

CREATE INDEX IF NOT EXISTS "idx_record_member_assignment" ON "service_record_job_member"("branch_id", "client_id", "schedule_id", "baby_id", "employee_id", "assignment_version");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_client_baby_owner" ON "client"("branch_id", "id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_employee_record_owner" ON "employee"("branch_id", "id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_schedule_record_owner" ON "employee_schedule"("branch_id", "client_id", "id");

CREATE INDEX IF NOT EXISTS "idx_record_job_recipient" ON "message_trigger_job"("branch_id", "recipient_employee_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_record_job_member_scope" ON "message_trigger_job"("branch_id", "client_id", "employee_schedule_id", "recipient_employee_id", "id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_record_case_baby" ON "service_record_case"("baby_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_record_case_baby_scope" ON "service_record_case"("branch_id", "client_id", "baby_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_record_case_member_scope" ON "service_record_case"("branch_id", "client_id", "baby_id", "id");

-- Partial uniqueness lets historical rows survive retirement and reassignment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_record_team_active_slot
    ON service_record_team_slot (schedule_id, slot) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_record_team_active_employee
    ON service_record_team_slot (schedule_id, employee_id) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_record_assignment_current
    ON service_record_baby_assignment (schedule_id, baby_id) WHERE ended_at IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.message_trigger_job'::regclass
                   AND conname = 'fk_record_job_recipient') THEN
        ALTER TABLE "message_trigger_job" ADD CONSTRAINT "fk_record_job_recipient"
            FOREIGN KEY ("branch_id", "recipient_employee_id") REFERENCES "employee"("branch_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.client_baby'::regclass
                   AND conname = 'fk_client_baby_owner') THEN
        ALTER TABLE "client_baby" ADD CONSTRAINT "fk_client_baby_owner"
            FOREIGN KEY ("branch_id", "client_id") REFERENCES "client"("branch_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_team_slot'::regclass
                   AND conname = 'fk_record_slot_client') THEN
        ALTER TABLE "service_record_team_slot" ADD CONSTRAINT "fk_record_slot_client"
            FOREIGN KEY ("branch_id", "client_id") REFERENCES "client"("branch_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_team_slot'::regclass
                   AND conname = 'fk_record_slot_schedule') THEN
        ALTER TABLE "service_record_team_slot" ADD CONSTRAINT "fk_record_slot_schedule"
            FOREIGN KEY ("branch_id", "client_id", "schedule_id") REFERENCES "employee_schedule"("branch_id", "client_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_team_slot'::regclass
                   AND conname = 'fk_record_slot_employee') THEN
        ALTER TABLE "service_record_team_slot" ADD CONSTRAINT "fk_record_slot_employee"
            FOREIGN KEY ("branch_id", "employee_id") REFERENCES "employee"("branch_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_baby_assignment'::regclass
                   AND conname = 'fk_record_assignment_baby') THEN
        ALTER TABLE "service_record_baby_assignment" ADD CONSTRAINT "fk_record_assignment_baby"
            FOREIGN KEY ("branch_id", "client_id", "baby_id") REFERENCES "client_baby"("branch_id", "client_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_baby_assignment'::regclass
                   AND conname = 'fk_record_assignment_slot') THEN
        ALTER TABLE "service_record_baby_assignment" ADD CONSTRAINT "fk_record_assignment_slot"
            FOREIGN KEY ("branch_id", "client_id", "schedule_id", "employee_id", "team_slot_id") REFERENCES "service_record_team_slot"("branch_id", "client_id", "schedule_id", "employee_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_baby_assignment'::regclass
                   AND conname = 'fk_record_assignment_schedule') THEN
        ALTER TABLE "service_record_baby_assignment" ADD CONSTRAINT "fk_record_assignment_schedule"
            FOREIGN KEY ("branch_id", "client_id", "schedule_id")
            REFERENCES "employee_schedule"("branch_id", "client_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_baby_assignment'::regclass
                   AND conname = 'fk_record_assignment_employee') THEN
        ALTER TABLE "service_record_baby_assignment" ADD CONSTRAINT "fk_record_assignment_employee"
            FOREIGN KEY ("branch_id", "employee_id") REFERENCES "employee"("branch_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_baby_assignment'::regclass
                   AND conname = 'fk_record_assignment_active_baby') THEN
        ALTER TABLE "service_record_baby_assignment" ADD CONSTRAINT "fk_record_assignment_active_baby"
            FOREIGN KEY ("baby_id", "active_owner") REFERENCES "client_baby"("id", "active")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_baby_assignment'::regclass
                   AND conname = 'fk_record_assignment_active_slot') THEN
        ALTER TABLE "service_record_baby_assignment" ADD CONSTRAINT "fk_record_assignment_active_slot"
            FOREIGN KEY ("team_slot_id", "active_owner") REFERENCES "service_record_team_slot"("id", "active")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_job_member'::regclass
                   AND conname = 'fk_record_member_job') THEN
        ALTER TABLE "service_record_job_member" ADD CONSTRAINT "fk_record_member_job"
            FOREIGN KEY ("branch_id", "client_id", "schedule_id", "employee_id", "job_id") REFERENCES "message_trigger_job"("branch_id", "client_id", "employee_schedule_id", "recipient_employee_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_job_member'::regclass
                   AND conname = 'fk_record_member_case') THEN
        ALTER TABLE "service_record_job_member" ADD CONSTRAINT "fk_record_member_case"
            FOREIGN KEY ("branch_id", "client_id", "baby_id", "service_record_case_id") REFERENCES "service_record_case"("branch_id", "client_id", "baby_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_job_member'::regclass
                   AND conname = 'fk_record_member_assignment') THEN
        ALTER TABLE "service_record_job_member" ADD CONSTRAINT "fk_record_member_assignment"
            FOREIGN KEY ("branch_id", "client_id", "schedule_id", "baby_id", "employee_id", "assignment_version") REFERENCES "service_record_baby_assignment"("branch_id", "client_id", "schedule_id", "baby_id", "employee_id", "version")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_case'::regclass
                   AND conname = 'fk_record_case_baby') THEN
        ALTER TABLE "service_record_case" ADD CONSTRAINT "fk_record_case_baby"
            FOREIGN KEY ("branch_id", "client_id", "baby_id") REFERENCES "client_baby"("branch_id", "client_id", "id")
            ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.client'::regclass
                   AND conname = 'ck_client_fetal_confirmation') THEN
        ALTER TABLE "client" ADD CONSTRAINT "ck_client_fetal_confirmation"
            CHECK (fetal_confirmation IS DISTINCT FROM 'CONFIRMED' OR (fetal_type IS NOT NULL AND branch_id IS NOT NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.message_trigger_job'::regclass
                   AND conname = 'ck_record_job_recipient_scope') THEN
        ALTER TABLE "message_trigger_job" ADD CONSTRAINT "ck_record_job_recipient_scope"
            CHECK (recipient_employee_id IS NULL OR (branch_id IS NOT NULL AND client_id IS NOT NULL
            AND employee_schedule_id IS NOT NULL AND template_key = 'SERVICE_RECORD_LINK'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_case'::regclass
                   AND conname = 'ck_record_case_baby_owner') THEN
        ALTER TABLE "service_record_case" ADD CONSTRAINT "ck_record_case_baby_owner"
            CHECK (baby_id IS NULL OR client_id IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.client_baby'::regclass
                   AND conname = 'ck_client_baby_ordinal') THEN
        ALTER TABLE "client_baby" ADD CONSTRAINT "ck_client_baby_ordinal"
            CHECK (ordinal > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_team_slot'::regclass
                   AND conname = 'ck_record_team_slot_number') THEN
        ALTER TABLE "service_record_team_slot" ADD CONSTRAINT "ck_record_team_slot_number"
            CHECK (slot BETWEEN 0 AND 3);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_baby_assignment'::regclass
                   AND conname = 'ck_record_assignment_version') THEN
        ALTER TABLE "service_record_baby_assignment" ADD CONSTRAINT "ck_record_assignment_version"
            CHECK (version > 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.service_record_baby_assignment'::regclass
                   AND conname = 'ck_record_assignment_window') THEN
        ALTER TABLE "service_record_baby_assignment" ADD CONSTRAINT "ck_record_assignment_window"
            CHECK ((ended_at IS NULL AND active_owner IS TRUE)
            OR (ended_at >= effective_from AND ended_at IS NOT NULL AND active_owner IS NULL));
    END IF;
END $$;

-- Babies and slots retire in place. This preserves ordinals even without a case.
CREATE OR REPLACE FUNCTION public.guard_record_identity_retirement() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.active OR NOT NEW.active)
           AND (to_jsonb(NEW) - 'active') = (to_jsonb(OLD) - 'active') THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION '% identity can only be retired in place', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;

CREATE OR REPLACE FUNCTION public.guard_record_assignment_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY['ended_at', 'active_owner'])
               = (to_jsonb(OLD) - ARRAY['ended_at', 'active_owner']) THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'A record assignment version can only be closed once' USING ERRCODE = '23514';
END $$;

CREATE OR REPLACE FUNCTION public.reject_record_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION '% history is immutable', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.client_baby'::regclass
                   AND tgname = 'guard_client_baby_identity') THEN
        CREATE TRIGGER guard_client_baby_identity BEFORE UPDATE OR DELETE ON "client_baby" FOR EACH ROW
            EXECUTE FUNCTION public.guard_record_identity_retirement();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.service_record_team_slot'::regclass
                   AND tgname = 'guard_record_team_slot_identity') THEN
        CREATE TRIGGER guard_record_team_slot_identity BEFORE UPDATE OR DELETE ON "service_record_team_slot" FOR EACH ROW
            EXECUTE FUNCTION public.guard_record_identity_retirement();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.service_record_baby_assignment'::regclass
                   AND tgname = 'guard_record_assignment_history') THEN
        CREATE TRIGGER guard_record_assignment_history BEFORE UPDATE OR DELETE ON "service_record_baby_assignment" FOR EACH ROW
            EXECUTE FUNCTION public.guard_record_assignment_history();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.service_record_job_member'::regclass
                   AND tgname = 'guard_record_job_membership') THEN
        CREATE TRIGGER guard_record_job_membership BEFORE UPDATE OR DELETE ON "service_record_job_member" FOR EACH ROW
            EXECUTE FUNCTION public.reject_record_history_change();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.service_record_case'::regclass
                   AND tgname = 'guard_record_case_baby') THEN
        CREATE TRIGGER guard_record_case_baby BEFORE UPDATE OF baby_id ON "service_record_case" FOR EACH ROW
            WHEN (OLD.baby_id IS NOT NULL AND OLD.baby_id IS DISTINCT FROM NEW.baby_id)
            EXECUTE FUNCTION public.reject_record_history_change();
    END IF;
END $$;

-- Backend-only tables, using the repository's Supabase API boundary.
ALTER TABLE client_baby ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_record_team_slot ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_record_baby_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_record_job_member ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE client_baby, service_record_team_slot,
    service_record_baby_assignment, service_record_job_member FROM PUBLIC;

DO $$
DECLARE api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format(
                'REVOKE ALL ON TABLE public.client_baby, public.service_record_team_slot, '
                'public.service_record_baby_assignment, public.service_record_job_member FROM %I',
                api_role
            );
        END IF;
    END LOOP;
END $$;

COMMIT;
