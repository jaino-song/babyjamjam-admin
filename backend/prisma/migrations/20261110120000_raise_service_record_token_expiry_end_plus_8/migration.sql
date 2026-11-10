BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE service_record_token t
SET expires_at = ((c.end_date + 8)::timestamp AT TIME ZONE 'Asia/Seoul')
FROM service_record_case c
WHERE t.service_record_case_id = c.id AND t.branch_id = c.branch_id
  AND t.active AND t.revoked_at IS NULL
  AND c.end_date IS NOT NULL
  AND c.status NOT IN ('FINALIZING','FINALIZATION_FAILED','DOCUMENTS_CREATED','COMPLETED')
  AND t.expires_at > now()
  AND t.expires_at < ((c.end_date + 8)::timestamp AT TIME ZONE 'Asia/Seoul');

COMMIT;
