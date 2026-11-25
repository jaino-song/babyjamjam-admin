-- Operator only, before per-baby writes are enabled. Run audit before and after:
-- psql -X -v ON_ERROR_STOP=1 --single-transaction -f backfill-baby-record-foundation.sql
-- Phase 1 DDL alone is safe for old writers. Before backfilling data, deploy
-- the delete-compatible version to all writers, including mirrored-document purge.
-- Keep old and new application writers paused for the reconciliation window.
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, public, pg_temp;
LOCK TABLE client, employee, employee_schedule, service_record_case,
    service_record_assignment, service_record_token, service_record_day, service_record,
    eformsign_doc, message_trigger_job, client_baby, service_record_team_slot,
    service_record_baby_assignment, service_record_job_member IN SHARE ROW EXCLUSIVE MODE;

-- Only the documented A voucher shapes prove a singleton. Require clean
-- legacy fields and no prior baby identity, including retired rows.
WITH inserted AS (
    INSERT INTO client_baby (id, branch_id, client_id, ordinal, legacy_backfilled)
    SELECT md5('baby-record-foundation:singleton:' || c.branch_id || ':' || c.id)::uuid,
        c.branch_id, c.id, 1, true
    FROM client c
    WHERE c.branch_id IS NOT NULL AND c.deleted_at IS NULL AND c.voucher_client
      AND btrim(c.type) ~ '^A(가|통합|라)-?[1-3①②③](형)?$'
      AND c.fetal_type IS NULL AND c.fetal_confirmation IS NULL
      AND NOT EXISTS (SELECT 1 FROM client_baby b WHERE b.branch_id = c.branch_id AND b.client_id = c.id)
    RETURNING client_id
)
UPDATE client c SET fetal_type = 'SINGLETON', fetal_confirmation = 'CONFIRMED'
FROM inserted i WHERE c.id = i.client_id;

-- Seed only explicit staff positions of live schedules. The primary must be
-- valid. Missing, duplicate or foreign secondary staff remain unresolved.
INSERT INTO service_record_team_slot (id, branch_id, client_id, schedule_id, employee_id, slot, legacy_backfilled)
SELECT md5('baby-record-foundation:slot:' || s.incarnation_id || ':' || staff.slot || ':' || e.id)::uuid,
    s.branch_id, s.client_id, s.id, e.id, staff.slot, true
FROM employee_schedule s
JOIN client c ON c.id = s.client_id AND c.branch_id = s.branch_id AND c.deleted_at IS NULL
JOIN employee p ON p.id = s.primary_employee_id AND p.branch_id = s.branch_id AND p.deleted_at IS NULL
CROSS JOIN LATERAL (VALUES (0, s.primary_employee_id), (1, s.secondary_employee_id)) staff (slot, employee_id)
JOIN employee e ON e.id = staff.employee_id AND e.branch_id = s.branch_id AND e.deleted_at IS NULL
WHERE NOT s.replaced AND s.terminated_at IS NULL
  AND (staff.slot = 0 OR staff.employee_id <> s.primary_employee_id)
  AND NOT EXISTS (
      SELECT 1 FROM service_record_team_slot t
      WHERE t.branch_id = s.branch_id AND t.client_id = s.client_id AND t.schedule_id = s.id
  );

-- Keep the original case UUID and every token, day, header and document pointer.
-- Conflicting linked history blocks even a proven singleton's case association.
UPDATE service_record_case rc SET baby_id = b.id
FROM client_baby b
JOIN client c ON c.id = b.client_id AND c.branch_id = b.branch_id
WHERE b.legacy_backfilled AND b.active AND c.deleted_at IS NULL
  AND c.fetal_type = 'SINGLETON' AND c.fetal_confirmation = 'CONFIRMED'
  AND rc.client_id = b.client_id AND rc.branch_id = b.branch_id AND rc.baby_id IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM (
          SELECT a.branch_id, a.schedule_id, NULL::integer AS client_id
          FROM service_record_assignment a WHERE a.service_record_case_id = rc.id
          UNION ALL
          SELECT d.branch_id, d.schedule_id, NULL
          FROM service_record_day d WHERE d.service_record_case_id = rc.id
          UNION ALL
          SELECT t.branch_id, t.schedule_id, NULL
          FROM service_record_token t WHERE t.service_record_case_id = rc.id
          UNION ALL
          SELECT h.branch_id, h.schedule_id, NULL
          FROM service_record h WHERE h.service_record_case_id = rc.id
          UNION ALL
          SELECT d.branch_id, d.employee_schedule_id, d.client_id
          FROM eformsign_doc d WHERE d.service_record_case_id = rc.id
      ) linked
      LEFT JOIN employee_schedule s ON s.id = linked.schedule_id
      WHERE linked.branch_id IS DISTINCT FROM rc.branch_id
         OR (linked.client_id IS NOT NULL AND linked.client_id <> rc.client_id)
         OR (linked.schedule_id IS NOT NULL AND
             (s.branch_id IS DISTINCT FROM rc.branch_id OR s.client_id IS DISTINCT FROM rc.client_id))
  );

-- Adopt a current primary assignment only when the existing singleton case
-- assignment agrees with the explicit schedule slot. Preserve the old assignment.
INSERT INTO service_record_baby_assignment
    (id, branch_id, client_id, baby_id, schedule_id, team_slot_id, employee_id, legacy_backfilled)
SELECT md5('baby-record-foundation:assignment:' || b.id || ':' || t.id)::uuid,
    b.branch_id, b.client_id, b.id, t.schedule_id, t.id, t.employee_id, true
FROM service_record_case rc
JOIN client_baby b ON b.id = rc.baby_id AND b.active AND b.legacy_backfilled
JOIN service_record_assignment a ON a.service_record_case_id = rc.id AND a.branch_id = b.branch_id
JOIN service_record_team_slot t ON t.branch_id = b.branch_id AND t.client_id = b.client_id
    AND t.schedule_id = a.schedule_id AND t.employee_id = a.employee_id AND t.slot = 0
    AND t.active AND t.legacy_backfilled
JOIN employee_schedule s ON s.id = t.schedule_id AND s.primary_employee_id = t.employee_id
JOIN client c ON c.id = b.client_id AND c.deleted_at IS NULL
JOIN employee e ON e.id = t.employee_id AND e.deleted_at IS NULL
WHERE NOT s.replaced AND s.terminated_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM service_record_baby_assignment n WHERE n.schedule_id = t.schedule_id AND n.baby_id = b.id
  );
