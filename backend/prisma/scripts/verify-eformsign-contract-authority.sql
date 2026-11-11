\set ON_ERROR_STOP on
-- Disposable local DB only. Every fixture and helper rolls back.
BEGIN;
SAVEPOINT authority_verification;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.reject(sql text, expected text, expected_constraint text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_constraint text;
BEGIN
  BEGIN EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_constraint = CONSTRAINT_NAME;
    IF SQLSTATE = expected AND (expected_constraint IS NULL OR actual_constraint = expected_constraint) THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected %, got % for %', expected, SQLSTATE, sql;
  END;
  RAISE EXCEPTION 'Expected rejection % for %', expected, sql;
END $$;
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM eformsign_contract_authority), 'initial authority empty');
SELECT pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid = 'eformsign_contract_authority'::regclass), 'RLS enabled');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE c.oid = 'eformsign_contract_authority'::regclass AND (a.grantee = 0 OR r.rolname IN ('anon','authenticated'))
), 'no public/browser grants');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'eformsign_contract_authority'::regclass), 'no browser policy');
INSERT INTO branch (id, name, slug) VALUES
 ('10000000-0000-0000-0000-000000000001','Authority QA A','authority-qa-a'),
 ('10000000-0000-0000-0000-000000000002','Authority QA B','authority-qa-b');
INSERT INTO client (id, name, voucher_client, branch_id) VALUES
 (-91001,'Authority QA A',false,'10000000-0000-0000-0000-000000000001'),
 (-91002,'Authority QA B',false,'10000000-0000-0000-0000-000000000002');
