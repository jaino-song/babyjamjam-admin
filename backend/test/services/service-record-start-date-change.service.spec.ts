import type { StartDateChangeMode } from "@babyjamjam/shared/types/start-date-change";
import type { ServiceRecordPlannedSession } from "@babyjamjam/shared/utils/service-record-schedule";
import { ServiceRecordStartDateChangeService } from "application/services/service-record-start-date-change.service";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import {
    persistClientMessageAutomationIntent,
    persistScheduleMessageAutomationIntent,
} from "application/services/message-automation-intent-writer";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";

jest.mock("application/services/message-automation-intent-writer", () => ({
    persistClientMessageAutomationIntent: jest.fn().mockResolvedValue(undefined),
    persistScheduleMessageAutomationIntent: jest.fn().mockResolvedValue(undefined),
}));

const branchId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const clientId = 1;
const date = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const oldDates = ["2026-12-14", "2026-12-16", "2026-12-18"]; // The old pauses must disappear.
const newDates = ["2026-12-21", "2026-12-22", "2026-12-23"];
const oldVector = (): ServiceRecordPlannedSession[] => oldDates.map((serviceDate, index) => ({
    sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
    assignmentId: index === 0 ? "a1" : "a2", scheduleId: index === 0 ? 11 : 12,
    employeeId: index === 0 ? 7 : 8, provenanceVersion: index === 0 ? "original-v1" : "handover-v2",
}));

