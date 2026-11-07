import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Database Patches workflow re-runs every patch SQL on each push, so this
// drop file must stay safe to repeat and must never name the new run table.
describe("drop eformsign backup migration", () => {
    const sql = readFileSync(
        join(process.cwd(), "prisma/migrations/20261108000000_drop_eformsign_backup/migration.sql"),
        "utf8",
    );
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

    const OLD_TABLES = [
        "eformsign_backup_collection_page",
        "eformsign_backup_collection_run",
        "eformsign_backup_export_candidate",
        "eformsign_backup_export_snapshot",
        "eformsign_backup_export_credential",
        "eformsign_backup_run_document",
        "eformsign_backup_run",
    ];

    it("drops exactly the seven old tables, each with IF EXISTS", () => {
        const dropped = [...sql.matchAll(/DROP TABLE IF EXISTS\s+"?([a-z_]+)"?/gi)].map((m) => m[1]);
        expect(dropped.sort()).toEqual([...OLD_TABLES].sort());
    });

    it("contains no statement other than DROP TABLE IF EXISTS", () => {
        const statements = sql
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/--.*$/gm, "")
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean);
        expect(statements).toEqual([
            "BEGIN",
            ...OLD_TABLES.map((table) => `DROP TABLE IF EXISTS "${table}"`),
            "COMMIT",
        ]);
        for (const statement of statements.slice(1, -1)) {
            expect(statement).toMatch(/^DROP TABLE IF EXISTS "[a-z_]+"$/);
        }
    });

    it("never names the new run table, so a re-run cannot delete new history", () => {
        expect(sql).not.toMatch(/eformsign_backup_daily_run/);
    });

    it("leaves no old backup model in the Prisma schema", () => {
        for (const table of OLD_TABLES) {
            expect(schema).not.toMatch(new RegExp(`model ${table}\\s*\\{`));
        }
    });
});
