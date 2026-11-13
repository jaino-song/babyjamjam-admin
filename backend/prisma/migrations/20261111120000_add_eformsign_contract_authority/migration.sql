BEGIN;

/*
  Warnings:

  - A unique constraint covering the columns `[id,branch_id,client_id]` on the table `eformsign_dispatch_intent` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,branch_id,client_id,contract_generation]` on the table `eformsign_document_job` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "eformsign_document_job" ADD COLUMN IF NOT EXISTS "contract_generation" UUID;

-- CreateTable
CREATE TABLE IF NOT EXISTS "eformsign_contract_authority" (
    "branch_id" UUID NOT NULL,
    "client_id" INTEGER NOT NULL,
    "generation" UUID NOT NULL,
    "creation_job_id" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "prior_document_id" TEXT,
    "provider_document_id" TEXT,
    "creation_intent_id" UUID,
    "draft_intent_id" UUID,
    "human_intent_id" UUID,
    "phase" VARCHAR(24) NOT NULL,
    "claim_epoch" BIGINT NOT NULL DEFAULT 0,
    "claim_user_id" UUID,
    "claim_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eformsign_contract_authority_pkey" PRIMARY KEY ("branch_id","client_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "eformsign_contract_authority_generation_key" ON "eformsign_contract_authority"("generation");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "eformsign_contract_authority_creation_job_id_key" ON "eformsign_contract_authority"("creation_job_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "eformsign_contract_authority_provider_document_id_key" ON "eformsign_contract_authority"("provider_document_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eformsign_contract_authority_creation_intent_id_idx" ON "eformsign_contract_authority"("creation_intent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eformsign_contract_authority_draft_intent_id_idx" ON "eformsign_contract_authority"("draft_intent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eformsign_contract_authority_human_intent_id_idx" ON "eformsign_contract_authority"("human_intent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eformsign_contract_authority_claim_user_id_idx" ON "eformsign_contract_authority"("claim_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eformsign_contract_authority_claim_expires_at_idx" ON "eformsign_contract_authority"("claim_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "eformsign_dispatch_intent_scope_key" ON "eformsign_dispatch_intent"("id", "branch_id", "client_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_eformsign_document_job_scope_generation" ON "eformsign_document_job"("branch_id", "client_id", "contract_generation");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "eformsign_document_job_scope_generation_key" ON "eformsign_document_job"("id", "branch_id", "client_id", "contract_generation");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_contract_authority_branch_id_fkey'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "eformsign_contract_authority_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END
$$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_contract_authority_client_id_fkey'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "eformsign_contract_authority_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END
$$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_contract_authority_claim_user_id_fkey'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "eformsign_contract_authority_claim_user_id_fkey" FOREIGN KEY ("claim_user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END
$$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_creation_job_scope_fkey'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_creation_job_scope_fkey" FOREIGN KEY ("creation_job_id", "branch_id", "client_id", "generation") REFERENCES "eformsign_document_job"("id", "branch_id", "client_id", "contract_generation") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END
$$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_creation_intent_scope_fkey'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_creation_intent_scope_fkey" FOREIGN KEY ("creation_intent_id", "branch_id", "client_id") REFERENCES "eformsign_dispatch_intent"("id", "branch_id", "client_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END
$$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_draft_intent_scope_fkey'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_draft_intent_scope_fkey" FOREIGN KEY ("draft_intent_id", "branch_id", "client_id") REFERENCES "eformsign_dispatch_intent"("id", "branch_id", "client_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END
$$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_human_intent_scope_fkey'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_human_intent_scope_fkey" FOREIGN KEY ("human_intent_id", "branch_id", "client_id") REFERENCES "eformsign_dispatch_intent"("id", "branch_id", "client_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END
$$;

-- Approved PostgreSQL invariants not expressible in Prisma's schema language.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_phase_check'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_phase_check" CHECK (phase IN ('reserved', 'creation_pending', 'creation_uncertain', 'document_ready', 'human_exposed', 'verified', 'closed', 'blocked'));
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_fingerprint_check'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_fingerprint_check" CHECK (fingerprint ~ '^[0-9a-f]{64}$');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_claim_epoch_check'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_claim_epoch_check" CHECK (claim_epoch >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_claim_pair_check'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_claim_pair_check" CHECK ((claim_user_id IS NULL) = (claim_expires_at IS NULL));
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_document_ids_check'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_document_ids_check" CHECK (
        (prior_document_id IS NULL OR prior_document_id ~ '[^[:space:]]')
        AND (provider_document_id IS NULL OR provider_document_id ~ '[^[:space:]]')
    );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_ready_document_check'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_ready_document_check" CHECK (
        phase NOT IN ('document_ready', 'human_exposed', 'verified') OR provider_document_id IS NOT NULL
    );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'authority_human_intent_check'
          AND conrelid = 'public.eformsign_contract_authority'::regclass
    ) THEN
        ALTER TABLE "eformsign_contract_authority"
            ADD CONSTRAINT "authority_human_intent_check" CHECK (phase <> 'human_exposed' OR human_intent_id IS NOT NULL);
    END IF;
END
$$;

ALTER TABLE "eformsign_dispatch_intent" DROP CONSTRAINT IF EXISTS "eformsign_dispatch_intent_action_check";
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'eformsign_dispatch_intent_action_check'
          AND conrelid = 'public.eformsign_dispatch_intent'::regclass
    ) THEN
        ALTER TABLE "eformsign_dispatch_intent"
            ADD CONSTRAINT "eformsign_dispatch_intent_action_check"
    CHECK (action IN ('create', 'finalize', 'create_draft', 'manual_process'));
    END IF;
END
$$;

-- Backend-only evidence; preserve migration/backend owner access, add no roles or policies.
ALTER TABLE "eformsign_contract_authority" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "eformsign_contract_authority" FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON TABLE public.eformsign_contract_authority FROM %I', api_role);
        END IF;
    END LOOP;
END $$;

COMMIT;
