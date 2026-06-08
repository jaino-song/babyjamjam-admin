-- DECISION-GATED — DO NOT RUN WITHOUT EXPLICIT OPERATOR SIGN-OFF.
--
-- Context (2026-06-06, PR #220 remediation Phase 3): the live staging DB
-- carries 4 columns + 2 indexes on "client" that exist in NO branch's
-- schema.prisma — confirmed abandoned by the operator (leftovers of
-- reverted post-sign/contract-state work pushed via `prisma db push`).
--
-- This file intentionally lives OUTSIDE prisma/migrations/ so it can never
-- run via `migrate deploy` automatically. To execute it after sign-off:
-- move it into a timestamped migration (or run manually), AFTER verifying
-- the columns contain no data worth keeping:
--
--   SELECT count(*) FILTER (WHERE contract_state IS NOT NULL)        AS cs,
--          count(*) FILTER (WHERE contract_confirmed_at IS NOT NULL) AS cca,
--          count(*) FILTER (WHERE contract_confirmed_by IS NOT NULL) AS ccb,
--          count(*) FILTER (WHERE expected_end_date IS NOT NULL)     AS eed
--   FROM "client";
--
-- IF EXISTS keeps this replay-safe on databases that never had the drift.

DROP INDEX IF EXISTS "client_branch_id_contract_state_idx";
DROP INDEX IF EXISTS "client_branch_id_expected_end_date_idx";

ALTER TABLE "client"
  DROP COLUMN IF EXISTS "contract_confirmed_at",
  DROP COLUMN IF EXISTS "contract_confirmed_by",
  DROP COLUMN IF EXISTS "contract_state",
  DROP COLUMN IF EXISTS "expected_end_date";
