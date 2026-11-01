import { randomUUID } from "node:crypto";

import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";

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

/** Restores an env var; an originally-undefined var is removed, not set to the string "undefined". */
function restoreEnv(key: "DATABASE_URL" | "DIRECT_URL", original: string | undefined): void {
    if (original === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = original;
    }
}

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
            restoreEnv("DATABASE_URL", databaseUrl);
            restoreEnv("DIRECT_URL", directUrl);
        }
    });
});

/**
 * Harness tests on a real throwaway PostgreSQL: one row through every factory
 * (following the full FK chain), each row read back through the plain client
 * (and one through the real PrismaService), then cleanup must leave nothing
 * behind — including the FK-set-after-registration cases and the
 * app-created-row sweep. Run via `pnpm run test:integrity`.
 */
describeReal("state integrity harness (real PostgreSQL)", () => {
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
        const { deleted, leaked } = await tracker.cleanup(raw);
        expect(leaked).toEqual([]);
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

    it("deletes safely when a FK is set AFTER registration: branch owner assigned post-hoc", async () => {
        const { raw } = handle;

        const branchRow = await createBranch(raw, tracker);
        const userRow = await createUser(raw, tracker, {}, { membership: { branchId: branchRow.id, role: "admin" } });
        // branch.owner_id → user is NoAction: with registration-order cleanup the
        // user row was deleted first and this FK threw. The fixed model rank
        // (branch before user) must handle the late FK.
        await raw.branch.update({ where: { id: branchRow.id }, data: { ownerId: userRow.id } });

        const tracked = tracker.size;
        const { deleted, leaked } = await tracker.cleanup(raw);
        expect(leaked).toEqual([]);
        expect(deleted).toBe(tracked);
        expect(tracker.size).toBe(0);
        expect(await raw.branch.findUnique({ where: { id: branchRow.id } })).toBeNull();
        expect(await raw.user.findUnique({ where: { id: userRow.id } })).toBeNull();
        expect(await raw.user_branch.count({ where: { branchId: branchRow.id } })).toBe(0);
    });

    it("deletes safely when a FK is set AFTER registration: schedule re-pointed to a later employee", async () => {
        const { raw } = handle;

        const clientRow = await createClient(raw, tracker);
        const firstEmployee = await createEmployee(raw, tracker);
        const scheduleRow = await createEmployeeSchedule(raw, tracker, {
            clientId: clientRow.id,
            primaryEmployeeId: firstEmployee.id,
        });
        const secondEmployee = await createEmployee(raw, tracker);
        // employee_schedule.primary_employee_id → employee is Restrict: with
        // registration-order cleanup the second employee was deleted first (the
        // schedule still pointed at it) and this FK threw. The fixed model rank
        // (employee_schedule before employee) must handle the late FK.
        await raw.employee_schedule.update({ where: { id: scheduleRow.id }, data: { primaryEmployeeId: secondEmployee.id } });

        const tracked = tracker.size;
        const { deleted, leaked } = await tracker.cleanup(raw);
        expect(leaked).toEqual([]);
        expect(deleted).toBe(tracked);
        expect(tracker.size).toBe(0);
        expect(await raw.employee_schedule.findUnique({ where: { id: scheduleRow.id } })).toBeNull();
        expect(await raw.employee.findUnique({ where: { id: firstEmployee.id } })).toBeNull();
        expect(await raw.employee.findUnique({ where: { id: secondEmployee.id } })).toBeNull();
        expect(await raw.client.findUnique({ where: { id: clientRow.id } })).toBeNull();
    });

    it("sweeps app-created child rows in untracked models before deleting tracked parents", async () => {
        const { raw } = handle;

        const branchRow = await createBranch(raw, tracker);
        const userRow = await createUser(raw, tracker);
        const clientRow = await createClient(raw, tracker, { branchId: branchRow.id });

        // Rows a service under test would create in models the factories don't
        // cover, all with Restrict/NoAction FKs to tracked parents — without the
        // sweep they would keep branch/client alive and cleanup would throw.
        const callRecordRow = await raw.call_record.create({
            data: {
                branchId: branchRow.id,
                driveFileId: `si-sweep-${randomUUID()}`,
                fileName: "call.m4a",
                transcript: {},
            },
        });
        const notificationRow = await raw.notification.create({
            data: { userId: userRow.id, title: "무결성 알림", body: "앱이 만든 알림", branchId: branchRow.id },
        });
        const appLogRow = await raw.message_log.create({
            data: {
                provider: "aligo_sms",
                templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
                receiver: "01087654321",
                messageBody: "앱이 만든 메시지 로그",
                status: "pending",
                branchId: branchRow.id,
                clientId: clientRow.id,
            },
        });

        const tracked = tracker.size;
        const { deleted, leaked } = await tracker.cleanup(raw);
        expect(leaked).toEqual([]);
        expect(deleted).toBe(tracked + 3);
        expect(tracker.size).toBe(0);

        expect(await raw.call_record.findUnique({ where: { id: callRecordRow.id } })).toBeNull();
        expect(await raw.notification.findUnique({ where: { id: notificationRow.id } })).toBeNull();
        expect(await raw.message_log.findUnique({ where: { id: appLogRow.id } })).toBeNull();
        expect(await raw.branch.findUnique({ where: { id: branchRow.id } })).toBeNull();
        expect(await raw.user.findUnique({ where: { id: userRow.id } })).toBeNull();
        expect(await raw.client.findUnique({ where: { id: clientRow.id } })).toBeNull();
    });

    it("sweeps the revision document state so a leaked revision pins only its branch and case, not the tracked client", async () => {
        const { raw } = handle;

        const branchRow = await createBranch(raw, tracker);
        const userRow = await createUser(raw, tracker);
        const clientRow = await createClient(raw, tracker, { branchId: branchRow.id });
        // Rows a service under test would create around one confirmed case:
        const caseRow = await raw.service_record_case.create({
            data: { branchId: branchRow.id, clientId: clientRow.id },
        });
        const revisionRow = await raw.service_record_revision.create({
            data: {
                branchId: branchRow.id,
                serviceRecordCaseId: caseRow.id,
                revisionNumber: 1,
                confirmedByUserId: userRow.id,
                payload: {},
                plannedSessions: [],
                provenance: {},
                formVersionAtConfirm: 1,
            },
        });
        // The document state's `client_id` FK is NoAction (migration
        // 20260908030000): without the sweep it keeps the tracked client alive
        // even though the revision has already leaked the branch and the case.
        const documentStateRow = await raw.service_record_revision_document_state.create({
            data: {
                branchId: branchRow.id,
                clientId: clientRow.id,
                serviceRecordCaseId: caseRow.id,
                revisionId: revisionRow.id,
                operation: "contract_period",
                generation: `si-docstate-${randomUUID()}`,
                immutableInput: {},
                inputFingerprint: `${randomUUID()}${randomUUID()}`.replace(/-/g, ""),
            },
        });

        const tracked = tracker.size;
        const { deleted, leaked } = await tracker.cleanup(raw);

        // The client is deleted; only the revision's own parents leak.
        expect(await raw.client.findUnique({ where: { id: clientRow.id } })).toBeNull();
        expect(new Set(leaked.map((row) => `${row.model}:${row.id}`))).toEqual(
            new Set([`service_record_case:${caseRow.id}`, `branch:${branchRow.id}`]),
        );
        // The document state itself was swept (DELETE is not trigger-guarded).
        expect(await raw.service_record_revision_document_state.findUnique({ where: { id: documentStateRow.id } })).toBeNull();
        // Two of the three tracked rows delete (the leaked branch does not),
        // plus the one swept document state.
        expect(deleted).toBe(tracked - 1 + 1);
    });

    it("sweeps edit drafts and day edit logs so an app-created case without a revision deletes with its branch", async () => {
        const { raw } = handle;

        const branchRow = await createBranch(raw, tracker);
        const clientRow = await createClient(raw, tracker, { branchId: branchRow.id });
        const caseRow = await raw.service_record_case.create({
            data: { branchId: branchRow.id, clientId: clientRow.id },
        });
        // `service_record_edit_draft` (case FK NoAction) and
        // `service_record_day_edit_log` (same shape): without the sweep both
        // keep the swept case alive, and the case keeps the branch alive.
        // Actor ids are scalar audit snapshots (no FK), so plain UUIDs suffice.
        const editDraftRow = await raw.service_record_edit_draft.create({
            data: {
                branchId: branchRow.id,
                serviceRecordCaseId: caseRow.id,
                createdByUserId: randomUUID(),
                updatedByUserId: randomUUID(),
                sourceCaseVersion: caseRow.version,
                sourceFingerprint: `si-${randomUUID()}`,
                sourceSnapshot: {},
            },
        });
        const dayEditLogRow = await raw.service_record_day_edit_log.create({
            data: {
                branchId: branchRow.id,
                serviceRecordCaseId: caseRow.id,
                caseSessionIndex: 1,
                serviceRecordDayId: randomUUID(),
                employeeId: 1,
                employeeNameSnapshot: "무결성 요보사",
                before: {},
                after: {},
            },
        });

        const tracked = tracker.size;
        const { deleted, leaked } = await tracker.cleanup(raw);

        expect(leaked).toEqual([]);
        // Both child rows + the app-created case were swept.
        expect(deleted).toBe(tracked + 3);
        expect(await raw.service_record_edit_draft.findUnique({ where: { id: editDraftRow.id } })).toBeNull();
        expect(await raw.service_record_day_edit_log.findUnique({ where: { id: dayEditLogRow.id } })).toBeNull();
        expect(await raw.service_record_case.findUnique({ where: { id: caseRow.id } })).toBeNull();
        expect(await raw.branch.findUnique({ where: { id: branchRow.id } })).toBeNull();
        expect(await raw.client.findUnique({ where: { id: clientRow.id } })).toBeNull();
    });

    it("reports every failing delete in one AggregateError and still deletes later models", async () => {
        const { raw } = handle;

        const branchRow = await createBranch(raw, tracker);
        const userRow = await createUser(raw, tracker);
        const clientRow = await createClient(raw, tracker, { branchId: branchRow.id });
        // No branchId: the surviving employee row must not pin the branch too,
        // so exactly ONE delete fails and every later model still deletes.
        const employeeRow = await createEmployee(raw, tracker);
        // An untracked referencing row the tracker cannot know:
        // employee_schedule.primary_employee_id → employee is Restrict, so the
        // employee delete below must fail. Everything AFTER that failing delete
        // (client, branch, user) must still be deleted, `rows` must be cleared,
        // and cleanup must throw one AggregateError listing the failure.
        const untrackedSchedule = await raw.employee_schedule.create({
            data: {
                clientId: clientRow.id,
                primaryEmployeeId: employeeRow.id,
                workAddress: "서울시 강남구 테헤란로 123",
                startDate: new Date("2026-10-01T00:00:00.000Z"),
                endDate: new Date("2026-10-16T00:00:00.000Z"),
            },
        });

        let cleanupError: unknown;
        try {
            await tracker.cleanup(raw);
        } catch (error) {
            cleanupError = error;
        }
        try {
            expect(cleanupError).toBeInstanceOf(AggregateError);
            const aggregate = cleanupError as AggregateError;
            expect(aggregate.errors.length).toBe(1);
            expect(aggregate.message).toContain("employee");
            // The failing row survived...
            expect(await raw.employee.findUnique({ where: { id: employeeRow.id } })).not.toBeNull();
            // ...but every later model was still deleted, and `rows` was cleared.
            expect(tracker.size).toBe(0);
            expect(await raw.client.findUnique({ where: { id: clientRow.id } })).toBeNull();
            expect(await raw.branch.findUnique({ where: { id: branchRow.id } })).toBeNull();
            expect(await raw.user.findUnique({ where: { id: userRow.id } })).toBeNull();
        } finally {
            // Best-effort teardown of what the failing delete left behind (the
            // untracked schedule was already cascade-deleted with the client).
            await raw.employee_schedule.deleteMany({ where: { id: untrackedSchedule.id } });
            await raw.employee.deleteMany({ where: { id: employeeRow.id } });
        }
    });
});