INSERT INTO "user" (id) VALUES ('40000000-0000-0000-0000-000000000001');
INSERT INTO eformsign_document_job (id,branch_id,client_id,contract_generation,job_type,source,request_key,status,completed_at)
SELECT ('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-0000-0000-' || lpad((CASE WHEN n=3 THEN 2 ELSE 1 END)::text,12,'0'))::uuid,
 CASE WHEN n=4 THEN -91002 ELSE -91001 END,
 ('30000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 'create_document','staff','authority-qa-job-'||n,'completed',now()-interval '8 days' FROM generate_series(1,5) n;
INSERT INTO eformsign_dispatch_intent (id,branch_id,client_id,action,generation,business_key,fingerprint)
SELECT ('50000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 ('10000000-0000-0000-0000-' || lpad((CASE WHEN n=3 THEN 2 ELSE 1 END)::text,12,'0'))::uuid,
 CASE WHEN n=4 THEN -91002 ELSE -91001 END,
 (ARRAY['create','finalize','create_draft','manual_process'])[n], 'qa-generation',lpad(n::text,64,'0'),repeat('a',64)
FROM generate_series(1,4) n;
SELECT pg_temp.reject($q$UPDATE eformsign_dispatch_intent SET action='send' WHERE id='50000000-0000-0000-0000-000000000001'$q$,'23514');
INSERT INTO eformsign_contract_authority (branch_id,client_id,generation,creation_job_id,fingerprint,phase)
VALUES ('10000000-0000-0000-0000-000000000001',-91001,'30000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001',repeat('a',64),'reserved');
DO $$
DECLARE change text; field text;
BEGIN
  FOREACH change IN ARRAY ARRAY[
    'phase=''unknown''','fingerprint=''abc''','fingerprint=repeat(''A'',64)',
    'claim_epoch=-1','provider_document_id=''   ''','prior_document_id='' ''',
    'claim_user_id=''40000000-0000-0000-0000-000000000001''','claim_expires_at=now()',
    'phase=''document_ready''','phase=''human_exposed''','phase=''verified''',
    'phase=''human_exposed'',provider_document_id=''qa-document'''
  ] LOOP
    PERFORM pg_temp.reject('UPDATE eformsign_contract_authority SET '||change,'23514');
  END LOOP;
  FOREACH change IN ARRAY ARRAY[
    'creation_job_id=''20000000-0000-0000-0000-000000000099''',
    'creation_job_id=''20000000-0000-0000-0000-000000000002''',
    'creation_job_id=''20000000-0000-0000-0000-000000000003'',generation=''30000000-0000-0000-0000-000000000003''',
    'creation_job_id=''20000000-0000-0000-0000-000000000004'',generation=''30000000-0000-0000-0000-000000000004''',
    'claim_user_id=''40000000-0000-0000-0000-000000000099'',claim_expires_at=now()'
  ] LOOP
    PERFORM pg_temp.reject('UPDATE eformsign_contract_authority SET '||change,'23503');
  END LOOP;
  FOREACH field IN ARRAY ARRAY['creation_intent_id','draft_intent_id','human_intent_id'] LOOP
    FOREACH change IN ARRAY ARRAY['000000000003','000000000004','000000000099'] LOOP
      PERFORM pg_temp.reject(format('UPDATE eformsign_contract_authority SET %I=%L',field,'50000000-0000-0000-0000-'||change),'23503');
    END LOOP;
    EXECUTE format('UPDATE eformsign_contract_authority SET %I=%L',field,'50000000-0000-0000-0000-000000000001');
  END LOOP;
END $$;
SELECT pg_temp.reject($q$INSERT INTO eformsign_contract_authority (branch_id,client_id,generation,creation_job_id,fingerprint,phase)
VALUES ('10000000-0000-0000-0000-000000000001',-91001,'30000000-0000-0000-0000-000000000001',
 '20000000-0000-0000-0000-000000000001',repeat('a',64),'reserved')$q$,'23505','eformsign_contract_authority_pkey');
INSERT INTO eformsign_contract_authority (branch_id,client_id,generation,creation_job_id,fingerprint,phase)
VALUES ('10000000-0000-0000-0000-000000000001',-91002,'30000000-0000-0000-0000-000000000004',
 '20000000-0000-0000-0000-000000000004',repeat('b',64),'closed');
SELECT pg_temp.reject($q$UPDATE eformsign_contract_authority SET generation='30000000-0000-0000-0000-000000000001' WHERE client_id=-91002$q$,'23505','eformsign_contract_authority_generation_key');
SELECT pg_temp.reject($q$UPDATE eformsign_contract_authority SET creation_job_id='20000000-0000-0000-0000-000000000001' WHERE client_id=-91002$q$,'23505','eformsign_contract_authority_creation_job_id_key');
UPDATE eformsign_contract_authority SET provider_document_id='qa-other-document' WHERE client_id=-91002;
UPDATE eformsign_contract_authority SET provider_document_id='qa-document' WHERE client_id=-91001;
SELECT pg_temp.reject($q$UPDATE eformsign_contract_authority SET provider_document_id='qa-document' WHERE client_id=-91002$q$,'23505','eformsign_contract_authority_provider_document_id_key');
DELETE FROM eformsign_contract_authority WHERE client_id=-91002;
UPDATE eformsign_contract_authority SET provider_document_id='qa-document',phase='document_ready';
UPDATE eformsign_contract_authority SET phase='human_exposed',claim_user_id='40000000-0000-0000-0000-000000000001',claim_expires_at=now()+interval '1 minute';
UPDATE eformsign_contract_authority SET phase='verified';
UPDATE eformsign_contract_authority SET phase='closed',claim_user_id=NULL,claim_expires_at=NULL;
SELECT pg_temp.reject($q$DELETE FROM eformsign_document_job WHERE request_key='authority-qa-job-1'$q$,'23503');
SELECT pg_temp.reject($q$DELETE FROM eformsign_dispatch_intent WHERE id='50000000-0000-0000-0000-000000000001'$q$,'23503');
UPDATE eformsign_contract_authority SET creation_job_id='20000000-0000-0000-0000-000000000002',
 generation='30000000-0000-0000-0000-000000000002',phase='reserved',provider_document_id=NULL;
SELECT pg_temp.assert_true((SELECT contract_generation='30000000-0000-0000-0000-000000000001' FROM eformsign_document_job WHERE request_key='authority-qa-job-1'),'history generation unchanged');
DELETE FROM eformsign_document_job WHERE request_key='authority-qa-job-1';
SELECT pg_temp.reject($q$DELETE FROM eformsign_document_job WHERE request_key='authority-qa-job-2'$q$,'23503');
-- Both NULL document IDs and every permitted phase remain usable.
UPDATE eformsign_contract_authority SET phase='creation_pending';
UPDATE eformsign_contract_authority SET phase='creation_uncertain';
UPDATE eformsign_contract_authority SET phase='blocked';
UPDATE eformsign_contract_authority SET phase='closed';
ROLLBACK TO authority_verification;
ROLLBACK;
\echo authority verification passed; fixtures rolled back
