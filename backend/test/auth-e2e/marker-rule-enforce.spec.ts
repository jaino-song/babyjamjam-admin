import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { entityChangeEventBus, type EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { persistClientMessageAutomationIntent } from "application/services/message-automation-intent-writer";
import { getClientAutomationIntentDedupeKey, MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import { createExtendedPrismaService } from "infrastructure/database/database.module";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { TenantIsolationViolationError } from "infrastructure/tenant/tenant-isolation.reporter";

/**
 * Live-Postgres proof, under TENANT_ISOLATION_MODE=enforce and the production extension order
 * (tenant isolation, then entity-change), that the shared automation-recovery marker rule can be
 * created lazily from inside a branch request:
 *   - the branchless create is a system write (it cannot satisfy `branch_mutation`), audited, and
 *     still on the caller's interactive transaction;
 *   - it commits or rolls back with the caller's other writes, and its realtime hint is broadcast
 *     (`branchId: null`) only after the commit;
 *   - every other write in the same transaction stays branch-checked.
 *
 * Needs a database (DATABASE_URL) with the schema applied; run with `jest --config jest.auth-e2e.config.ts`.
 */

process.env["TENANT_ISOLATION_MODE"] = "enforce";

const BRANCH = randomUUID();
const SETTLE_MS = 450; // longer than the bus coalescing window (300 ms)

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS));

type Tx = Prisma.TransactionClient;

const sites: Array<{ name: string; run: (tx: Tx, clientId: number) => Promise<unknown> }> = [
    {
        name: "message-automation-intent-writer",
        run: (tx, clientId) => persistClientMessageAutomationIntent(tx, {
            branchId: BRANCH,
            clientId,
            includePast: false,
            suppressGreeting: false,
            intentAt: new Date("2026-10-30T00:00:00.000Z"),
        }),
    },
    {
        name: "agent-automation-record-store (ensureInternalRule)",
        run: (tx) => (new AgentAutomationRecordStoreService({} as never) as unknown as {
            ensureInternalRule(transaction: unknown): Promise<void>;
        }).ensureInternalRule(tx),
    },
];

