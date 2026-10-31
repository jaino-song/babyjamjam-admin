import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";

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

    it("ON CONFLICT system and marker bootstraps coexist with the live-default partial index", async () => {
        // This suite later recreates the pre-patch index. Remove the deliberately
        // duplicated historical default before that DDL, even on assertion failure.
        const tracker = new RowTracker();
        try {
            const branch = await createBranch(handle.raw, tracker);
            const deleted = await createMessageTriggerRule(handle.raw, tracker, {
                branchId: branch.id, isDefault: true, deletedAt: new Date(),
            });
            await createMessageTriggerRule(handle.raw, tracker, {
                branchId: branch.id, templateKey: deleted.templateKey, isDefault: true,
            });
            const system = await createMessageTriggerRule(handle.raw, tracker, { id: `system:si-conflict:${branch.id}` });
            const repository = new SbMessageTriggerRuleRepository(handle.service);
            const rule = (await repository.findAll(branch.id)).find(({ id }) => id === system.id)!;
            await handle.raw.message_trigger_rule.delete({ where: { id: system.id } });
            const markerExisted = await handle.raw.message_trigger_rule.findUnique({ where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID } });
            if (!markerExisted) tracker.track("message_trigger_rule", MESSAGE_AUTOMATION_INTENT_RULE_ID);
            await handle.raw.$transaction(async (tx) => {
                await repository.ensureSystemRule(rule, tx);
                await repository.ensureSystemRule(rule, tx);
                const store = new AgentAutomationRecordStoreService(new MessageAutomationBranchLockService(handle.service)) as unknown as {
                    ensureInternalRule(transaction: Prisma.TransactionClient): Promise<void>;
                };
                await store.ensureInternalRule(tx);
                await store.ensureInternalRule(tx);
            });
            for (const id of [system.id, MESSAGE_AUTOMATION_INTENT_RULE_ID]) {
                expect(MessageTriggerRuleEntity.isReservedId(id)).toBe(true);
                expect(await handle.raw.message_trigger_rule.findUniqueOrThrow({ where: { id } })).toMatchObject({
                    branchId: null, isDefault: false, deletedAt: null,
                });
            }
        } finally {
            await tracker.cleanup(handle.raw);
        }
    });

    function executeMigration() {
        return spawnSync("pnpm", ["exec", "prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", migration], {
            cwd: resolve(__dirname, "../../.."),
            env: process.env,
            encoding: "utf8",
            timeout: 30_000,
        });
    }

    invariant("SI-SMS-06", "an up-to-date patch rerun performs no table or index work or locks", async () => {
        for (let run = 0; run < 2; run++) {
            const result = executeMigration();
            expect(result.error).toBeUndefined();
            expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: expect.any(String) });
        }
        // Inspect before COMMIT: PostgreSQL retains relation locks until then.
        // Even a redundant violation COUNT would leave an AccessShareLock here.
        const sql = readFileSync(resolve(__dirname, "../../..", migration), "utf8").replace("COMMIT;", `
            SELECT c.relname, l.mode FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
            WHERE l.pid = pg_backend_pid() AND c.relname IN (
                'message_trigger_rule', 'message_trigger_job', 'message_log', 'uniq_message_trigger_rule_default'
            );
            COMMIT;`);
        const url = process.env["DIRECT_URL"];
        if (!url) throw new Error("DIRECT_URL is required by the throwaway guard");
        const result = spawnSync("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
            input: sql, encoding: "utf8", timeout: 30_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe("");
    });

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