function world(options: { count?: number; total?: number | null; planned?: ServiceRecordPlannedSession[] | null; saturday?: boolean } = {}) {
    const record = {
        id: caseId, branchId, clientId, startDate: date(oldDates[0]!), endDate: date(oldDates[2]!),
        requiredSessionCount: options.total === undefined ? 3 : options.total,
        plannedSessions: options.planned === undefined ? oldVector() : options.planned,
        version: 5, currentRevisionId: null as string | null,
    };
    const client = {
        id: clientId, branchId, startDate: date(newDates[0]!), endDate: date("2026-12-31"),
        allowSaturdayService: options.saturday ?? false, allowSundayService: false, allowHolidayService: false,
    };
    const schedules = [
        { id: 12, branchId, clientId, replaced: false, terminatedAt: null as Date | null, startDate: date(oldDates[1]!), endDate: date(oldDates[2]!) },
        { id: 11, branchId, clientId, replaced: true, terminatedAt: null as Date | null, startDate: date(oldDates[0]!), endDate: date(oldDates[0]!) },
        { id: 10, branchId, clientId, replaced: true, terminatedAt: date("2026-12-11"), startDate: date("2026-12-10"), endDate: date("2026-12-11") },
    ];
    const assignments = schedules.map((schedule) => ({
        id: `a${schedule.id - 10}`, scheduleId: schedule.id, branchId, serviceRecordCaseId: caseId,
        startDate: schedule.startDate, endDate: schedule.endDate,
    }));
    const days = Array.from({ length: options.count ?? 3 }, (_, index) => ({
        id: `day-${index + 1}`, branchId, serviceRecordCaseId: caseId, clientId,
        caseSessionIndex: index + 1 as number | null, sessionIndex: index + 1,
        scheduleId: (index === 0 ? 11 : 12) as number | null, employeeId: index === 0 ? 7 : 8,
        employeeNameSnapshot: index === 0 ? "First caregiver" : "Second caregiver", formVersion: 3,
        serviceDate: date(oldDates[index] ?? "2026-12-24"),
        answers: { nested: { fed: true }, amount: index + 1 }, etcService: "care", notes: "note",
        paymentConfirmed: true, momApproval: "approved", clientSignature: `signature-${index}`,
        periodMismatchKeptAt: null as Date | null,
        clientSignedAt: date("2026-12-18"), locked: index < 2, submittedAt: index < 2 ? date("2026-12-18") : null,
        createdAt: date("2026-12-14"), updatedAt: date("2026-12-18"),
    }));
    const archive: unknown[] = [];
    const tx = {
        client: {
            findFirst: jest.fn().mockResolvedValue(client),
            updateMany: jest.fn(async ({ data }: { data: Partial<typeof client> }) => { Object.assign(client, data); return { count: 1 }; }),
        },
        service_record_case: {
            findFirst: jest.fn().mockResolvedValue(record),
            update: jest.fn(async ({ data }: { data: Partial<Omit<typeof record, "version">> & { version?: { increment: number } } }) => {
                const { version, ...values } = data;
                Object.assign(record, values);
                record.version += version?.increment ?? 0;
                return record;
            }),
        },
        service_record_day: {
            findMany: jest.fn().mockResolvedValue(days),
            deleteMany: jest.fn(async () => { days.splice(0); return { count: 3 }; }),
            updateMany: jest.fn(async ({ where, data }: {
                where: Partial<Pick<(typeof days)[number], "id" | "branchId" | "serviceRecordCaseId" | "locked">>;
                data: { serviceDate: Date };
            }) => {
                const matching = days.filter((day) => Object.entries(where)
                    .every(([key, value]) => day[key as keyof typeof where] === value));
                matching.forEach((day) => Object.assign(day, data));
                return { count: matching.length };
            }),
        },
        service_record_day_archive: {
            createMany: jest.fn(async ({ data }: { data: unknown[] }) => { archive.push(...data); return { count: data.length }; }),
        },
        employee_schedule: {
            findMany: jest.fn().mockResolvedValue(schedules),
            updateMany: jest.fn(async ({ where, data }: { where: { id: number }; data: { startDate: Date; endDate: Date } }) => {
                Object.assign(schedules.find((row) => row.id === where.id)!, data);
                return { count: 1 };
            }),
        },
        service_record_assignment: {
            findMany: jest.fn().mockResolvedValue(assignments),
            updateMany: jest.fn(async ({ where, data }: { where: { id: string }; data: { startDate: Date; endDate: Date } }) => {
                Object.assign(assignments.find((row) => row.id === where.id)!, data);
                return { count: 1 };
            }),
        },
        service_record_token: { updateMany: jest.fn() },
        message_trigger_rule: { upsert: jest.fn() },
        message_trigger_job: { upsert: jest.fn() },
    };
    const fence = { appendScheduleWriteFence: jest.fn() };
    const service = new ServiceRecordStartDateChangeService(fence as never);
    const apply = (mode: StartDateChangeMode, start = newDates[0]!, actorUserId?: string) => service.applyInTransaction(tx as never, {
        branchId, clientId, decision: { mode, previousStartDate: date(oldDates[0]!), recordedSessionCount: days.length },
        newStartDate: date(start), actorUserId, calendar: KR_BUILTIN_CALENDAR,
    });
    return { tx, service, apply, record, client, schedules, assignments, days, archive, fence };
}

