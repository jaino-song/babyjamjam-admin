-- Fail closed on catalog drift and API access, including inherited/PUBLIC column grants.
DO $$
DECLARE t text; r text; item record;
BEGIN
 FOREACH t IN ARRAY ARRAY['eformsign_backup_run', 'eformsign_backup_run_document'] LOOP
  IF to_regclass('public.' || t) IS NULL THEN RAISE EXCEPTION 'manual backup table missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = ('public.' || t)::regclass AND relrowsecurity) THEN
   RAISE EXCEPTION 'manual backup RLS disabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = ('public.' || t)::regclass AND a.grantee = 0)
    OR EXISTS (SELECT 1 FROM pg_attribute c, LATERAL aclexplode(c.attacl) a
      WHERE c.attrelid = ('public.' || t)::regclass AND a.grantee = 0) THEN
   RAISE EXCEPTION 'manual backup PUBLIC privileges';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND (
    EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = ('public.' || t)::regclass AND has_table_privilege(r, c.oid, a.privilege_type)) OR
    has_any_column_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN
    RAISE EXCEPTION 'manual backup API privileges';
   END IF;
  END LOOP;
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
  ('eformsign_backup_run', 'eformsign_backup_run_pkey', ARRAY['id'], true),
  ('eformsign_backup_run', 'uq_manual_backup_active', ARRAY['active_key'], true),
  ('eformsign_backup_run', 'uq_manual_backup_request', ARRAY['branch_id','request_key'], true),
  ('eformsign_backup_run', 'uq_manual_backup_id_branch', ARRAY['id','branch_id'], true),
  ('eformsign_backup_run', 'idx_manual_backup_company_status_created', ARRAY['company_id','status','created_at'], false),
  ('eformsign_backup_run', 'idx_manual_backup_branch_created_id', ARRAY['branch_id','created_at','id'], false),
  ('eformsign_backup_run_document', 'uq_manual_backup_document_ordinal', ARRAY['run_id','ordinal'], true),
  ('eformsign_backup_run_document', 'manual_backup_document_pkey', ARRAY['run_id','document_id'], true)
 ) AS required(tab, idx, cols, uniq) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class n ON n.oid = i.indexrelid
    WHERE i.indrelid = ('public.' || item.tab)::regclass AND n.relname = item.idx
      AND i.indisvalid AND i.indisready AND i.indisunique = item.uniq AND i.indpred IS NULL AND i.indexprs IS NULL
      AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(att,ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.att) = item.cols) THEN
   RAISE EXCEPTION 'manual backup index missing or drifted: %', item.idx;
  END IF;
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
  ('eformsign_backup_run','manual_backup_branch_fkey','branch',ARRAY['branch_id'],ARRAY['id'],'a'),
  ('eformsign_backup_run','manual_backup_user_fkey','user',ARRAY['requested_by_user_id'],ARRAY['id'],'n'),
  ('eformsign_backup_run_document','manual_backup_document_run_branch_fkey','eformsign_backup_run',ARRAY['run_id','branch_id'],ARRAY['id','branch_id'],'c')
 ) AS required(tab, name, target, cols, target_cols, delete_action) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = ('public.' || item.tab)::regclass
    AND c.conname = item.name AND c.contype = 'f' AND c.convalidated AND NOT c.condeferrable
    AND c.confrelid = ('public.' || item.target)::regclass AND c.confdeltype::text = item.delete_action AND c.confupdtype = 'a'
    AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(att,ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.att) = item.cols
    AND (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(att,ord)
      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.att) = item.target_cols) THEN
   RAISE EXCEPTION 'manual backup FK missing or drifted: %', item.name;
  END IF;
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
  ('eformsign_backup_run','eformsign_backup_run_pkey','PRIMARY KEY (id)'),
  ('eformsign_backup_run_document','manual_backup_document_pkey','PRIMARY KEY (run_id, document_id)')
 ) AS required(tab,name,definition) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = ('public.' || item.tab)::regclass
    AND c.conname = item.name AND c.contype = 'p' AND c.convalidated AND NOT c.condeferrable
    AND pg_get_constraintdef(c.oid) = item.definition) THEN
   RAISE EXCEPTION 'manual backup primary key missing or drifted: %', item.name;
  END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.eformsign_backup_run_document'::regclass
    AND contype = 'f' AND confrelid <> 'public.eformsign_backup_run'::regclass) THEN
  RAISE EXCEPTION 'unexpected manual backup document FK';
 END IF;
 -- Exact PostgreSQL catalog definitions: fail closed even for a named, validated but weakened CHECK.
 FOR item IN SELECT * FROM (VALUES
  ('eformsign_backup_run','chk_manual_backup_status',$definition$CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'partial'::character varying, 'blocked'::character varying, 'failed'::character varying, 'unverified'::character varying])::text[])))$definition$),
  ('eformsign_backup_run','chk_manual_backup_hash',$definition$CHECK (((request_hash ~ '^[0-9a-f]{64}$'::text) AND ((report_hash IS NULL) OR (report_hash ~ '^[0-9a-f]{64}$'::text))))$definition$),
  ('eformsign_backup_run','chk_manual_backup_request',$definition$CHECK (((length(btrim((company_id)::text)) > 0) AND (length(btrim((request_key)::text)) > 0) AND (attempts >= 0)))$definition$),
  ('eformsign_backup_run','chk_manual_backup_lease',$definition$CHECK ((((status)::text <> 'running'::text) OR ((lease_token IS NOT NULL) AND (lease_owner_principal_id IS NOT NULL) AND (length(btrim((lease_owner_principal_id)::text)) > 0) AND (lease_expires_at IS NOT NULL) AND (started_at IS NOT NULL) AND (heartbeat_at IS NOT NULL))))$definition$),
  ('eformsign_backup_run','chk_manual_backup_active',$definition$CHECK (((((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying])::text[])) AND (active_key IS NOT NULL) AND ((active_key)::text = ('manual-backup:'::text || (branch_id)::text)) AND (finished_at IS NULL)) OR (((status)::text = ANY ((ARRAY['partial'::character varying, 'blocked'::character varying, 'failed'::character varying, 'unverified'::character varying])::text[])) AND (active_key IS NULL) AND (finished_at IS NOT NULL))))$definition$),
  ('eformsign_backup_run','chk_manual_backup_json',$definition$CHECK (((jsonb_typeof(scope) = 'object'::text) AND (jsonb_typeof(source_counts) = 'object'::text) AND ((result IS NULL) OR (jsonb_typeof(result) = 'object'::text))))$definition$),
  ('eformsign_backup_run_document','chk_manual_backup_document_ordinal',$definition$CHECK ((ordinal > 0))$definition$),
  ('eformsign_backup_run_document','chk_manual_backup_document_kind',$definition$CHECK (((kind)::text = ANY ((ARRAY['contract'::character varying, 'record'::character varying])::text[])))$definition$),
  ('eformsign_backup_run_document','chk_manual_backup_document_stage',$definition$CHECK (((current_milestone IS NULL) OR (((kind)::text = 'contract'::text) AND ((current_milestone)::text = ANY ((ARRAY['created'::character varying, 'sent'::character varying, 'opened'::character varying, 'signed'::character varying, 'reviewed'::character varying, 'completed'::character varying])::text[]))) OR (((kind)::text = 'record'::text) AND ((current_milestone)::text = ANY ((ARRAY['created'::character varying, 'sent'::character varying, 'reviewed'::character varying, 'completed'::character varying])::text[])))))$definition$),
  ('eformsign_backup_run_document','chk_manual_backup_document_json',$definition$CHECK (((jsonb_typeof(candidate) = 'object'::text) AND ((outcome IS NULL) OR (jsonb_typeof(outcome) = 'object'::text))))$definition$)
 ) AS required(tab,name,definition) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = ('public.' || item.tab)::regclass
      AND c.conname = item.name AND c.contype = 'c' AND c.convalidated AND NOT c.connoinherit
      AND pg_get_constraintdef(c.oid) = item.definition) THEN
   RAISE EXCEPTION 'manual backup CHECK missing or drifted: %', item.name;
  END IF;
 END LOOP;

 FOR item IN SELECT * FROM (VALUES
  ('eformsign_backup_run','id','uuid',true),
  ('eformsign_backup_run','company_id','character varying(256)',true),
  ('eformsign_backup_run','branch_id','uuid',true),
  ('eformsign_backup_run','requested_by_user_id','uuid',false),
  ('eformsign_backup_run','request_key','character varying(128)',true),
  ('eformsign_backup_run','request_hash','character(64)',true),
  ('eformsign_backup_run','scope','jsonb',true),
  ('eformsign_backup_run','source_counts','jsonb',true),
  ('eformsign_backup_run','snapshot_at','timestamp(6) with time zone',true),
  ('eformsign_backup_run','status','character varying(24)',true),
  ('eformsign_backup_run','active_key','character varying(255)',false),
  ('eformsign_backup_run','attempts','integer',true),
  ('eformsign_backup_run','lease_token','uuid',false),
  ('eformsign_backup_run','lease_owner_principal_id','character varying(64)',false),
  ('eformsign_backup_run','lease_expires_at','timestamp(6) with time zone',false),
  ('eformsign_backup_run','heartbeat_at','timestamp(6) with time zone',false),
  ('eformsign_backup_run','started_at','timestamp(6) with time zone',false),
  ('eformsign_backup_run','finished_at','timestamp(6) with time zone',false),
  ('eformsign_backup_run','worker_run_id','character varying(128)',false),
  ('eformsign_backup_run','report_hash','character(64)',false),
  ('eformsign_backup_run','result','jsonb',false),
  ('eformsign_backup_run','failure_code','character varying(80)',false),
  ('eformsign_backup_run','created_at','timestamp(6) with time zone',true),
  ('eformsign_backup_run','updated_at','timestamp(6) with time zone',true),
  ('eformsign_backup_run_document','run_id','uuid',true),
  ('eformsign_backup_run_document','branch_id','uuid',true),
  ('eformsign_backup_run_document','ordinal','integer',true),
  ('eformsign_backup_run_document','document_id','text',true),
  ('eformsign_backup_run_document','kind','character varying(16)',true),
  ('eformsign_backup_run_document','current_milestone','character varying(24)',false),
  ('eformsign_backup_run_document','document_created_at','timestamp(6) with time zone',true),
  ('eformsign_backup_run_document','candidate','jsonb',true),
  ('eformsign_backup_run_document','outcome','jsonb',false)
 ) AS required(tab,col,typ,required) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = ('public.' || item.tab)::regclass
      AND a.attname = item.col AND a.attnum > 0 AND NOT a.attisdropped
      AND format_type(a.atttypid,a.atttypmod) = item.typ AND a.attnotnull = item.required) THEN
   RAISE EXCEPTION 'manual backup column missing or drifted: %', item.col;
  END IF;
 END LOOP;
END $$;
