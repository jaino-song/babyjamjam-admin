-- Replay-safe, private bookkeeping only. No business-document writes or runtime activation.
-- Rollback: revert code/schema/CI registration; retain these private evidence tables.
-- Removing stored evidence requires a separate retention decision, never automatic down-DDL.
CREATE TABLE IF NOT EXISTS public.eformsign_backup_run (
 id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 company_id VARCHAR(256) NOT NULL, branch_id UUID NOT NULL,
 requested_by_user_id UUID, request_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL,
 scope JSONB NOT NULL, source_counts JSONB NOT NULL, snapshot_at TIMESTAMPTZ(6) NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'queued', active_key VARCHAR(255), attempts INTEGER NOT NULL DEFAULT 0,
 lease_token UUID, lease_owner_principal_id VARCHAR(64), lease_expires_at TIMESTAMPTZ(6),
 heartbeat_at TIMESTAMPTZ(6), started_at TIMESTAMPTZ(6), finished_at TIMESTAMPTZ(6),
 worker_run_id VARCHAR(128), report_hash CHAR(64), result JSONB, failure_code VARCHAR(80),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL
);
CREATE TABLE IF NOT EXISTS public.eformsign_backup_run_document (
 run_id UUID NOT NULL, branch_id UUID NOT NULL, ordinal INTEGER NOT NULL, document_id TEXT NOT NULL,
 kind VARCHAR(16) NOT NULL, current_milestone VARCHAR(24), document_created_at TIMESTAMPTZ(6) NOT NULL,
 candidate JSONB NOT NULL, outcome JSONB,
 CONSTRAINT manual_backup_document_pkey PRIMARY KEY (run_id, document_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_backup_active ON public.eformsign_backup_run(active_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_backup_request ON public.eformsign_backup_run(branch_id, request_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_backup_id_branch ON public.eformsign_backup_run(id, branch_id);
CREATE INDEX IF NOT EXISTS idx_manual_backup_company_status_created ON public.eformsign_backup_run(company_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_manual_backup_branch_created_id ON public.eformsign_backup_run(branch_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_backup_document_ordinal ON public.eformsign_backup_run_document(run_id, ordinal);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run'::regclass AND conname = 'manual_backup_branch_fkey') THEN
  ALTER TABLE public.eformsign_backup_run ADD CONSTRAINT manual_backup_branch_fkey FOREIGN KEY (branch_id) REFERENCES public.branch(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run'::regclass AND conname = 'manual_backup_user_fkey') THEN
  ALTER TABLE public.eformsign_backup_run ADD CONSTRAINT manual_backup_user_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public."user"(id) ON DELETE SET NULL ON UPDATE NO ACTION;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run_document'::regclass AND conname = 'manual_backup_document_run_branch_fkey') THEN
  ALTER TABLE public.eformsign_backup_run_document ADD CONSTRAINT manual_backup_document_run_branch_fkey FOREIGN KEY (run_id, branch_id) REFERENCES public.eformsign_backup_run(id, branch_id) ON DELETE CASCADE ON UPDATE NO ACTION;
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run'::regclass AND conname = 'chk_manual_backup_status') THEN
  ALTER TABLE public.eformsign_backup_run ADD CONSTRAINT chk_manual_backup_status CHECK (status IN ('queued','running','partial','blocked','failed','unverified'));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run'::regclass AND conname = 'chk_manual_backup_hash') THEN
  ALTER TABLE public.eformsign_backup_run ADD CONSTRAINT chk_manual_backup_hash CHECK (request_hash ~ '^[0-9a-f]{64}$' AND (report_hash IS NULL OR report_hash ~ '^[0-9a-f]{64}$'));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run'::regclass AND conname = 'chk_manual_backup_request') THEN
  ALTER TABLE public.eformsign_backup_run ADD CONSTRAINT chk_manual_backup_request CHECK (length(btrim(company_id)) > 0 AND length(btrim(request_key)) > 0 AND attempts >= 0);
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run'::regclass AND conname = 'chk_manual_backup_lease') THEN
  ALTER TABLE public.eformsign_backup_run ADD CONSTRAINT chk_manual_backup_lease CHECK (status <> 'running' OR (lease_token IS NOT NULL AND lease_owner_principal_id IS NOT NULL AND length(btrim(lease_owner_principal_id)) > 0 AND lease_expires_at IS NOT NULL AND started_at IS NOT NULL AND heartbeat_at IS NOT NULL));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run'::regclass AND conname = 'chk_manual_backup_active') THEN
  ALTER TABLE public.eformsign_backup_run ADD CONSTRAINT chk_manual_backup_active CHECK ((status IN ('queued','running') AND active_key IS NOT NULL AND active_key = 'manual-backup:' || branch_id::text AND finished_at IS NULL) OR (status IN ('partial','blocked','failed','unverified') AND active_key IS NULL AND finished_at IS NOT NULL));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run'::regclass AND conname = 'chk_manual_backup_json') THEN
  ALTER TABLE public.eformsign_backup_run ADD CONSTRAINT chk_manual_backup_json CHECK (jsonb_typeof(scope) = 'object' AND jsonb_typeof(source_counts) = 'object' AND (result IS NULL OR jsonb_typeof(result) = 'object'));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run_document'::regclass AND conname = 'chk_manual_backup_document_ordinal') THEN
  ALTER TABLE public.eformsign_backup_run_document ADD CONSTRAINT chk_manual_backup_document_ordinal CHECK (ordinal > 0);
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run_document'::regclass AND conname = 'chk_manual_backup_document_kind') THEN
  ALTER TABLE public.eformsign_backup_run_document ADD CONSTRAINT chk_manual_backup_document_kind CHECK (kind IN ('contract','record'));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run_document'::regclass AND conname = 'chk_manual_backup_document_stage') THEN
  ALTER TABLE public.eformsign_backup_run_document ADD CONSTRAINT chk_manual_backup_document_stage CHECK (current_milestone IS NULL OR (kind = 'contract' AND current_milestone IN ('created','sent','opened','signed','reviewed','completed')) OR (kind = 'record' AND current_milestone IN ('created','sent','reviewed','completed')));
 END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run_document'::regclass AND conname = 'chk_manual_backup_document_json') THEN
  ALTER TABLE public.eformsign_backup_run_document ADD CONSTRAINT chk_manual_backup_document_json CHECK (jsonb_typeof(candidate) = 'object' AND (outcome IS NULL OR jsonb_typeof(outcome) = 'object'));
 END IF;
END $$;

ALTER TABLE public.eformsign_backup_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eformsign_backup_run_document ENABLE ROW LEVEL SECURITY;
-- Table REVOKE does not revoke column grants: fence both, including PUBLIC.
DO $$
DECLARE t text; r text; cols text;
BEGIN
 FOREACH t IN ARRAY ARRAY['eformsign_backup_run', 'eformsign_backup_run_document'] LOOP
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
    FROM pg_attribute WHERE attrelid = ('public.' || t)::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
  EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC', cols, t);
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
    EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM %I', cols, t, r);
   END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
   EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END IF;
 END LOOP;
END $$;
