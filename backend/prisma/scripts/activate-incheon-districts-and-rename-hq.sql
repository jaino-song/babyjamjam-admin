-- One-shot data patch: make the 8 Incheon district branches real, staff-operational
-- branches, and rename the HQ branch "인천점" -> "인천 아이미래로".
--
-- Runs ONLY via manual workflow_dispatch (see database-patches.yml) so it does not
-- re-assert branch state on every unrelated prisma push. Idempotent (plain UPDATEs).
-- The HQ slug ("incheon") is intentionally left unchanged — it is the system's
-- identifier for the headquarters branch (eformsign HQ visibility, inquiry routing).
BEGIN;

UPDATE "branch"
SET "is_active" = true
WHERE "slug" LIKE 'incheon-%';

UPDATE "branch"
SET "name" = '인천 아이미래로'
WHERE "slug" = 'incheon';

COMMIT;
