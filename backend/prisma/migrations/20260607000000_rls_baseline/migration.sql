-- RLS baseline: row-level-security state introspected from the live dev DB
-- (pg_class.relrowsecurity + pg_policies, 2026-06-07). The 0_init baseline
-- could not capture these objects because `prisma migrate diff` emits only
-- datamodel DDL — Prisma itself warned the RLS setup must be carried
-- manually (see PR #223 review). Fresh databases (CI e2e, future envs) now
-- match the live schema.
--
-- Live truth notes:
--  * voucher_price_info_2025 has RLS DISABLED live — intentionally absent.
--  * The anon public-read policy on bank_account_info is reproduced
--    faithfully but flagged as a likely unintended PII exposure (accNum is
--    anon-readable via Supabase PostgREST). Dropping it is a separate,
--    decision-gated migration pending operator sign-off.
--  * The prod DB is separate; the migrations-cutover drift check re-verifies
--    this state against prod before `migrate resolve`.

-- Plain-Postgres environments (CI e2e service container) lack Supabase's
-- predefined roles; create an inert stand-in so the policies apply cleanly.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
END
$$;

ALTER TABLE "bank_account_info" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voucher_price_info" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on bankAccountInfo" ON "bank_account_info";
CREATE POLICY "Allow public read access on bankAccountInfo"
    ON "bank_account_info"
    FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS "Allow public read access on voucherPriceInfo" ON "voucher_price_info";
CREATE POLICY "Allow public read access on voucherPriceInfo"
    ON "voucher_price_info"
    FOR SELECT
    TO anon
    USING (true);
