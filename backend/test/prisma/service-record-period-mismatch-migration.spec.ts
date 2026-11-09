import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("service-record period mismatch confirmation migration", () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261109120000_add_service_record_day_period_mismatch_kept_at/migration.sql"), "utf8");
    it("adds only a nullable timestamp in an idempotent bounded transaction", () => {
        expect(sql).toContain('ALTER TABLE "service_record_day" ADD COLUMN IF NOT EXISTS "period_mismatch_kept_at" TIMESTAMPTZ(6);');
        expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf("ALTER TABLE"));
        expect(sql.indexOf("SET LOCAL lock_timeout = '5s';")).toBeLessThan(sql.indexOf("ALTER TABLE"));
        expect(sql.lastIndexOf("COMMIT;")).toBeGreaterThan(sql.indexOf("ALTER TABLE"));
        expect(sql).not.toMatch(/NOT NULL|DEFAULT|DROP|UPDATE|DELETE/i);
    });
});
