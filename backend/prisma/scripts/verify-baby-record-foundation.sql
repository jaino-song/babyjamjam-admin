-- Read-only reconciliation counts. Operators can use psql --csv -f on a
-- snapshot before and after backfill. Categories with missing scope may overlap.
SELECT metric, row_count
FROM (
    SELECT 'clients_unconfirmed' AS metric, count(*) AS row_count FROM client
    WHERE fetal_confirmation IS DISTINCT FROM 'CONFIRMED'
    UNION ALL SELECT 'clients_null_branch', count(*) FROM client WHERE branch_id IS NULL
    UNION ALL SELECT 'backfilled_babies', count(*) FROM client_baby WHERE legacy_backfilled
    UNION ALL SELECT 'backfilled_team_slots', count(*) FROM service_record_team_slot WHERE legacy_backfilled
    UNION ALL SELECT 'backfilled_owner_assignments', count(*) FROM service_record_baby_assignment WHERE legacy_backfilled
    UNION ALL SELECT 'cases_linked_to_baby', count(*) FROM service_record_case WHERE baby_id IS NOT NULL
    UNION ALL SELECT 'cases_unlinked_to_baby', count(*) FROM service_record_case WHERE baby_id IS NULL
    UNION ALL SELECT 'cases_without_client', count(*) FROM service_record_case WHERE client_id IS NULL
    UNION ALL SELECT 'cases_client_null_branch', count(*) FROM service_record_case rc
        JOIN client c ON c.id = rc.client_id WHERE c.branch_id IS NULL
    UNION ALL SELECT 'cases_client_branch_mismatch', count(*) FROM service_record_case rc
        JOIN client c ON c.id = rc.client_id WHERE c.branch_id <> rc.branch_id
    UNION ALL SELECT 'confirmed_cases_unlinked_to_baby', count(*) FROM service_record_case rc
        JOIN client c ON c.id = rc.client_id AND c.branch_id = rc.branch_id
        WHERE rc.baby_id IS NULL AND c.fetal_confirmation = 'CONFIRMED'
    UNION ALL SELECT 'live_schedules_null_branch', count(*) FROM employee_schedule
        WHERE NOT replaced AND terminated_at IS NULL AND branch_id IS NULL
    UNION ALL SELECT 'live_schedules_without_primary_slot', count(*) FROM employee_schedule s
        WHERE NOT s.replaced AND s.terminated_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM service_record_team_slot t WHERE t.schedule_id = s.id AND t.active
                AND t.slot = 0 AND t.employee_id = s.primary_employee_id)
    UNION ALL SELECT 'live_schedules_without_declared_assistant_slot', count(*) FROM employee_schedule s
        WHERE NOT s.replaced AND s.terminated_at IS NULL AND s.secondary_employee_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM service_record_team_slot t WHERE t.schedule_id = s.id AND t.active
                AND t.slot = 1 AND t.employee_id = s.secondary_employee_id)
    UNION ALL SELECT 'linked_cases_without_open_owner', count(*) FROM service_record_case rc
        WHERE rc.baby_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM service_record_baby_assignment a WHERE a.baby_id = rc.baby_id AND a.ended_at IS NULL)
    UNION ALL SELECT 'legacy_tokens_without_case', count(*) FROM service_record_token WHERE service_record_case_id IS NULL
    UNION ALL SELECT 'legacy_days_without_case', count(*) FROM service_record_day WHERE service_record_case_id IS NULL
    UNION ALL SELECT 'legacy_headers_without_case', count(*) FROM service_record WHERE service_record_case_id IS NULL
    UNION ALL SELECT 'legacy_record_documents_without_case', count(*) FROM eformsign_doc
        WHERE document_kind = 'service_record_snapshot' AND service_record_case_id IS NULL
    UNION ALL SELECT 'record_job_members', count(*) FROM service_record_job_member
) counts ORDER BY metric;
