import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { createBranch, createMessageLog, createMessageTriggerJob, createMessageTriggerRule } from "../helpers/factories";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

const migration = "prisma/migrations/20261031000000_message_trigger_rule_soft_delete_and_status_checks/migration.sql";
const constraints = ["message_trigger_job_status_check", "message_log_status_check", "message_log_carrier_result_state_check"];

describeReal("SMS patch fail-closed validation (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    function executeMigration() {
        return spawnSync("pnpm", ["exec", "prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", migration], {
            cwd: resolve(__dirname, "../../.."),
            env: process.env,
            encoding: "utf8",
            timeout: 30_000,
        });
    }

    for (const [table, column, constraint] of [
        ["message_trigger_job", "status", constraints[0]],
        ["message_log", "status", constraints[1]],
        ["message_log", "carrier_result_state", constraints[2]],
    ] as const) {
        invariant("SI-SMS-06", `the patch rolls back all DDL on legacy ${table}.${column} violations and succeeds after cleanup`, async () => {
            const branch = await createBranch(handle.raw, tracker);
            const rule = await createMessageTriggerRule(handle.raw, tracker, { branchId: branch.id });
            const row = table === "message_trigger_job"
                ? await createMessageTriggerJob(handle.raw, tracker, { ruleId: rule.id }, { branchId: branch.id })
                : await createMessageLog(handle.raw, tracker, { branchId: branch.id });

            // Reproduce a pre-patch database only on the guarded throwaway target.
            for (const name of constraints) {
                const target = name.startsWith("message_trigger_job") ? "message_trigger_job" : "message_log";
                await handle.raw.$executeRaw(Prisma.sql`ALTER TABLE ${Prisma.raw(target)} DROP CONSTRAINT IF EXISTS ${Prisma.raw(name)}`);
            }
            await handle.raw.$executeRaw`ALTER TABLE message_trigger_rule DROP COLUMN deleted_at`;
            await handle.raw.$executeRaw`CREATE UNIQUE INDEX uniq_message_trigger_rule_default ON message_trigger_rule (branch_id, template_key) WHERE is_default = true`;
            const before = await handle.raw.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE indexname = 'uniq_message_trigger_rule_default'`;
            try {
                await handle.raw.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(table)} SET ${Prisma.raw(column)} = 'bogus' WHERE id = ${row.id}`);
                const failed = executeMigration();
                expect(failed.error).toBeUndefined();
                expect(failed.status).not.toBe(0);
                expect(failed.stderr).toContain(constraint);
                expect(failed.stderr).toMatch(/1 legacy row\(s\).*bogus/s);
                expect(await handle.raw.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'message_trigger_rule' AND column_name = 'deleted_at'`).toEqual([]);
                expect(await handle.raw.$queryRaw(Prisma.sql`SELECT conname FROM pg_constraint WHERE conname IN (${Prisma.join(constraints)})`)).toEqual([]);
                expect(await handle.raw.$queryRaw`SELECT indexdef FROM pg_indexes WHERE indexname = 'uniq_message_trigger_rule_default'`).toEqual(before);
            } finally {
                await handle.raw.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw(table)} WHERE id = ${row.id}`);
                const restored = executeMigration();
                expect(restored.error).toBeUndefined();
                expect({ status: restored.status, stderr: restored.stderr }).toEqual({ status: 0, stderr: expect.any(String) });
            }
            const checks = await handle.raw.$queryRaw<Array<{ conname: string; convalidated: boolean }>>(Prisma.sql`SELECT conname, convalidated FROM pg_constraint WHERE conname IN (${Prisma.join(constraints)})`);
            expect(checks).toHaveLength(3);
            expect(checks.every(({ convalidated }) => convalidated)).toBe(true);
            expect(await handle.raw.message_trigger_rule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({ deletedAt: null });
        });
    }
});
