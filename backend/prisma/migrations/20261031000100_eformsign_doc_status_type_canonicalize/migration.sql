-- SI-CONTRACT-07: canonicalize legacy status aliases without advancing CAS timestamps.
-- Run this read-only preflight SELECT before merging to preview/main
-- (operator only; do not execute as part of this patch):
-- SELECT status_type, count(*) FROM eformsign_doc WHERE status_type !~ '^[0-9]{3}$' GROUP BY 1;
-- Save the preflight query output before running: this backfill is irreversible.
-- Operator decision 2026-10-31: unknown provider status names must remain writable.
-- Rollback: retain canonicalized data and the application normalization/fence fixes;
-- do not restore the CHECK, which would block new provider statuses.

BEGIN;
SET LOCAL lock_timeout = '5s';

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
        -- Exact ECMAScript String.prototype.trim WhiteSpace + LineTerminator set.
        -- PostgreSQL has no \v escape; use hex for U+000B (vertical tab).
        lower(btrim(status_type, E' \t\n\r\f\x0B' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) AS value
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

COMMIT;
