-- Seed one active CLIENT_GREETING trigger rule for every branch that does not already have one.
-- Idempotent: the NOT EXISTS guard ensures a second run inserts 0 rows.
-- No jobs are created here — greeting jobs only fire on the live CLIENT_CREATED event
-- via syncClientRulesForClient(includePast=true). The IMMEDIATE anti-backfill guard in
-- rebuildJobsForRule prevents retroactive mass-texting.
INSERT INTO alimtalk_trigger_rule (id, branch_id, name, is_active, event_type, offset_type, offset_days, recipient_type, template_key, created_at, updated_at)
SELECT
  gen_random_uuid()::text,
  b.id,
  '신규 고객 인사 메시지',
  true,
  'CLIENT_CREATED',
  'IMMEDIATE',
  0,
  'CLIENT',
  'CLIENT_GREETING',
  now(),
  now()
FROM branch b
WHERE NOT EXISTS (
  SELECT 1
  FROM alimtalk_trigger_rule r
  WHERE r.branch_id = b.id
    AND r.template_key = 'CLIENT_GREETING'
);
