import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { CanceledAutomationRetrySettingsService } from "application/services/canceled-automation-retry-settings.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { CanceledAutomationRetryRepository } from "infrastructure/database/repositories/canceled-automation-retry.repository";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

describeReal("canceled automation retry settings (real PostgreSQL)", () => {
    const branchA = randomUUID();
    const branchB = randomUUID();
    const suffix = randomUUID();
    const local = "QA-canceled-retry-local-info";
    const shared = "QA-canceled-retry-shared-info";
    const retired = "QA-canceled-retry-retired";
    const deleted = "QA-canceled-retry-deleted";
    const manual = "agent-sms:QA-canceled-retry-holder";
    const liveGroup = "QA-canceled-retry-live-group";
    const deletedGroup = "QA-canceled-retry-deleted-group";
    const foreignGroup = "QA-canceled-retry-foreign-group";
    const liveGroupMember = "QA-canceled-retry-live-group-member";
    const deletedMember = "QA-canceled-retry-deleted-member";
    const deletedGroupMember = "QA-canceled-retry-deleted-group-member";
    const foreignGroupMember = "QA-canceled-retry-foreign-group-member";
    const groupIds = [liveGroup, deletedGroup, foreignGroup];
    const memberIds = [liveGroupMember, deletedMember, deletedGroupMember, foreignGroupMember];
    const ids = [local, shared, retired, deleted, manual, ...memberIds];
    let database: PrismaClient;
    let handle: IntegrityPrisma;
    let repository: CanceledAutomationRetryRepository;
    let lock: MessageAutomationBranchLockService;
    let service: CanceledAutomationRetrySettingsService;

    beforeAll(async () => {
        handle = await createIntegrityPrisma();
        database = handle.raw;
        await database.branch.createMany({ data: [
            { id: branchA, name: "QA-Retry A", slug: `qa-retry-a-${suffix}` },
            { id: branchB, name: "QA-Retry B", slug: `qa-retry-b-${suffix}` },
        ] });
        await database.message_trigger_rule_group.createMany({
            data: [
                { id: liveGroup, branchId: branchA, name: "QA-Live retry group" },
                { id: deletedGroup, branchId: branchA, name: "QA-Deleted retry group", deletedAt: new Date() },
                { id: foreignGroup, branchId: branchB, name: "QA-Foreign retry group" },
            ].map((row) => ({ recipientMode: "CLIENT", ...row })),
        });
        await database.message_trigger_rule.createMany({
            data: [
                { id: local, branchId: branchA },
                { id: shared, branchId: null },
                { id: retired, branchId: branchA, templateKey: "CLIENT_WELCOME" },
                { id: deleted, branchId: branchA, deletedAt: new Date() },
                { id: manual, branchId: branchA },
                { id: liveGroupMember, branchId: branchA, groupId: liveGroup },
                { id: deletedMember, branchId: branchA, groupId: liveGroup, recipientType: "PRIMARY_EMPLOYEE", deletedAt: new Date() },
                { id: deletedGroupMember, branchId: branchA, groupId: deletedGroup },
                { id: foreignGroupMember, branchId: branchB, groupId: foreignGroup },
            ].map((row) => ({
                name: row.id, eventType: "SERVICE_END", offsetType: "SAME_DAY", recipientType: "CLIENT", templateKey: "SERVICE_END_NOTICE",
                jobsStale: true, retryOnFailure: false, ...row,
            })),
        });
        repository = new CanceledAutomationRetryRepository(handle.service);
        lock = new MessageAutomationBranchLockService(handle.service);
        service = new CanceledAutomationRetrySettingsService(
            repository, lock, new MessageAutomationActivationService(handle.service, lock, new AdminAuditEventWriter(handle.service)),
        );
    });

    afterAll(async () => {
        if (!database) return;
        try {
            await database.message_trigger_rule.deleteMany({ where: { id: { in: ids } } });
            await database.message_trigger_rule_group.deleteMany({ where: { id: { in: groupIds } } });
            await database.branch.deleteMany({ where: { id: { in: [branchA, branchB] } } });
        } finally {
            await closeIntegrityPrisma(handle);
        }
    });

    function ruleGeneration(id: string) {
        return database.$queryRaw`
            SELECT updated_at::text, is_active, jobs_stale, retry_on_failure FROM message_trigger_rule WHERE id = ${id}
        `;
    }

    // The raw client probes from a separate connection while the repository transaction is open.
    function tryLockRuleRow(id: string) {
        return database.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM message_trigger_rule WHERE id = ${id} FOR UPDATE NOWAIT
        `;
    }

    it("persists OFF/ON/OFF/ON across reads without advancing the local rule generation", async () => {
        const generation = await ruleGeneration(local);
        const approval = await database.branch.findUniqueOrThrow({ where: { id: branchA } });
        expect((await service.list(branchA)).find(({ id }) => id === local)).toMatchObject({ enabled: false, enabledAt: null });
        const first = await service.update(branchA, local, true);
        expect(first.enabledAt).not.toBeNull();
        expect(await service.update(branchA, local, true)).toEqual(first);
        expect((await service.list(branchA)).find(({ id }) => id === local)).toEqual(first);
        expect(await service.update(branchA, local, false)).toMatchObject({ enabled: false, enabledAt: null });

        // The saved high-water mark must win even if the server clock moves backwards.
        const last = new Date("2050-01-01T01:02:03.123Z");
        await database.$executeRaw`UPDATE message_trigger_rule
            SET canceled_retry_last_enabled_at = ${last}
            WHERE id = ${local} AND branch_id = ${branchA}::uuid`;
        const second = await service.update(branchA, local, true);
        expect(second.enabledAt).toBe("2050-01-01T01:02:03.124Z");
        expect(Date.parse(second.enabledAt!)).toBeGreaterThan(Date.parse(first.enabledAt!));
        expect(await ruleGeneration(local)).toEqual(generation);
        expect(await database.branch.findUniqueOrThrow({ where: { id: branchA } })).toEqual(approval);
    });

    it("keeps per-branch epochs and inherited activation independent for a common rule", async () => {
        const generation = await ruleGeneration(shared);
        const branchARetry = await service.update(branchA, shared, true);
        expect((await service.list(branchB)).find(({ id }) => id === shared)).toMatchObject({ enabled: false, enabledAt: null });
        const branchBRetry = await service.update(branchB, shared, true);
        expect(branchBRetry.enabledAt).not.toBeNull();
        await service.update(branchB, shared, false);
        expect((await service.list(branchA)).find(({ id }) => id === shared)).toEqual(branchARetry);

        const row = await database.message_trigger_rule.findUniqueOrThrow({ where: { id: shared } });
        expect(row.canceledRetryEnabledAt).toBeNull();
        expect(row.canceledRetryLastEnabledAt).toBeNull();
        expect(await ruleGeneration(shared)).toEqual(generation);
        await database.message_trigger_rule.update({ where: { id: shared }, data: { isActive: false } });
        expect((await service.list(branchA)).find(({ id }) => id === shared)).toMatchObject({ eligible: false, unavailableReason: "routine_disabled" });
        await expect(service.update(branchA, shared, false)).rejects.toMatchObject({ status: 409 });
        await database.message_trigger_rule.update({ where: { id: shared }, data: { isActive: true } });
        expect((await service.list(branchA)).find(({ id }) => id === shared)).toEqual(branchARetry);
        expect(await service.update(branchA, shared, false)).toMatchObject({ eligible: true, enabled: false, enabledAt: null });
    });

    it("keeps an existing false override through ON and OFF storage writes, and rejects it at the API service boundary", async () => {
        const key = { branchId: branchA, ruleId: shared };
        await database.message_trigger_rule_branch_override.upsert({
            where: { branchId_ruleId: key }, create: { ...key, isActive: false }, update: { isActive: false },
        });
        const before = await database.message_trigger_rule_branch_override.findUniqueOrThrow({ where: { branchId_ruleId: key } });
        await expect(service.update(branchA, shared, true)).rejects.toMatchObject({ status: 409 });

        await lock.runExclusive(branchA, async (transaction) => {
            const rule = (await repository.lockRule(branchA, shared, transaction))!;
            const enabledAt = await repository.updateEpoch(transaction, branchA, rule, true);
            expect(enabledAt).not.toBeNull();
            expect(await repository.updateEpoch(transaction, branchA, rule, false)).toBeNull();
            const after = await transaction.message_trigger_rule_branch_override.findUniqueOrThrow({ where: { branchId_ruleId: key } });
            expect(after).toEqual({ ...before, canceledRetryEnabledAt: null, canceledRetryLastEnabledAt: enabledAt });
        });
    });

    it("scopes the catalog and rejects writes to foreign, deleted, retired, and manual rows", async () => {
        const catalog = await service.list(branchB);
        expect(catalog.filter(({ id }) => ids.includes(id)).map(({ id }) => id)).toEqual(["QA-canceled-retry-shared-info"]);
        for (const [branch, id] of [[branchB, local], [branchA, deleted], [branchA, retired], [branchA, manual]] as const) {
            await expect(service.update(branch, id, true)).rejects.toMatchObject({ status: 404 });
        }
    });

    it("lists each branch's live group by its group ID and excludes deleted groups with live members", async () => {
        const fixtureIds = [...groupIds.map((id) => `group:${id}`), ...memberIds];
        const [catalogA, catalogB] = await Promise.all([service.list(branchA), service.list(branchB)]);
        expect(catalogA.filter(({ id }) => fixtureIds.includes(id))).toMatchObject([
            { id: `group:${liveGroup}`, label: "QA-Live retry group", eligible: true, enabled: false, enabledAt: null },
        ]);
        expect(catalogB.filter(({ id }) => fixtureIds.includes(id))).toMatchObject([
            { id: `group:${foreignGroup}`, label: "QA-Foreign retry group", eligible: true, enabled: false, enabledAt: null },
        ]);
    });

    it("rejects a grouped member ID without taking its row lock through lockRule", async () => {
        await expect(service.update(branchA, liveGroupMember, true)).rejects.toMatchObject({ status: 404 });
        await lock.runExclusive(branchA, async (transaction) => {
            expect(await repository.lockRule(branchA, liveGroupMember, transaction)).toBeNull();
            await expect(tryLockRuleRow(liveGroupMember)).resolves.toEqual([{ id: liveGroupMember }]);
        });
    });

    it("locks live members of the requested group in the requested branch", async () => {
        await lock.runExclusive(branchA, async (transaction) => {
            const rules = await repository.lockGroupRules(branchA, liveGroup, transaction);
            expect(rules.map(({ id }) => id)).toEqual([liveGroupMember]);
            expect(await repository.lockGroupRules(branchA, foreignGroup, transaction)).toEqual([]);

            await expect(tryLockRuleRow(liveGroupMember)).rejects.toMatchObject({ code: "P2010", meta: { code: "55P03" } });
            for (const id of [deletedMember, deletedGroupMember, foreignGroupMember, local]) {
                await expect(tryLockRuleRow(id)).resolves.toEqual([{ id }]);
            }
        });
    });

    it("writes and reads retry settings through an owned live group ID", async () => {
        await expect(service.update(branchB, `group:${liveGroup}`, true)).rejects.toMatchObject({ status: 404 });
        await expect(service.update(branchA, `group:${deletedGroup}`, true)).rejects.toMatchObject({ status: 404 });

        const id = `group:${liveGroup}`;
        const enabled = await service.update(branchA, id, true);
        expect(enabled).toMatchObject({ id, enabled: true, enabledAt: expect.any(String) });
        expect((await service.list(branchA)).find((routine) => routine.id === id)).toEqual(enabled);
        expect(await service.update(branchA, id, false)).toMatchObject({ id, enabled: false, enabledAt: null });
    });

    // Count actual same-database advisory waiters before releasing the lock so
    // both requests overlap and the queue order is deliberate.
    async function waitForWaiters(count: number) {
        const deadline = Date.now() + 4_000;
        while (Date.now() < deadline) {
            const [row] = await database.$queryRaw<Array<{ count: number }>>`
                SELECT count(*)::int FROM pg_locks
                WHERE locktype = 'advisory' AND NOT granted
                  AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            `;
            if (row?.count === count) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Expected ${count} PostgreSQL advisory waiters`);
    }

    async function writeConcurrently(id: string, first: boolean, second: boolean) {
        const held = deferred();
        const release = deferred();
        const blocker = lock.runExclusive(branchA, async () => {
            held.resolve();
            await release.promise;
        });
        await held.promise;
        const requests: Array<ReturnType<CanceledAutomationRetrySettingsService["update"]>> = [];
        try {
            const firstRequest = service.update(branchA, id, first);
            requests.push(firstRequest);
            void firstRequest.catch(() => undefined);
            await waitForWaiters(1);
            const secondRequest = service.update(branchA, id, second);
            requests.push(secondRequest);
            void secondRequest.catch(() => undefined);
            await waitForWaiters(2);
        } finally {
            release.resolve();
            await blocker;
        }
        return Promise.all(requests);
    }

    it.each([local, shared])("returns one exact epoch for two concurrent ON requests to %s", async (id) => {
        if (id === shared) {
            await database.message_trigger_rule_branch_override.deleteMany({ where: { branchId: branchA, ruleId: shared } });
        }
        await service.update(branchA, id, false);
        const [first, second] = await writeConcurrently(id, true, true);
        expect(first?.enabled).toBe(true);
        expect(first?.enabledAt).not.toBeNull();
        expect(second).toEqual(first);
    });

    it.each([[true, false], [false, true]] as const)("honors commit order for concurrent %s then %s", async (first, second) => {
        await service.update(branchA, local, !first);
        const [firstResult, finalResult] = await writeConcurrently(local, first, second);
        expect(firstResult?.enabled).toBe(first);
        expect(finalResult?.enabled).toBe(second);
        expect((await service.list(branchA)).find(({ id }) => id === local)).toEqual(finalResult);
    });
});
