-- SI-CONTRACT-07: canonicalize legacy status aliases without advancing CAS timestamps.
-- Read-only production preflight (operator only; do not execute as part of this patch):
-- SELECT status_type, count(*) FROM eformsign_doc WHERE status_type !~ '^[0-9]{3}$' GROUP BY 1;
-- Rollback: DROP CONSTRAINT eformsign_doc_status_type_check only if required;
-- retain canonicalized data and the application normalization/fence fixes.

BEGIN;

-- Keep this name mapping in sync with domain/utils/eformsign-status-code.ts.
WITH aliases(name, code) AS (
    VALUES
        ('doc_tempsave', '001'),
        ('doc_create', '002'),
        ('doc_complete', '003'),
        ('doc_request_approval', '010'),
        ('doc_reject_approval', '011'),
        ('doc_accept_approval', '012'),
        ('doc_request_reception', '020'),
        ('doc_reject_reception', '021'),
        ('doc_accept_reception', '022'),
        ('doc_request_outsider', '030'),
        ('doc_reject_outsider', '031'),
        ('doc_accept_outsider', '032'),
        ('doc_request_revoke', '040'),
        ('doc_refuse_revoke', '041'),
        ('doc_revoke', '042'),
        ('doc_update', '043'),
        ('doc_request_reject', '045'),
        ('doc_request_delete', '047'),
        ('doc_delete', '049'),
        ('doc_request_participant', '060'),
        ('doc_reject_participant', '061'),
        ('doc_accept_participant', '062'),
        ('doc_rerequest_participant', '063'),
        ('doc_open_participant', '064'),
        ('doc_request_reviewer', '070'),
        ('doc_reject_reviewer', '071'),
        ('doc_accept_reviewer', '072'),
        ('doc_expired', '080'),
        ('face_signature_complete', '092')
), trimmed AS (
    SELECT id, status_type,
        -- ECMAScript String.trim whitespace, including Unicode separators/BOM.
        lower(btrim(status_type, E' \t\n\r\f\v' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) AS value
    FROM eformsign_doc
), canonical AS (
    SELECT trimmed.id, COALESCE(aliases.code,
        CASE
            WHEN value = '' THEN '000'
            -- Unlike lpad(value, 3, '0'), padStart never truncates longer codes.
            WHEN value ~ '^[0-9]+$' THEN lpad(value, greatest(3, length(value)), '0')
            ELSE trimmed.status_type
        END) AS code
    FROM trimmed LEFT JOIN aliases ON aliases.name = trimmed.value
)
UPDATE eformsign_doc AS doc
SET status_type = canonical.code
FROM canonical
WHERE doc.id = canonical.id AND doc.status_type IS DISTINCT FROM canonical.code;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'eformsign_doc'::regclass
          AND conname = 'eformsign_doc_status_type_check'
    ) THEN
        ALTER TABLE eformsign_doc
            ADD CONSTRAINT eformsign_doc_status_type_check
            CHECK (status_type ~ '^[0-9]{3}$') NOT VALID;
    END IF;
END $$;

DO $$
DECLARE
    invalid_count bigint;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'eformsign_doc'::regclass
          AND conname = 'eformsign_doc_status_type_check'
          AND NOT convalidated
    ) THEN
        SELECT count(*) INTO invalid_count FROM eformsign_doc
        WHERE status_type !~ '^[0-9]{3}$';
        IF invalid_count = 0 THEN
            ALTER TABLE eformsign_doc VALIDATE CONSTRAINT eformsign_doc_status_type_check;
        ELSE
            RAISE NOTICE 'eformsign_doc_status_type_check remains NOT VALID: % invalid rows', invalid_count;
        END IF;
    END IF;
END $$;

COMMIT;
