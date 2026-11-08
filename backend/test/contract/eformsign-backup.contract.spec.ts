import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ExecutionContext, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EformsignBackupTokenGuard } from "infrastructure/auth/eformsign-backup-token.guard";

// Main-authored contract test (BJJ-570 Phase 3). Contract §1 Auth and §3 table.
// Do not edit; if it is wrong, stop and report.

function contextWith(authorization?: string): ExecutionContext {
    const request = { headers: authorization === undefined ? {} : { authorization } };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
}

function guardWith(env: Record<string, string | undefined>): EformsignBackupTokenGuard {
    const config = { get: (key: string) => env[key] } as unknown as ConfigService;
    return new EformsignBackupTokenGuard(config);
}

async function outcome(guard: EformsignBackupTokenGuard, authorization?: string): Promise<string> {
    try {
        return (await guard.canActivate(contextWith(authorization))) ? "allow" : "deny";
    } catch (error) {
        if (error instanceof NotFoundException) return "404";
        if (error instanceof UnauthorizedException) return "401";
        throw error;
    }
}

describe("eformsign backup token guard (contract §1)", () => {
    const TOKEN = "t0ken-abcdefghijklmnop";

    it("answers 404 when the token env is unset or blank", async () => {
        expect(await outcome(guardWith({}), `Bearer ${TOKEN}`)).toBe("404");
        expect(await outcome(guardWith({ EFORMSIGN_BACKUP_TOKEN: "   " }), `Bearer ${TOKEN}`)).toBe("404");
    });

    it("answers 401 for a missing, malformed or wrong token", async () => {
        const guard = guardWith({ EFORMSIGN_BACKUP_TOKEN: TOKEN });
        expect(await outcome(guard)).toBe("401");
        expect(await outcome(guard, `Basic ${TOKEN}`)).toBe("401");
        expect(await outcome(guard, "Bearer ")).toBe("401");
        expect(await outcome(guard, `Bearer ${TOKEN.slice(0, -1)}X`)).toBe("401");
        expect(await outcome(guard, `Bearer ${TOKEN}extra`)).toBe("401");
    });

    it("allows the exact token, trimming the env value", async () => {
        expect(await outcome(guardWith({ EFORMSIGN_BACKUP_TOKEN: ` ${TOKEN}\n` }), `Bearer ${TOKEN}`)).toBe("allow");
    });

    it("reads the env on every request", async () => {
        const env: Record<string, string | undefined> = {};
        const guard = guardWith(env);
        expect(await outcome(guard, `Bearer ${TOKEN}`)).toBe("404");
        env["EFORMSIGN_BACKUP_TOKEN"] = TOKEN;
        expect(await outcome(guard, `Bearer ${TOKEN}`)).toBe("allow");
    });
});

describe("eformsign backup daily run migration (contract §3)", () => {
    const sql = readFileSync(
        join(process.cwd(), "prisma/migrations/20261108010000_add_eformsign_backup_daily_run/migration.sql"),
        "utf8",
    ).replace(/\s+/g, " ");

    it("creates only the daily run table, safe to re-run", () => {
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "?eformsign_backup_daily_run"?/i);
        expect(sql).not.toMatch(/\bDROP\b/i);
        expect(sql).not.toMatch(/CREATE TYPE/i);
        expect(sql).not.toMatch(/branch_id/i);
    });

    it("has every contract column and both CHECK value sets", () => {
        for (const column of [
            "started_at", "finished_at", "status", "limited", "total_docs", "saved_files",
            "skipped_files", "failed_files", "drive_status", "failures", "created_at",
        ]) {
            expect(sql).toContain(column);
        }
        expect(sql).toMatch(/'success'\s*,\s*'partial'\s*,\s*'failed'/);
        expect(sql).toMatch(/'ok'\s*,\s*'failed'\s*,\s*'skipped'/);
    });
});
