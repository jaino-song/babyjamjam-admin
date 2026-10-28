import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import type { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { buildServiceRecordCaregiverEditChanges } from "application/policies/service-record-revision-changes.policy";
import { SERVICE_RECORD_CASE_STATUS, ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { KOREAN_HOLIDAY_CALENDAR, createKrBusinessDayCalendar } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { tenantIsolationExtension } from "infrastructure/database/tenant-isolation.extension";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { UpsertSessionDto } from "interface/dto/service-record-entry.dto";

/**
 * Real-PostgreSQL proof for caregiver edits of a submitted service-record day:
 * the entry write path (one edit-log row per real change, original submit facts
 * untouched) and the admin read path (history list + per-edit changes lookup,
 * scoped to branch and client). Units 1.1 and 2.1 were verified with mocked Prisma only.
 *
 * Skipped unless HOLIDAY_REVIEW_REAL_DB=1, and then only against a local
 * throwaway database (the same opt-in as CI's test/prisma runner).
 */
// Matches the opt-in used by CI's test/prisma runner. This spec never opens a
// connection unless both URLs independently identify the same disposable DB.
const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;

export function assertThrowawayTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl) throw new Error("Refusing real-DB spec without DATABASE_URL and DIRECT_URL");
    if (databaseUrl !== directUrl) throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL differ");
    if (!/^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/.test(databaseUrl)) {
        throw new Error("Refusing real-DB spec: target must be a loopback throwaway database");
    }
}

describe("caregiver edit DB target guard", () => {
    it("accepts loopback throwaway targets and rejects missing, mismatched or remote targets", () => {
        const ok = "postgresql://jaino@127.0.0.1/throwaway_p447be";
        expect(() => assertThrowawayTarget(ok, ok)).not.toThrow();
        expect(() => assertThrowawayTarget("", "")).toThrow(/without/);
        expect(() => assertThrowawayTarget(ok, `${ok}_other`)).toThrow(/differ/);
        for (const bad of ["postgresql://jaino@localhost/production", "postgresql://jaino@db.example.com/throwaway_p447be", `${ok}?schema=public`, "postgresql://user:pw@localhost/throwaway_p447be"]) {
            expect(() => assertThrowawayTarget(bad, bad)).toThrow(/throwaway/);
        }
    });
});

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const SIGNATURE = "data:image/png;base64,aGVsbG8=";
const START = "2026-09-07";

