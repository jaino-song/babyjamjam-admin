import { closeIntegrityPrisma, createIntegrityPrisma, assertThrowawayTarget, describeReal, type IntegrityPrisma } from "./helpers/real-db";
import { RowTracker } from "./helpers/tracker";
import {
    createAuthSession,
    createBranch,
    createClient,
    createEmployee,
    createEmployeeSchedule,
    createEformsignDoc,
    createMessageLog,
    createMessageTriggerJob,
    createMessageTriggerRule,
    createUser,
} from "./helpers/factories";

/**
 * Pure unit test (no database): the guard that protects every real-DB integrity
 * spec must refuse a non-throwaway DATABASE_URL and a DATABASE_URL that differs
 * from DIRECT_URL. Env is set and restored inside the test, never at module scope.
 */
describe("state integrity throwaway target guard (unit)", () => {
    it("refuses a non-throwaway DATABASE_URL and a DATABASE_URL ≠ DIRECT_URL pair", () => {
        const databaseUrl = process.env["DATABASE_URL"];
        const directUrl = process.env["DIRECT_URL"];
        try {
            process.env["DATABASE_URL"] = "postgresql://postgres@localhost:5432/postgres";
            process.env["DIRECT_URL"] = process.env["DATABASE_URL"];
            expect(() => assertThrowawayTarget()).toThrow(/throwaway/);

            process.env["DATABASE_URL"] = "postgresql://postgres@localhost:5432/throwaway_guard";
            process.env["DIRECT_URL"] = "postgresql://postgres@localhost:5432/throwaway_other";
            expect(() => assertThrowawayTarget()).toThrow(/same local throwaway database/);

            process.env["DIRECT_URL"] = undefined;
            expect(() => assertThrowawayTarget()).toThrow(/same local throwaway database/);
        } finally {
            process.env["DATABASE_URL"] = databaseUrl;
            process.env["DIRECT_URL"] = directUrl;
        }
    });
});

/**
 * Harness smoke test on a real throwaway PostgreSQL: one row through every
 * factory (following the full FK chain), each row read back through the plain
 * client (and one through the real PrismaService), then cleanup must leave
 * nothing behind. Run via `pnpm run test:integrity`.
 */
describeReal("state integrity harness smoke (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        // Also covers the case where a factory threw midway: tracked rows are
        // removed best-effort before the connections close. No-ops when
        // beforeAll never got a connection.
        if (tracker) {
            await tracker.cleanup(handle.raw);
        }
        if (handle) {
            await closeIntegrityPrisma(handle);
        }
    });

    it("creates one row through every factory, reads them back, and cleanup removes them all", async () => {
        const { raw, service } = handle;

        const branchRow = await createBranch(raw, tracker);
        const userRow = await createUser(raw, tracker, {}, { membership: { branchId: branchRow.id, role: "admin" } });
        const { session, refreshToken } = await createAuthSession(
            raw,
            tracker,
            { userId: userRow.id },
            { selectedBranchId: branchRow.id },
        );
        const clientRow = await createClient(raw, tracker, { branchId: branchRow.id });
        const employeeRow = await createEmployee(raw, tracker, { branchId: branchRow.id });
        const scheduleRow = await createEmployeeSchedule(
            raw,
            tracker,
            { clientId: clientRow.id, primaryEmployeeId: employeeRow.id },
            { branchId: branchRow.id },
        );
        const ruleRow = await createMessageTriggerRule(raw, tracker, { branchId: branchRow.id });
        const jobRow = await createMessageTriggerJob(
            raw,
            tracker,
            { ruleId: ruleRow.id },
            { branchId: branchRow.id, clientId: clientRow.id, employeeScheduleId: scheduleRow.id },
        );
        const logRow = await createMessageLog(
            raw,
            tracker,
            { branchId: branchRow.id, clientId: clientRow.id, triggerJobId: jobRow.id },
        );
        const docRow = await createEformsignDoc(
            raw,
            tracker,
            { branchId: branchRow.id, clientId: clientRow.id, employeeScheduleId: scheduleRow.id },
        );

        // Every row is readable through the plain PrismaClient.
        expect(await raw.branch.findUnique({ where: { id: branchRow.id } })).toMatchObject({ slug: branchRow.slug });
        expect(await raw.user.findUnique({ where: { id: userRow.id } })).toMatchObject({ id: userRow.id });
        expect(await raw.user_branch.findFirst({ where: { userId: userRow.id, branchId: branchRow.id } })).toMatchObject({ role: "admin" });
        expect(await raw.auth_session.findUnique({ where: { id: session.id } })).toMatchObject({ userId: userRow.id });
        expect(await raw.auth_refresh_token.findUnique({ where: { id: refreshToken.id } })).toMatchObject({ sessionId: session.id });
        expect(await raw.client.findUnique({ where: { id: clientRow.id } })).toMatchObject({ branchId: branchRow.id });
        expect(await raw.employee.findUnique({ where: { id: employeeRow.id } })).toMatchObject({ branchId: branchRow.id });
        expect(await raw.employee_schedule.findUnique({ where: { id: scheduleRow.id } })).toMatchObject({ clientId: clientRow.id });
        expect(await raw.message_trigger_rule.findUnique({ where: { id: ruleRow.id } })).toMatchObject({ branchId: branchRow.id });
        expect(await raw.message_trigger_job.findUnique({ where: { id: jobRow.id } })).toMatchObject({ ruleId: ruleRow.id });
        expect(await raw.message_log.findUnique({ where: { id: logRow.id } })).toMatchObject({ triggerJobId: jobRow.id });
        expect(await raw.eformsign_doc.findUnique({ where: { id: docRow.id } })).toMatchObject({ clientId: clientRow.id });

        // The real PrismaService connection is usable the way repositories use it.
        expect(await service.client.findUnique({ where: { id: clientRow.id } })).toMatchObject({ id: clientRow.id });

        const tracked = tracker.size;
        const deleted = await tracker.cleanup(raw);
        expect(deleted).toBe(tracked);
        expect(tracker.size).toBe(0);

        // Every row is gone, FK-safe order left no orphans.
        expect(await raw.branch.findUnique({ where: { id: branchRow.id } })).toBeNull();
        expect(await raw.user.findUnique({ where: { id: userRow.id } })).toBeNull();
        expect(await raw.user_branch.count({ where: { userId: userRow.id } })).toBe(0);
        expect(await raw.auth_session.findUnique({ where: { id: session.id } })).toBeNull();
        expect(await raw.auth_refresh_token.count({ where: { sessionId: session.id } })).toBe(0);
        expect(await raw.client.findUnique({ where: { id: clientRow.id } })).toBeNull();
        expect(await raw.employee.findUnique({ where: { id: employeeRow.id } })).toBeNull();
        expect(await raw.employee_schedule.findUnique({ where: { id: scheduleRow.id } })).toBeNull();
        expect(await raw.message_trigger_rule.findUnique({ where: { id: ruleRow.id } })).toBeNull();
        expect(await raw.message_trigger_job.findUnique({ where: { id: jobRow.id } })).toBeNull();
        expect(await raw.message_log.findUnique({ where: { id: logRow.id } })).toBeNull();
        expect(await raw.eformsign_doc.findUnique({ where: { id: docRow.id } })).toBeNull();
    });
});