describe("ServiceRecordStartDateChangeService", () => {
    beforeEach(() => jest.clearAllMocks());

    it("MOVE clears confirmation for changed dates and keeps it for unchanged dates", async () => {
        const w = world();
        const keptAt = date("2026-12-10");
        w.days.forEach((day) => { day.periodMismatchKeptAt = keptAt; });
        // The first row already lies on its destination; the other rows move.
        w.days[0]!.serviceDate = date(newDates[0]!);
        await w.apply("MOVE");
        expect(w.days[0]!.periodMismatchKeptAt).toBe(keptAt);
        expect(w.days[1]!.periodMismatchKeptAt).toBeNull();
        expect(w.days[2]!.periodMismatchKeptAt).toBeNull();
        expect(w.tx.service_record_day.updateMany.mock.calls[0]![0].data).not.toHaveProperty("periodMismatchKeptAt");
    });

    it("RESTART archives every full row in one batch before deleting, then resets dates and keeps N", async () => {
        const w = world();
        const original = structuredClone(w.days);
        await expect(w.apply("RESTART", newDates[0], "acting-user")).resolves.toEqual({ restoreRequiredSessionCount: 3 });
        expect(w.archive).toHaveLength(3);
        const archived = w.tx.service_record_day_archive.createMany.mock.calls[0]![0].data as Array<Record<string, unknown>>;
        expect(new Set(archived.map((row) => row["batchId"])).size).toBe(1);
        archived.forEach((row, index) => expect(row).toEqual(expect.objectContaining({
            branchId, serviceRecordCaseId: caseId, clientId, reason: "RESTART", originalDayId: original[index]!.id,
            caseSessionIndex: index + 1, serviceDate: original[index]!.serviceDate,
            previousStartDate: date(oldDates[0]!), newStartDate: date(newDates[0]!), archivedByUserId: "acting-user",
            payload: JSON.parse(JSON.stringify(original[index])),
        })));
        expect(w.tx.service_record_day_archive.createMany.mock.invocationCallOrder[0])
            .toBeLessThan(w.tx.service_record_day.deleteMany.mock.invocationCallOrder[0]!);
        expect(w.days).toHaveLength(0);
        expect(w.record).toMatchObject({ startDate: date(newDates[0]!), endDate: date(newDates[2]!), requiredSessionCount: 3, version: 6 });
        expect(w.client.endDate).toEqual(w.record.endDate);
        expect(w.record.plannedSessions).toEqual(newDates.map((serviceDate, index) => ({
            ...oldVector()[1], sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
        })));
        expect(w.assignments.find((row) => row.id === "a1")).toMatchObject({ startDate: date(oldDates[0]!), endDate: date(oldDates[0]!) });
        expect(w.schedules[0]).toMatchObject({ startDate: date(newDates[0]!), endDate: date(newDates[2]!) });
        expect(w.tx.employee_schedule.updateMany).toHaveBeenCalledTimes(1);
    });

    it("MOVE keeps locked answers/signatures and caregiver provenance, re-lays pauses and records each owner's period", async () => {
        const w = world();
        const original = structuredClone(w.days);
        await w.apply("MOVE");
        expect(w.days.filter((day) => day.locked)).toEqual([
            { ...original[0], serviceDate: date(newDates[0]!) },
            { ...original[1], serviceDate: date(newDates[1]!) },
        ]);
        expect(w.days).toEqual(original.map((day, index) => ({ ...day, serviceDate: date(newDates[index]!) })));
        expect(w.record.plannedSessions).toEqual(oldVector().map((entry, index) => ({
            ...entry, serviceDate: newDates[index], originalDate: newDates[index],
        })));
        expect(w.archive).toHaveLength(3);
        expect(w.archive).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "MOVE", archivedByUserId: null })]));
        expect(w.tx.service_record_day.deleteMany).not.toHaveBeenCalled();
        expect(w.tx.service_record_day_archive.createMany.mock.invocationCallOrder[0])
            .toBeLessThan(w.tx.service_record_day.updateMany.mock.invocationCallOrder[0]!);
        expect(w.assignments.find((row) => row.id === "a1")).toMatchObject({ startDate: date(newDates[0]!), endDate: date(newDates[0]!) });
        expect(w.assignments.find((row) => row.id === "a2")).toMatchObject({ startDate: date(newDates[1]!), endDate: date(newDates[2]!) });
        expect(w.schedules.find((row) => row.id === 11)).toMatchObject({ startDate: date(newDates[0]!), endDate: date(newDates[0]!) });
        expect(w.schedules.find((row) => row.id === 12)).toMatchObject({ startDate: date(newDates[1]!), endDate: date(newDates[2]!) });
        expect(w.tx.employee_schedule.findMany).toHaveBeenCalledTimes(1); // no overlap query / refusal
        expect(w.fence.appendScheduleWriteFence).toHaveBeenCalledTimes(2);
        expect(w.fence.appendScheduleWriteFence).toHaveBeenCalledWith(w.tx, expect.objectContaining({ branchId, clientId, scheduleIds: [11] }));
        expect(persistClientMessageAutomationIntent).toHaveBeenCalledWith(w.tx, expect.objectContaining({ branchId, clientId }));
        expect(persistScheduleMessageAutomationIntent).toHaveBeenCalledTimes(2);
        expect(w.record.requiredSessionCount).toBe(3);
        expect(w.client.endDate).toEqual(date(newDates[2]!));
    });

    it.each(["CONFIRM_STARTED", "RESTART", "MOVE"] as const)("%s succeeds without rows and re-lays a stored vector", async (mode) => {
        const w = world({ count: 0 });
        await w.apply(mode);
        expect(w.record.plannedSessions?.map((entry) => entry.serviceDate)).toEqual(newDates);
        expect(w.record.requiredSessionCount).toBe(3);
        expect(w.record.endDate).toEqual(date(newDates[2]!));
        expect(w.tx.service_record_day_archive.createMany).not.toHaveBeenCalled();
        expect(w.tx.service_record_day.updateMany).not.toHaveBeenCalled();
    });

    it.each([false, true])("uses the newly written Saturday flag (%s), including a non-service start", async (saturday) => {
        const w = world({ count: 0, saturday });
        await w.apply("CONFIRM_STARTED", "2026-12-19");
        expect(w.record.plannedSessions?.map((entry) => entry.serviceDate)).toEqual(saturday
            ? ["2026-12-19", "2026-12-21", "2026-12-22"] : newDates);
    });

    it("CONFIRM_STARTED leaves rows unchanged if called directly", async () => {
        const w = world();
        const original = structuredClone(w.days);
        await w.apply("CONFIRM_STARTED");
        expect(w.days).toEqual(original);
        expect(w.tx.service_record_day.updateMany).not.toHaveBeenCalled();
        expect(w.tx.service_record_day.deleteMany).not.toHaveBeenCalled();
    });

    it("MOVE with no vector uses row schedule ownership and the legacy sessionIndex fallback; out-of-range rows stay", async () => {
        const w = world({ planned: null, count: 4 });
        w.days[0]!.caseSessionIndex = null;
        const extra = structuredClone(w.days[3]);
        await w.apply("MOVE");
        expect(w.days[0]!.serviceDate).toEqual(date(newDates[0]!));
        expect(w.days[3]).toEqual(extra);
        expect(w.archive).toHaveLength(4);
        expect(w.record.plannedSessions).toBeNull();
        expect(w.assignments.find((row) => row.id === "a2")).toMatchObject({ startDate: date(newDates[1]!), endDate: date(newDates[2]!) });
    });

    it.each([
        { scenario: "one active caregiver", owners: [12, 12], activeStart: "2026-12-21", historicalEnd: null },
        { scenario: "a caregiver handover", owners: [11, 12], activeStart: "2026-12-22", historicalEnd: "2026-12-21" },
        { scenario: "only historical written rows", owners: [11, 11], activeStart: "2026-12-23", historicalEnd: "2026-12-22" },
    ])("legacy MOVE includes unwritten sessions through N with $scenario", async ({ owners, activeStart, historicalEnd }) => {
        const w = world({ planned: null, total: 4, count: 2 });
        w.days.forEach((day, index) => { day.scheduleId = owners[index]!; });
        w.days[1]!.caseSessionIndex = null; // Legacy rows still use sessionIndex.
        const original = structuredClone(w.days);
        const endDate = date("2026-12-24");

        await expect(w.apply("MOVE")).resolves.toEqual({ restoreRequiredSessionCount: 4 });

        expect(w.days).toEqual(original.map((day, index) => ({ ...day, serviceDate: date(newDates[index]!) })));
        expect(w.archive).toHaveLength(2);
        expect(w.record).toMatchObject({ requiredSessionCount: 4, plannedSessions: null, endDate });
        expect(w.client.endDate).toEqual(endDate);
        expect(w.schedules.find((row) => row.id === 12)).toMatchObject({ startDate: date(activeStart), endDate });
        expect(w.assignments.find((row) => row.id === "a2")).toMatchObject({ startDate: date(activeStart), endDate });
        if (historicalEnd) {
            const period = { startDate: date(newDates[0]!), endDate: date(historicalEnd) };
            expect(w.schedules.find((row) => row.id === 11)).toMatchObject(period);
            expect(w.assignments.find((row) => row.id === "a1")).toMatchObject(period);
        } else {
            expect(w.tx.employee_schedule.updateMany).toHaveBeenCalledTimes(1);
            expect(w.tx.service_record_assignment.updateMany).toHaveBeenCalledTimes(1);
        }
        expect(w.schedules.find((row) => row.id === 10)).toMatchObject({
            startDate: date("2026-12-10"), endDate: date("2026-12-11"),
        });
        expect(w.fence.appendScheduleWriteFence).toHaveBeenCalledWith(w.tx, expect.objectContaining({
            branchId, clientId, scheduleIds: [12],
        }));
        expect(persistScheduleMessageAutomationIntent).toHaveBeenCalledWith(w.tx, expect.objectContaining({
            branchId, scheduleId: 12,
        }));
    });

    it("legacy MOVE assigns unwritten gaps to the active caregiver without taking written sessions", async () => {
        const w = world({ planned: null, total: 4, count: 2 });
        w.days[1]!.caseSessionIndex = 3;

        await w.apply("MOVE");

        expect(w.days.map((day) => day.serviceDate)).toEqual([date("2026-12-21"), date("2026-12-23")]);
        expect(w.schedules.find((row) => row.id === 12)).toMatchObject({
            startDate: date("2026-12-22"), endDate: date("2026-12-24"),
        });
        expect(w.assignments.find((row) => row.id === "a2")).toMatchObject({
            startDate: date("2026-12-22"), endDate: date("2026-12-24"),
        });
        expect(w.assignments.find((row) => row.id === "a1")).toMatchObject({
            startDate: date("2026-12-21"), endDate: date("2026-12-21"),
        });
    });

    it.each(["MOVE", "CONFIRM_STARTED", "RESTART"] as const)("%s falls back to the active schedule when no owner evidence exists", async (mode) => {
        const w = world({ planned: null, count: 0 });
        await w.apply(mode);
        expect(w.schedules[0]).toMatchObject({ startDate: date(newDates[0]!), endDate: date(newDates[2]!) });
        expect(w.tx.employee_schedule.updateMany).toHaveBeenCalledTimes(1);
        expect(w.tx.service_record_assignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "a2", branchId, serviceRecordCaseId: caseId },
        }));
        expect(w.record.plannedSessions).toBeNull();
    });

    it("RESTART copies the highest-index provenance if the active assignment owns no stored entry", async () => {
        const planned = oldVector().map((entry) => ({ ...entry, assignmentId: "a1", scheduleId: 11, employeeId: 7 }));
        planned[2]!.provenanceVersion = "last-provenance";
        const w = world({ planned });
        await w.apply("RESTART");
        expect(w.record.plannedSessions?.every((entry) => entry.provenanceVersion === "last-provenance" && entry.assignmentId === "a1")).toBe(true);
        expect(w.schedules[0]).toMatchObject({ startDate: date(newDates[0]!), endDate: date(newDates[2]!) });
    });

    it("MOVE succeeds for terminated/replaced owners even when an old boundary is crossed; unowned periods stay", async () => {
        const w = world();
        w.schedules[0]!.terminatedAt = date("2026-12-18");
        const unowned = structuredClone(w.schedules[2]);
        await w.apply("MOVE", "2026-12-07");
        expect(w.schedules[0]).toMatchObject({ startDate: date("2026-12-08"), endDate: date("2026-12-09") });
        expect(w.schedules[1]).toMatchObject({ startDate: date("2026-12-07"), endDate: date("2026-12-07") });
        expect(w.schedules[2]).toEqual(unowned);
        expect(w.tx.service_record_token.updateMany).toHaveBeenCalledWith({
            where: { branchId, serviceRecordCaseId: caseId, active: true, revokedAt: null },
            data: { expiresAt: new Date("2026-12-16T15:00:00.000Z") },
        });
    });

    it("fails the transaction before row mutation if archive insert fails", async () => {
        const w = world();
        const failure = new Error("archive unavailable");
        w.tx.service_record_day_archive.createMany.mockRejectedValueOnce(failure);
        await expect(w.apply("RESTART")).rejects.toBe(failure);
        expect(w.tx.service_record_day.deleteMany).not.toHaveBeenCalled();
        expect(w.tx.service_record_day.updateMany).not.toHaveBeenCalled();
        expect(w.tx.service_record_case.update).not.toHaveBeenCalled();
    });

    it.each(["RESTART", "MOVE"] as const)("refuses %s with rows and no stored N", async (mode) => {
        const w = world({ total: null, planned: null });
        await expect(w.apply(mode)).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_DURATION_REQUIRED" } });
        expect(w.tx.service_record_day.deleteMany).not.toHaveBeenCalled();
        expect(w.tx.service_record_day.updateMany).not.toHaveBeenCalled();
    });

    it("allows confirmation with no rows, no vector and no stored N without inventing a count", async () => {
        const w = world({ total: null, planned: null, count: 0 });
        await expect(w.apply("CONFIRM_STARTED")).resolves.toEqual({ restoreRequiredSessionCount: null });
        expect(w.record).toMatchObject({ startDate: date(newDates[0]!), requiredSessionCount: null, plannedSessions: null });
    });

    it("refuses a non-null malformed vector instead of inventing provenance", async () => {
        const w = world({ planned: [{ sessionIndex: 1 } as ServiceRecordPlannedSession] });
        await expect(w.apply("MOVE")).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_PLANNED_DATE_UNAVAILABLE" } });
        expect(w.tx.service_record_case.update).not.toHaveBeenCalled();
    });

    it.each(["MOVE", "RESTART"] as const)("%s with currentRevisionId succeeds; finalization blocks an incomplete source and creates no stale revision document", async (mode) => {
        const w = world();
        const original = structuredClone(w.days);
        w.record.currentRevisionId = "existing-admin-revision";
        await w.apply(mode);
        if (mode === "RESTART") {
            expect(w.archive).toEqual(original.map((day) => expect.objectContaining({
                reason: "RESTART", originalDayId: day.id, payload: JSON.parse(JSON.stringify(day)),
            })));
            expect(w.tx.service_record_day_archive.createMany.mock.invocationCallOrder[0])
                .toBeLessThan(w.tx.service_record_day.deleteMany.mock.invocationCallOrder[0]!);
            expect(w.days).toHaveLength(0);
        }
        expect(w.record.currentRevisionId).toBe("existing-admin-revision");
        const source = {
            ...w.record, status: "READY_TO_FINALIZE", branchName: "Branch", days: w.days, assignments: w.assignments,
            client: w.client, finalizationAttempts: 0, nextAttemptAt: null,
            momName: "Mom", momBirth: "900101", babyName: "Baby", babyBirth: "261201", deliveryType: "natural", babyWeight: "3.2",
        };
        const tx = { service_record_case: {
            findUnique: jest.fn(async (args: { select?: { branch?: unknown } }) => args.select?.branch ? { ...source, branch: { name: "Branch" } } : source),
            updateMany: jest.fn(),
        } };
        const prisma = { $transaction: jest.fn(async (cb: (db: typeof tx) => Promise<unknown>) => cb(tx)) };
        const lifecycle = { recompute: jest.fn() };
        const createSnapshot = { executeCase: jest.fn() };
        const jobs = { findByRequestKeyInTransaction: jest.fn(), enqueueInTransaction: jest.fn() };
        const finalization = new ServiceRecordFinalizationService(prisma as never, lifecycle as unknown as ServiceRecordLifecycleService,
            createSnapshot as never, createHolidayCalendarStub(), jobs as never);
        const claim = finalization as unknown as { claimFinalizationCase: (id: string, branch: string, now: Date) => Promise<unknown> };
        await expect(claim.claimFinalizationCase(caseId, branchId, date("2027-01-04")))
            .resolves.toMatchObject({ claimed: false, blockedGeneration: true });
        expect(lifecycle.recompute).toHaveBeenCalled();
        expect(jobs.findByRequestKeyInTransaction).not.toHaveBeenCalled();
        expect(jobs.enqueueInTransaction).not.toHaveBeenCalled();
        expect(createSnapshot.executeCase).not.toHaveBeenCalled();
    });

    it("also blocks direct document generation after MOVE when every revised session is signed", async () => {
        const w = world();
        w.record.currentRevisionId = "existing-admin-revision";
        for (const day of w.days) {
            day.locked = true;
            day.submittedAt = date("2026-12-18");
        }
        await w.apply("MOVE");
        const source = {
            ...w.record, status: "READY_TO_FINALIZE", branchName: "Branch", formVersion: 3,
            days: w.days, assignments: w.assignments.map((assignment) => ({
                ...assignment, employeeId: assignment.scheduleId === 11 ? 7 : 8, employeeNameSnapshot: "Caregiver",
            })), client: w.client, finalizationAttempts: 0, nextAttemptAt: null,
            momName: "Mom", momBirth: "900101", babyName: "Baby", babyBirth: "261201", deliveryType: "natural", babyWeight: "3.2",
        };
        const tx = {
            service_record_case: {
                findUnique: jest.fn(async (args: { select?: { branch?: unknown } }) => args.select?.branch ? { ...source, branch: { name: "Branch" } } : source),
                updateMany: jest.fn(),
            },
            service_record_revision: { findUnique: jest.fn().mockResolvedValue({
                id: w.record.currentRevisionId, revisionNumber: 1, payload: { plannedSessions: oldVector() },
            }) },
        };
        const prisma = { $transaction: jest.fn(async (cb: (db: typeof tx) => Promise<unknown>) => cb(tx)) };
        const snapshot = { executeCase: jest.fn() };
        const jobs = {
            findByRequestKeyInTransaction: jest.fn().mockResolvedValue(null),
            enqueueInTransaction: jest.fn().mockResolvedValue({ existing: false }),
        };
        const editRepository = {
            createRevisionDocumentStateInTransaction: jest.fn().mockResolvedValue({ id: "state-1", documentVersion: 3 }),
            allocateServiceRecordRevisionDocumentVersionInTransaction: jest.fn().mockResolvedValue(3),
        };
        const finalization = new ServiceRecordFinalizationService(prisma as never, { recompute: jest.fn() } as never,
            snapshot as never, createHolidayCalendarStub(), jobs as never, editRepository as never);
        const claim = finalization as unknown as { claimFinalizationCase: (id: string, branch: string, now: Date) => Promise<unknown> };
        await expect(claim.claimFinalizationCase(caseId, branchId, date("2027-01-04")))
            .resolves.toMatchObject({ claimed: false, blockedGeneration: true });
        // Existing finalization only persists an unverified/manual-review generation. It never sends a document here.
        expect(jobs.enqueueInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({ payload: expect.objectContaining({
            manualReviewRequired: true, context: expect.objectContaining({ documentSyncStatus: "capability_unverified" }),
        }) }));
        expect(editRepository.createRevisionDocumentStateInTransaction).toHaveBeenCalledWith({ tx }, expect.objectContaining({
            step: "capability_unverified", status: "capability_unverified",
        }));
        expect(snapshot.executeCase).not.toHaveBeenCalled();
        expect(tx.service_record_case.updateMany).not.toHaveBeenCalled();
    });

});