describe("marker rule under TENANT_ISOLATION_MODE=enforce (live Postgres)", () => {
    let prisma: PrismaService;
    let verify: PrismaClient;
    let clientId: number;
    let otherClientId: number;
    let events: EntityChangedEvent[];
    let auditLogs: string[];
    let logSpy: jest.SpyInstance;
    const unsubscribe: Array<() => void> = [];

    const inBranch = <T>(run: () => Promise<T>) => tenantContextStore.run({ origin: "http", branchId: BRANCH }, run);
    const markerRows = () => verify.message_trigger_rule.findMany({ where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID } });
    const broadcastMessageEvents = () => events.filter((event) => event.branchId === null && event.entities.includes("message"));

    beforeAll(async () => {
        prisma = createExtendedPrismaService();
        verify = new PrismaClient();
        await verify.$connect();
        await verify.branch.create({ data: { id: BRANCH, name: "rt3k marker branch", slug: `rt3k-${BRANCH}` } });
        const client = await verify.client.create({ data: { name: "rt3k marker client", branchId: BRANCH, voucherClient: false } });
        clientId = client.id;
        otherClientId = (await verify.client.create({ data: { name: "rt3k marker client 2", branchId: BRANCH, voucherClient: false } })).id;
        const subscription = entityChangeEventBus.events$.subscribe((event) => events.push(event));
        unsubscribe.push(() => subscription.unsubscribe());
    });

    afterAll(async () => {
        unsubscribe.forEach((fn) => fn());
        await verify.message_trigger_job.deleteMany({ where: { branchId: BRANCH } });
        await verify.message_trigger_rule.deleteMany({ where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID } });
        await verify.client.deleteMany({ where: { branchId: BRANCH } });
        await verify.branch.deleteMany({ where: { id: BRANCH } });
        await verify.$disconnect();
        await (prisma as unknown as PrismaClient).$disconnect();
    });

    beforeEach(async () => {
        await verify.message_trigger_job.deleteMany({ where: { branchId: BRANCH } });
        await verify.message_trigger_rule.deleteMany({ where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID } });
        await verify.client.update({ where: { id: clientId }, data: { name: "rt3k marker client" } });
        await settle();
        events = [];
        auditLogs = [];
        logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation((message: unknown) => {
            if (typeof message === "string" && message.includes("tenant_system_scope_used")) auditLogs.push(message);
        });
    });

    afterEach(() => {
        logSpy.mockRestore();
    });

    it("control: enforce is active - a branchless create outside system scope is rejected", async () => {
        await expect(inBranch(() => prisma.$transaction((tx) => tx.message_trigger_rule.createManyAndReturn({
            data: [{
                id: MESSAGE_AUTOMATION_INTENT_RULE_ID, branchId: null, name: "x", isActive: false, eventType: "client_created",
                offsetType: "immediate", offsetDays: 0, recipientType: "client", templateKey: "client_greeting",
            }],
            skipDuplicates: true,
        })))).rejects.toBeInstanceOf(TenantIsolationViolationError);
        expect(await markerRows()).toHaveLength(0);
    });

    describe("message-automation-intent-writer: marker and intent job together", () => {
        const persist = (tx: Tx, id: number, intentAt: Date) => persistClientMessageAutomationIntent(tx, {
            branchId: BRANCH, clientId: id, includePast: false, suppressGreeting: false, intentAt,
        });
        const dedupeKey = (id: number) => getClientAutomationIntentDedupeKey(BRANCH, id);
        const jobs = (id: number) => verify.message_trigger_job.findMany({ where: { dedupeKey: dedupeKey(id) } });

        it("first creation commits the marker and the job together; the broadcast arrives only after the commit", async () => {
            let broadcastsInsideTransaction = -1;
            await inBranch(() => prisma.$transaction(async (tx) => {
                await persist(tx, clientId, new Date("2026-10-30T00:00:00.000Z"));
                await settle();
                broadcastsInsideTransaction = broadcastMessageEvents().length;
            }));
            await settle();

            const [job, ...rest] = await jobs(clientId);
            expect(rest).toEqual([]);
            expect(job).toEqual(expect.objectContaining({ branchId: BRANCH, ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID, clientId, status: "failed" }));
            expect(await markerRows()).toHaveLength(1);
            expect(broadcastsInsideTransaction).toBe(0);
            expect(broadcastMessageEvents()).toEqual([{ branchId: null, entities: ["message"] }]);
            expect(events).toContainEqual({ branchId: BRANCH, entities: ["message"] });
        });

        it("rollback leaves neither the marker nor the job", async () => {
            await expect(inBranch(() => prisma.$transaction(async (tx) => {
                await persist(tx, clientId, new Date("2026-10-30T00:00:00.000Z"));
                throw new Error("caller failed after the intent write");
            }))).rejects.toThrow("caller failed after the intent write");
            await settle();

            expect(await markerRows()).toHaveLength(0);
            expect(await jobs(clientId)).toEqual([]);
            expect(events).toEqual([]);
        });

        it("a re-run with the same dedupe key updates the same job row (no duplicate) and does not rewrite the marker", async () => {
            await inBranch(() => prisma.$transaction((tx) => persist(tx, clientId, new Date("2026-10-30T00:00:00.000Z"))));
            const [first] = await jobs(clientId);
            const markerBefore = (await markerRows())[0];
            await settle();
            events = [];

            const secondIntentAt = new Date("2026-11-02T03:04:05.000Z");
            await inBranch(() => prisma.$transaction((tx) => persist(tx, clientId, secondIntentAt)));
            await settle();

            const after = await jobs(clientId);
            expect(after).toHaveLength(1);
            expect(after[0]?.id).toBe(first?.id);
            expect(after[0]?.scheduledFor.toISOString()).toBe(secondIntentAt.toISOString());
            expect((await markerRows())[0]?.updatedAt.toISOString()).toBe(markerBefore?.updatedAt.toISOString());
            expect(broadcastMessageEvents()).toEqual([]);
        });
    });

    describe.each(sites)("$name", ({ run }) => {
        it("first creation commits with the caller's other writes and broadcasts one hint only after the commit", async () => {
            let broadcastsInsideTransaction = -1;
            await inBranch(() => prisma.$transaction(async (tx) => {
                await run(tx, clientId);
                await tx.client.update({ where: { id: clientId, branchId: BRANCH }, data: { name: "renamed in the same transaction" } });
                await settle();
                broadcastsInsideTransaction = broadcastMessageEvents().length;
            }));
            await settle();

            const rows = await markerRows();
            expect(rows).toHaveLength(1);
            expect(rows[0]?.branchId).toBeNull();
            expect((await verify.client.findUniqueOrThrow({ where: { id: clientId } })).name).toBe("renamed in the same transaction");
            expect(broadcastsInsideTransaction).toBe(0);
            expect(broadcastMessageEvents()).toEqual([{ branchId: null, entities: ["message"] }]);
            expect(auditLogs.length).toBeGreaterThanOrEqual(1);
        });

        it("existing marker: no write and no broadcast hint", async () => {
            await verify.message_trigger_rule.create({ data: {
                id: MESSAGE_AUTOMATION_INTENT_RULE_ID, branchId: null, name: "pre-existing", isActive: false, eventType: "client_created",
                offsetType: "immediate", offsetDays: 0, recipientType: "client", templateKey: "client_greeting",
            } });
            const before = (await markerRows())[0];
            await settle();
            events = [];

            await inBranch(() => prisma.$transaction((tx) => run(tx, clientId)));
            await settle();

            const after = (await markerRows())[0];
            expect(after?.name).toBe("pre-existing");
            expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
            expect(broadcastMessageEvents()).toEqual([]);
        });

        it("caller rollback: no marker row and no hint at all", async () => {
            await expect(inBranch(() => prisma.$transaction(async (tx) => {
                await run(tx, clientId);
                throw new Error("caller failed after the marker write");
            }))).rejects.toThrow("caller failed after the marker write");
            await settle();

            expect(await markerRows()).toHaveLength(0);
            expect(await verify.message_trigger_job.count({ where: { branchId: BRANCH } })).toBe(0);
            expect(events).toEqual([]);
        });

        it("other writes in the same transaction stay branch-checked: an unpinned write still throws and rolls everything back", async () => {
            await expect(inBranch(() => prisma.$transaction(async (tx) => {
                await run(tx, clientId);
                await tx.client.updateMany({ where: { id: clientId }, data: { name: "unpinned" } });
            }))).rejects.toBeInstanceOf(TenantIsolationViolationError);
            await settle();

            expect(await markerRows()).toHaveLength(0);
            expect((await verify.client.findUniqueOrThrow({ where: { id: clientId } })).name).toBe("rt3k marker client");
            expect(events).toEqual([]);
        });

        it("two concurrent first creators both commit and exactly one broadcast hint is raised", async () => {
            await Promise.all([
                inBranch(() => prisma.$transaction((tx) => run(tx, clientId))),
                inBranch(() => prisma.$transaction((tx) => run(tx, otherClientId))),
            ]);
            await settle();

            expect(await markerRows()).toHaveLength(1);
            expect(broadcastMessageEvents()).toEqual([{ branchId: null, entities: ["message"] }]);
        });
    });
});
