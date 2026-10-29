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
    // Read-only fixtures shared by every test (never written after beforeAll).
    // Each test builds its own case, so the tests do not depend on order.
    let otherClientA: { id: number }; // second client in branch A, no case
    let clientB: Fixture; // client in branch B, with its own case


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


    /** A fresh case + client in branch A with sessions 1 and 2 submitted and locked through the service. No edits. */
    async function submittedCase() {
        const fixture = await makeCase(branchA);
        await save(fixture, 1, START);
        await save(fixture, 2, "2026-09-08");
        const one = await dayRow(fixture.record.id, 1);
        const two = await dayRow(fixture.record.id, 2);
        return { fixture, sessionOneDayId: one.id, sessionTwoDayId: two.id };
    }

    /** Three edit-log rows with explicit, distinct editedAt, inserted directly. */
    async function seedEdits(base: Awaited<ReturnType<typeof submittedCase>>) {
        const { fixture, sessionOneDayId, sessionTwoDayId } = base;
        const make = (editedAt: string, caseSessionIndex: number, serviceRecordDayId: string, employeeNameSnapshot: string, before: object, after: object) =>
            raw.service_record_day_edit_log.create({
                data: {
                    branchId: branchA,
                    serviceRecordCaseId: fixture.record.id,
                    caseSessionIndex,
                    serviceRecordDayId,
                    employeeId: fixture.employee.id,
                    employeeNameSnapshot,
                    before,
                    after,
                    editedAt: new Date(editedAt),
                },
            });
        const plain = { serviceDate: START, etcService: null, notes: "전", paymentConfirmed: false };
        const old = await make("2020-01-01T00:00:00.000Z", 1, sessionOneDayId, "오래된", { ...plain, answers: {} }, { ...plain, answers: {}, notes: "후" });
        const mid = await make("2020-01-02T00:00:00.000Z", 2, sessionTwoDayId, "중간", { ...plain, answers: {} }, { ...plain, answers: {}, paymentConfirmed: true });
        const recent = await make(
            "2020-01-03T00:00:00.000Z",
            1,
            sessionOneDayId,
            "최근",
            { ...plain, answers: { meal: "A" } },
            { ...plain, answers: { meal: "B", rest: "C" }, etcService: "기타", notes: "후", paymentConfirmed: true },
        );
        return { old: old.id, mid: mid.id, recent: recent.id };
    }

    it("lists no caregiver edits for a case that has none", async () => {
        const { fixture } = await submittedCase();
        const history = await repository.listRevisionHistory(branchA, fixture.client.id);
        expect(history).not.toBeNull();
        expect(history?.caseId).toBe(fixture.record.id);
        expect(history?.caregiverEdits).toEqual([]);
        // A client of the same branch without a case has no history at all.
        expect(await repository.listRevisionHistory(branchA, otherClientA.id)).toBeNull();
    });

    describe("entry write path (ServiceRecordEntryService on real Prisma)", () => {
        it("logs exactly one row per real change of a locked day and never touches the submit facts", async () => {
            const { fixture, sessionOneDayId } = await submittedCase();
            const caseId = fixture.record.id;

            // Submitting sessions 1 and 2 wrote no edit-log row.
            const submitted = await dayRow(caseId, 1);
            expect(submitted.locked).toBe(true);
            expect(submitted.clientSignature).toBe(SIGNATURE);
            expect(submitted.submittedAt).not.toBeNull();
            expect(submitted.notes).toBe("초기 메모");
            expect(await editLogRows(caseId)).toHaveLength(0);

            // Unchanged re-submit: no row, day untouched.
            await save(fixture, 1, START);
            expect(await editLogRows(caseId)).toHaveLength(0);
            expect(await dayRow(caseId, 1)).toEqual(submitted);

            // Changed re-submit (with a different signature, which must be ignored): exactly one row.
            await save(fixture, 1, START, { notes: "수정된 메모", clientSignature: "data:image/png;base64,b3RoZXI=" });
            const rows = await editLogRows(caseId);
            expect(rows).toHaveLength(1);
            const row = rows[0]!;
            expect(row).toMatchObject({
                branchId: branchA,
                serviceRecordCaseId: caseId,
                caseSessionIndex: 1,
                serviceRecordDayId: sessionOneDayId,
                employeeId: fixture.employee.id,
                employeeNameSnapshot: fixture.employee.name,
            });
            expect(row.before).toEqual({ serviceDate: START, answers: {}, etcService: null, notes: "초기 메모", paymentConfirmed: true });
            expect(row.after).toEqual({ serviceDate: START, answers: {}, etcService: null, notes: "수정된 메모", paymentConfirmed: true });

            const edited = await dayRow(caseId, 1);
            expect(edited.notes).toBe("수정된 메모");
            expect(edited.clientSignature).toBe(submitted.clientSignature);
            expect(edited.clientSignedAt).toEqual(submitted.clientSignedAt);
            expect(edited.submittedAt).toEqual(submitted.submittedAt);
            expect(edited.serviceDate).toEqual(submitted.serviceDate);
            expect(edited.locked).toBe(true);
            expect(edited.employeeId).toBe(submitted.employeeId);
            // Session 2 and the other branch's case are untouched.
            expect(await dayRow(caseId, 2)).toMatchObject({ notes: "초기 메모", locked: true });
            expect(await editLogRows(clientB.record.id)).toHaveLength(0);

            // Re-sending the same edit is unchanged again: still one row.
            await save(fixture, 1, START, { notes: "수정된 메모" });
            expect(await editLogRows(caseId)).toHaveLength(1);

            // The admin read path sees the service-written row, scoped to its branch and client.
            const history = await repository.listRevisionHistory(branchA, fixture.client.id);
            expect(history?.caregiverEdits).toEqual([
                { id: row.id, editedAt: row.editedAt.toISOString(), sessionIndex: 1, employeeName: fixture.employee.name },
            ]);
            const written = await repository.findCaregiverEditForChanges(branchA, fixture.client.id, row.id);
            const writtenChanges = buildServiceRecordCaregiverEditChanges(written!);
            expect(writtenChanges.employeeName).toBe(fixture.employee.name);
            expect(writtenChanges.session.changes).toEqual([{ path: "session.notes", before: "초기 메모", after: "수정된 메모" }]);
            expect(await repository.findCaregiverEditForChanges(branchB, fixture.client.id, row.id)).toBeNull();
        });
    });

    describe("current-provider re-check (replacement wins before the caregiver's write)", () => {
        it("refuses a locked edit and a first submit once the caregiver's schedule is replaced, with no log row and no day change", async () => {
            const { fixture } = await submittedCase();
            const caseId = fixture.record.id;
            const before = await dayRow(caseId, 1);
            expect(await editLogRows(caseId)).toHaveLength(0);

            // The replacement flow commits `replaced = true` under the write-set
            // locks (and hands the day to a new primary) while this caregiver's
            // request still holds a context resolved before it. The token row is
            // deliberately left alone: it is revoked only after commit.
            await raw.employee_schedule.update({ where: { id: fixture.schedule.id }, data: { replaced: true } });
            const label = Math.floor(Math.random() * 90_000_000 + 10_000_000).toString();
            const successor = await raw.employee.create({
                data: {
                    name: `후임${label}`, workArea: [], phone: `010-${label.slice(0, 4)}-${label.slice(4)}`,
                    phoneNormalized: `010${label}`, grade: "A", branchId: branchA,
                },
            });
            await raw.employee_schedule.create({
                data: {
                    primaryEmployeeId: successor.id,
                    workAddress: "서울",
                    startDate: d(START),
                    endDate: d("2026-09-29"),
                    clientId: fixture.client.id,
                    branchId: branchA,
                },
            });

            // A locked edit by the replaced caregiver is refused.
            await expect(save(fixture, 1, START, { notes: "교체 후 수정" })).rejects.toMatchObject({
                response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
            });
            // So is a first submit of a new session.
            await expect(save(fixture, 3, "2026-09-09")).rejects.toMatchObject({
                response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" },
            });

            expect(await editLogRows(caseId)).toHaveLength(0);
            expect(await dayRow(caseId, 1)).toEqual(before);
            expect(await raw.service_record_day.findUnique({
                where: { serviceRecordCaseId_caseSessionIndex: { serviceRecordCaseId: caseId, caseSessionIndex: 3 } },
            })).toBeNull();
        });
    });

    describe("admin read path (repository + changes policy)", () => {
        it("lists caregiver edits newest first with identity only, and preserves a real revision", async () => {
            const base = await submittedCase();
            const { fixture } = base;
            // A real revision, appended after the days were submitted (it makes the case's planned dates authoritative).
            const revision = await repository.appendRevision({
                branchId: branchA,
                serviceRecordCaseId: fixture.record.id,
                actorUserId: randomUUID(),
                payload: { header: { momName: "개정" } },
                plannedSessions: [],
                provenance: {},
                formVersionAtConfirm: 1,
            });
            expect(revision.revisionNumber).toBe(1);

            const baseline = await repository.listRevisionHistory(branchA, fixture.client.id);
            expect(baseline?.caregiverEdits).toEqual([]);
            // Independent oracle for the revision summary (not derived from the response under test).
            const stored = await raw.service_record_case.findUniqueOrThrow({ where: { id: fixture.record.id } });
            const storedRevision = await raw.service_record_revision.findUniqueOrThrow({ where: { id: revision.id } });
            expect(baseline?.revisions).toEqual([
                {
                    id: revision.id,
                    revisionNumber: 1,
                    confirmedAt: storedRevision.confirmedAt.toISOString(),
                    isCurrent: stored.currentRevisionId === revision.id,
                    documents: [],
                },
            ]);

            const seeded = await seedEdits(base);
            const history = await repository.listRevisionHistory(branchA, fixture.client.id);
            expect(history?.caregiverEdits).toEqual([
                { id: seeded.recent, editedAt: "2020-01-03T00:00:00.000Z", sessionIndex: 1, employeeName: "최근" },
                { id: seeded.mid, editedAt: "2020-01-02T00:00:00.000Z", sessionIndex: 2, employeeName: "중간" },
                { id: seeded.old, editedAt: "2020-01-01T00:00:00.000Z", sessionIndex: 1, employeeName: "오래된" },
            ]);
            for (const edit of history?.caregiverEdits ?? []) {
                expect(Object.keys(edit).sort()).toEqual(["editedAt", "employeeName", "id", "sessionIndex"]);
            }
            expect(JSON.stringify(history?.caregiverEdits)).not.toMatch(/before|after/);
            // The revision list is preserved, byte for byte, once edits exist.
            expect(history?.revisions).toEqual(baseline?.revisions);
            expect(history?.revisions).toHaveLength(1);
        });

        it("does not leak one case's edits into another branch's history", async () => {
            const base = await submittedCase();
            await seedEdits(base);
            const history = await repository.listRevisionHistory(branchB, clientB.client.id);
            expect(history?.caseId).toBe(clientB.record.id);
            expect(history?.caregiverEdits).toEqual([]);
            // Client A's id under branch B's scope resolves to no case at all.
            expect(await repository.listRevisionHistory(branchB, base.fixture.client.id)).toBeNull();
        });

        it("finds an edit for its own branch and client", async () => {
            const base = await submittedCase();
            const seeded = await seedEdits(base);
            const found = await repository.findCaregiverEditForChanges(branchA, base.fixture.client.id, seeded.recent);
            expect(found).toMatchObject({
                id: seeded.recent,
                editedAt: new Date("2020-01-03T00:00:00.000Z"),
                employeeNameSnapshot: "최근",
                caseSessionIndex: 1,
            });
            expect(found?.before).toEqual({ serviceDate: START, etcService: null, notes: "전", paymentConfirmed: false, answers: { meal: "A" } });
        });

        it("returns null for another branch, another client, an unknown id and a malformed id", async () => {
            const base = await submittedCase();
            const seeded = await seedEdits(base);
            const find = (branchId: string, clientId: number, id: string) => repository.findCaregiverEditForChanges(branchId, clientId, id);
            // Another branch (client A's id under branch B's scope).
            expect(await find(branchB, base.fixture.client.id, seeded.recent)).toBeNull();
            // Another client of the same branch.
            expect(await find(branchA, otherClientA.id, seeded.recent)).toBeNull();
            // Another branch's client under the owning branch, and under its own branch.
            expect(await find(branchA, clientB.client.id, seeded.recent)).toBeNull();
            expect(await find(branchB, clientB.client.id, seeded.recent)).toBeNull();
            // Unknown and malformed ids.
            expect(await find(branchA, base.fixture.client.id, randomUUID())).toBeNull();
            for (const malformed of ["not-a-uuid", "", `${seeded.recent}x`, "' OR 1=1 --"]) {
                expect(await find(branchA, base.fixture.client.id, malformed)).toBeNull();
            }
        });

        it("builds the expected diff paths from a fetched row", async () => {
            const base = await submittedCase();
            const seeded = await seedEdits(base);
            const recent = await repository.findCaregiverEditForChanges(branchA, base.fixture.client.id, seeded.recent);
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
        });
    });
});