describeReal("service-record caregiver edits (real PostgreSQL, tenant enforce)", () => {
    let raw: PrismaClient;
    let extended: PrismaClient;
    let service: ServiceRecordEntryService;
    let repository: ServiceRecordEditRepository;
    let branchA: string;
    let branchB: string;
    const previousMode = process.env["TENANT_ISOLATION_MODE"];

    type Fixture = Awaited<ReturnType<typeof makeCase>>;
    let own: Fixture; // client A in branch A, with the case under test
    let otherClientA: { id: number }; // second client in branch A, no case
    let clientB: Fixture; // client in branch B, with its own case

    // Shared across the ordered tests below.
    let sessionOneDayId: string;
    let sessionTwoDayId: string;
    let serviceEditId: string;
    let seeded: { old: string; mid: string; recent: string };
    let revisionsBeforeEdits: unknown;

    beforeAll(async () => {
        assertThrowawayTarget();
        process.env["TENANT_ISOLATION_MODE"] = "enforce";
        for (const level of ["log", "warn", "debug", "error"] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
        }
        raw = new PrismaClient();
        await raw.$connect();
        const suffix = randomUUID();
        branchA = (await raw.branch.create({ data: { name: "edit A", slug: `throwaway-ce-a-${suffix}` } })).id;
        branchB = (await raw.branch.create({ data: { name: "edit B", slug: `throwaway-ce-b-${suffix}` } })).id;

        const calendar = createKrBusinessDayCalendar(
            [...Object.values(KOREAN_HOLIDAY_CALENDAR).flat()],
            { version: "kr-db-test", supportedYears: Object.keys(KOREAN_HOLIDAY_CALENDAR).map(Number) },
        );
        const holidayCalendar = { forBranch: async () => calendar } as unknown as HolidayCalendarService;
        extended = new PrismaClient().$extends(tenantIsolationExtension()) as unknown as PrismaClient;
        service = new ServiceRecordEntryService(
            extended as unknown as PrismaService,
            { extendExpiryForCase: async () => undefined } as unknown as ServiceRecordTokenService,
            { ensureForClient: async () => null, recompute: async () => null } as unknown as ServiceRecordLifecycleService,
            holidayCalendar,
        );
        repository = new ServiceRecordEditRepository(raw as unknown as PrismaService);

        own = await makeCase(branchA);
        otherClientA = await raw.client.create({
            data: { name: `고객${randomUUID().slice(0, 8)}`, voucherClient: false, branchId: branchA, serviceStatus: "active" },
            select: { id: true },
        });
        clientB = await makeCase(branchB);
    });

    // Revisions and edit logs are append-only / FK-protected. Do not weaken
    // anything for cleanup; the caller drops the disposable database after this run.
    afterAll(async () => {
        await extended?.$disconnect();
        await raw?.$disconnect();
        if (previousMode === undefined) delete process.env["TENANT_ISOLATION_MODE"];
        else process.env["TENANT_ISOLATION_MODE"] = previousMode;
        jest.restoreAllMocks();
    });

    /** A case 2026-09-07..2026-09-29 (N = 15) with a complete header, so a session can be submitted + locked. */
    async function makeCase(branchId: string) {
        const label = Math.floor(Math.random() * 90_000_000 + 10_000_000).toString();
        const employee = await raw.employee.create({
            data: { name: `제공자${label}`, workArea: [], phone: `010-${label.slice(0, 4)}-${label.slice(4)}`, phoneNormalized: `010${label}`, grade: "A", branchId },
        });
        const client = await raw.client.create({
            data: {
                name: `고객${label}`,
                voucherClient: false,
                branchId,
                startDate: d(START),
                endDate: d("2026-09-29"),
                duration: 15,
                serviceStatus: "active",
                bookingConfirmedAt: new Date("2026-01-01"),
            },
        });
        const schedule = await raw.employee_schedule.create({
            data: {
                primaryEmployeeId: employee.id,
                workAddress: "서울",
                startDate: d(START),
                endDate: d("2026-09-29"),
                clientId: client.id,
                branchId,
            },
        });
        const record = await raw.service_record_case.create({
            data: {
                branchId,
                clientId: client.id,
                status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                startDate: d(START),
                endDate: d("2026-09-29"),
                requiredSessionCount: 15,
                momName: "산모",
                momBirth: "1990-01-01",
                babyName: "아기",
                babyBirth: "2026-08-30",
                deliveryType: "natural",
                babyWeight: "3.2",
            },
        });
        return { employee, client, schedule, record, branchId };
    }

    const save = (fixture: Fixture, sessionIndex: number, serviceDate: string, patch: Partial<UpsertSessionDto> = {}) =>
        tenantContextStore.run({ origin: "http", branchId: fixture.branchId }, async () => await service.upsertSession(
            {
                tokenId: "token-1",
                branchId: fixture.branchId,
                scheduleId: fixture.schedule.id,
                employeeId: fixture.employee.id,
                serviceRecordCaseId: fixture.record.id,
            },
            sessionIndex,
            {
                serviceDate: `${serviceDate}T00:00:00.000Z`,
                answers: {},
                notes: "초기 메모",
                paymentConfirmed: true,
                momApproval: "approved",
                clientSignature: SIGNATURE,
                ...patch,
            } as UpsertSessionDto,
            true,
        ));

    const editLogRows = (caseId: string) => raw.service_record_day_edit_log.findMany({ where: { serviceRecordCaseId: caseId }, orderBy: { editedAt: "asc" } });
    const dayRow = (caseId: string, sessionIndex: number) =>
        raw.service_record_day.findUniqueOrThrow({ where: { serviceRecordCaseId_caseSessionIndex: { serviceRecordCaseId: caseId, caseSessionIndex: sessionIndex } } });

    it("lists no caregiver edits for a case that has none", async () => {
        const history = await repository.listRevisionHistory(branchA, own.client.id);
        expect(history).not.toBeNull();
        expect(history?.caseId).toBe(own.record.id);
        expect(history?.caregiverEdits).toEqual([]);
        revisionsBeforeEdits = history?.revisions;
        // A client of the same branch without a case has no history at all.
        expect(await repository.listRevisionHistory(branchA, otherClientA.id)).toBeNull();
    });

    describe("entry write path (ServiceRecordEntryService on real Prisma)", () => {
        it("submits and locks sessions 1 and 2 through the service without writing an edit-log row", async () => {
            await save(own, 1, START);
            await save(own, 2, "2026-09-08");
            const one = await dayRow(own.record.id, 1);
            const two = await dayRow(own.record.id, 2);
            expect(one.locked).toBe(true);
            expect(one.clientSignature).toBe(SIGNATURE);
            expect(one.submittedAt).not.toBeNull();
            expect(one.notes).toBe("초기 메모");
            sessionOneDayId = one.id;
            sessionTwoDayId = two.id;
            expect(await editLogRows(own.record.id)).toHaveLength(0);
        });

        it("writes no row for an unchanged re-submit of a locked day", async () => {
            const before = await dayRow(own.record.id, 1);
            await save(own, 1, START);
            expect(await editLogRows(own.record.id)).toHaveLength(0);
            expect(await dayRow(own.record.id, 1)).toEqual(before);
        });

        it("writes exactly one row for a changed re-submit and leaves the submit facts untouched", async () => {
            const before = await dayRow(own.record.id, 1);
            // The caregiver's resend carries a (different) signature too; it must be ignored.
            await save(own, 1, START, { notes: "수정된 메모", clientSignature: "data:image/png;base64,b3RoZXI=" });

            const rows = await editLogRows(own.record.id);
            expect(rows).toHaveLength(1);
            const row = rows[0]!;
            serviceEditId = row.id;
            expect(row).toMatchObject({
                branchId: branchA,
                serviceRecordCaseId: own.record.id,
                caseSessionIndex: 1,
                serviceRecordDayId: sessionOneDayId,
                employeeId: own.employee.id,
                employeeNameSnapshot: own.employee.name,
            });
            expect(row.before).toEqual({ serviceDate: START, answers: {}, etcService: null, notes: "초기 메모", paymentConfirmed: true });
            expect(row.after).toEqual({ serviceDate: START, answers: {}, etcService: null, notes: "수정된 메모", paymentConfirmed: true });

            const after = await dayRow(own.record.id, 1);
            expect(after.notes).toBe("수정된 메모");
            expect(after.clientSignature).toBe(before.clientSignature);
            expect(after.clientSignedAt).toEqual(before.clientSignedAt);
            expect(after.submittedAt).toEqual(before.submittedAt);
            expect(after.serviceDate).toEqual(before.serviceDate);
            expect(after.locked).toBe(true);
            expect(after.employeeId).toBe(before.employeeId);
            // Session 2 and the other branch's case are untouched.
            expect(await editLogRows(clientB.record.id)).toHaveLength(0);
        });

        it("writes nothing when the same edit is re-sent unchanged", async () => {
            await save(own, 1, START, { notes: "수정된 메모" });
            expect(await editLogRows(own.record.id)).toHaveLength(1);
        });
    });

    describe("admin read path (repository + changes policy)", () => {
        it("seeds additional edit-log rows with explicit, distinct editedAt", async () => {
            const make = (editedAt: string, caseSessionIndex: number, serviceRecordDayId: string, employeeNameSnapshot: string, before: object, after: object) =>
                raw.service_record_day_edit_log.create({
                    data: {
                        branchId: branchA,
                        serviceRecordCaseId: own.record.id,
                        caseSessionIndex,
                        serviceRecordDayId,
                        employeeId: own.employee.id,
                        employeeNameSnapshot,
                        before,
                        after,
                        editedAt: new Date(editedAt),
                    },
                });
            const base = { serviceDate: START, etcService: null, notes: "전", paymentConfirmed: false };
            const old = await make("2020-01-01T00:00:00.000Z", 1, sessionOneDayId, "오래된", { ...base, answers: {} }, { ...base, answers: {}, notes: "후" });
            const mid = await make("2020-01-02T00:00:00.000Z", 2, sessionTwoDayId, "중간", { ...base, answers: {} }, { ...base, answers: {}, paymentConfirmed: true });
            const recent = await make(
                "2020-01-03T00:00:00.000Z",
                1,
                sessionOneDayId,
                "최근",
                { ...base, answers: { meal: "A" } },
                { ...base, answers: { meal: "B", rest: "C" }, etcService: "기타", notes: "후", paymentConfirmed: true },
            );
            seeded = { old: old.id, mid: mid.id, recent: recent.id };
            expect(await editLogRows(own.record.id)).toHaveLength(4);
        });

        it("lists caregiver edits newest first with identity only, and leaves revisions unchanged", async () => {
            const history = await repository.listRevisionHistory(branchA, own.client.id);
            expect(history?.caregiverEdits.map((edit) => edit.id)).toEqual([serviceEditId, seeded.recent, seeded.mid, seeded.old]);
            const serviceEdit = await raw.service_record_day_edit_log.findUniqueOrThrow({ where: { id: serviceEditId } });
            expect(history?.caregiverEdits).toEqual([
                { id: serviceEditId, editedAt: serviceEdit.editedAt.toISOString(), sessionIndex: 1, employeeName: own.employee.name },
                { id: seeded.recent, editedAt: "2020-01-03T00:00:00.000Z", sessionIndex: 1, employeeName: "최근" },
                { id: seeded.mid, editedAt: "2020-01-02T00:00:00.000Z", sessionIndex: 2, employeeName: "중간" },
                { id: seeded.old, editedAt: "2020-01-01T00:00:00.000Z", sessionIndex: 1, employeeName: "오래된" },
            ]);
            for (const edit of history?.caregiverEdits ?? []) {
                expect(Object.keys(edit).sort()).toEqual(["editedAt", "employeeName", "id", "sessionIndex"]);
            }
            expect(JSON.stringify(history?.caregiverEdits)).not.toMatch(/before|after|수정된 메모/);
            expect(history?.revisions).toEqual(revisionsBeforeEdits);
        });

        it("does not leak one case's edits into another branch's history", async () => {
            const history = await repository.listRevisionHistory(branchB, clientB.client.id);
            expect(history?.caseId).toBe(clientB.record.id);
            expect(history?.caregiverEdits).toEqual([]);
            // Client A's id under branch B's scope resolves to no case at all.
            expect(await repository.listRevisionHistory(branchB, own.client.id)).toBeNull();
        });

        it("finds an edit for its own branch and client", async () => {
            const found = await repository.findCaregiverEditForChanges(branchA, own.client.id, seeded.recent);
            expect(found).toMatchObject({
                id: seeded.recent,
                editedAt: new Date("2020-01-03T00:00:00.000Z"),
                employeeNameSnapshot: "최근",
                caseSessionIndex: 1,
            });
            expect(found?.before).toEqual({ serviceDate: START, etcService: null, notes: "전", paymentConfirmed: false, answers: { meal: "A" } });
        });

        it("returns null for another branch, another client, an unknown id and a malformed id", async () => {
            const find = (branchId: string, clientId: number, id: string) => repository.findCaregiverEditForChanges(branchId, clientId, id);
            // Another branch (client A's id under branch B's scope).
            expect(await find(branchB, own.client.id, seeded.recent)).toBeNull();
            // Another client of the same branch.
            expect(await find(branchA, otherClientA.id, seeded.recent)).toBeNull();
            // Another branch's client under the owning branch, and under its own branch.
            expect(await find(branchA, clientB.client.id, seeded.recent)).toBeNull();
            expect(await find(branchB, clientB.client.id, seeded.recent)).toBeNull();
            // Unknown and malformed ids.
            expect(await find(branchA, own.client.id, randomUUID())).toBeNull();
            for (const malformed of ["not-a-uuid", "", `${seeded.recent}x`, "' OR 1=1 --"]) {
                expect(await find(branchA, own.client.id, malformed)).toBeNull();
            }
        });

        it("builds the expected diff paths from a fetched row", async () => {
            const recent = await repository.findCaregiverEditForChanges(branchA, own.client.id, seeded.recent);
            expect(recent).not.toBeNull();
            const changes = buildServiceRecordCaregiverEditChanges(recent!);
            expect(changes).toMatchObject({ editId: seeded.recent, editedAt: "2020-01-03T00:00:00.000Z", employeeName: "최근" });
            expect(changes.session).toMatchObject({ sessionIndex: 1, kind: "changed", serviceDateBefore: START, serviceDateAfter: START });
            expect(changes.session.changes).toEqual([
                { path: "session.answers.meal", before: "A", after: "B" },
                { path: "session.answers.rest", before: null, after: "C" },
                { path: "session.etcService", before: null, after: "기타" },
                { path: "session.notes", before: "전", after: "후" },
                { path: "session.paymentConfirmed", before: false, after: true },
            ]);

            // The edit the service wrote itself diffs on notes only.
            const written = await repository.findCaregiverEditForChanges(branchA, own.client.id, serviceEditId);
            const writtenChanges = buildServiceRecordCaregiverEditChanges(written!);
            expect(writtenChanges.employeeName).toBe(own.employee.name);
            expect(writtenChanges.session.changes).toEqual([{ path: "session.notes", before: "초기 메모", after: "수정된 메모" }]);
        });
    });
});
