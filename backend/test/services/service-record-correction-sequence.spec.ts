/**
 * Sequence tests for the service-record correction flow (plan rev 2, Task 2b.3).
 *
 * Every earlier test built each step's input by hand. These tests chain the real services over one
 * in-memory store (test/utils/service-record-sequence-store.ts), so each step reads exactly what the
 * previous step persisted: a resume confirm's output is what a later header confirm, realignment,
 * and finalization eligibility check see. The R3 blockers lived in those hand-offs.
 *
 * Real code under test: AdminServiceRecordEditService over ServiceRecordEditRepository (source
 * projection, confirm transaction and all case/client/day/assignment/schedule/token writes),
 * ServiceRecordScheduleRealignmentService and ServiceRecordFinalizationService's
 * claim path. The only repository seams replaced are the ones that need raw SQL or an external
 * provider (see `createHarness`).
 *
 * Every expected date below is derived by hand from the KR calendar and written next to its
 * derivation; none is computed with the code under test. Calendar facts used: weekends are off
 * unless a client allows them; 2026 public holidays in range are 10-03 (Sat, 개천절), 10-05 (Mon,
 * its substitute day) and 10-09 (Fri, 한글날); 추석 is 09-24..09-26. Nothing falls between 10-12 and
 * 11-06.
 */
import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { ServiceRecordFinalizationService } from "application/services/service-record-finalization.service";
import { ServiceRecordScheduleRealignmentService } from "application/services/service-record-schedule-realignment.service";
import { ServiceRecordEditNotFoundError } from "domain/errors/service-record-edit.error";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";

import { createHolidayCalendarStub } from "../utils/holiday-calendar.stub";
import { pinToday, unpinToday } from "../utils/pin-today";
import { SequenceStore, type Row } from "../utils/service-record-sequence-store";

// ---------------------------------------------------------------------------------------------
// Identities (synthetic). 가상산모 is the client; 가상관리사갑 (A) served first, 가상관리사을 (B) took over.
// ---------------------------------------------------------------------------------------------
const BRANCH_ID = "00000000-0000-4000-8000-0000000000b1";
const CASE_ID = "00000000-0000-4000-8000-0000000000c1";
const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR_ID = "00000000-0000-4000-8000-0000000000a1";
const CLIENT_ID = 5;
const SCHEDULE_A = 126;
const SCHEDULE_B = 139;
const EMPLOYEE_A = 31;
const EMPLOYEE_B = 32;

/** The spec's clock: 2026-10-14 00:00 KST. Individual steps pass their own `now` where the plan says so. */
const SPEC_NOW = "2026-10-13T15:00:00.000Z";

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ymd = (value: unknown) => (value as Date).toISOString().slice(0, 10);
const instantOf = (value: unknown) => (value as Date | null)?.toISOString() ?? null;
/** 18:00 KST on the given date: a submission can never precede the date its session ends up on. */
const submittedAtFor = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

// ---------------------------------------------------------------------------------------------
// S1 / S2 dates. The incident: A served 10-01, service paused 10-02..10-13 and resumed 10-14 with B.
// ---------------------------------------------------------------------------------------------
/**
 * The stored vector before the correction: business days from 10-01 (Thu).
 * 10-01 Thu, 10-02 Fri, [10-03 Sat, 10-04 Sun, 10-05 substitute holiday], 10-06 Tue, 10-07 Wed,
 * 10-08 Thu, [10-09 한글날], 10-12 Mon, 10-13 Tue, 10-14 Wed, 10-15 Thu, 10-16 Fri, [weekend],
 * 10-19 Mon, 10-20 Tue, 10-21 Wed, 10-22 Thu, 10-23 Fri => 15 sessions, last 10-23.
 */
const OLD_DATES = [
    "2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13",
    "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
];
/**
 * Session 1 stays on 10-01 (A served it). Sessions 2..15 are re-planned from the resume date, Wed 10-14,
 * onto the next 14 business days (Saturday off): Wed 10-14, Thu 10-15, Fri 10-16, [weekend], Mon 10-19,
 * Tue 10-20, Wed 10-21, Thu 10-22, Fri 10-23, [weekend], Mon 10-26, Tue 10-27, Wed 10-28, Thu 10-29,
 * Fri 10-30, [weekend 10-31/11-01], Mon 11-02. That is 3 + 5 + 5 + 1 = 14 sessions.
 */
const NEW_DATES = [
    "2026-10-01", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21",
    "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02",
];

// ---------------------------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------------------------
interface SeedDay {
    sessionIndex: number;
    serviceDate: string;
    submittedAt: Date;
    owner: "A" | "B";
}

interface SeedOptions {
    duration: number;
    clientStart: string;
    clientEnd: string;
    scheduleA: { startDate: string; endDate: string };
    scheduleB: { startDate: string; endDate: string };
    /** The stored vector, one entry per session. */
    vector: ReadonlyArray<{ serviceDate: string; owner: "A" | "B" }>;
    days: readonly SeedDay[];
    dueAt: string;
    tokenBExpiresAt: string;
}

function seedStore(options: SeedOptions): SequenceStore {
    const owners = {
        A: { assignmentId: A_ID, scheduleId: SCHEDULE_A, employeeId: EMPLOYEE_A, name: "가상관리사갑" },
        B: { assignmentId: B_ID, scheduleId: SCHEDULE_B, employeeId: EMPLOYEE_B, name: "가상관리사을" },
    } as const;
    const store = new SequenceStore();
    store.insert("branch", { id: BRANCH_ID, name: "테스트 지점" });
    store.insert("employee", { id: EMPLOYEE_A, branchId: BRANCH_ID, name: "가상관리사갑", phone: "01000000031" });
    store.insert("employee", { id: EMPLOYEE_B, branchId: BRANCH_ID, name: "가상관리사을", phone: "01000000032" });
    store.insert("client", {
        id: CLIENT_ID, branchId: BRANCH_ID, name: "가상산모", duration: options.duration,
        startDate: date(options.clientStart), endDate: date(options.clientEnd), serviceStatus: "in_progress",
        bookingConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    // A is created first, so its schedule id is the lower one (the successor order the editor relies on).
    store.insert("employee_schedule", {
        id: SCHEDULE_A, branchId: BRANCH_ID, clientId: CLIENT_ID, primaryEmployeeId: EMPLOYEE_A,
        startDate: date(options.scheduleA.startDate), endDate: date(options.scheduleA.endDate), replaced: true,
    });
    store.insert("employee_schedule", {
        id: SCHEDULE_B, branchId: BRANCH_ID, clientId: CLIENT_ID, primaryEmployeeId: EMPLOYEE_B,
        startDate: date(options.scheduleB.startDate), endDate: date(options.scheduleB.endDate), replaced: false,
    });
    store.insert("service_record_case", {
        id: CASE_ID, branchId: BRANCH_ID, clientId: CLIENT_ID, status: "IN_PROGRESS", version: 7, formVersion: 3,
        requiredSessionCount: options.vector.length,
        startDate: date(options.clientStart), endDate: date(options.clientEnd),
        finalizationDueAt: new Date(options.dueAt),
        momName: "가상산모", momBirth: "900101", babyName: "아기", babyBirth: "260701",
        deliveryType: "자연분만", babyWeight: "3.2",
        plannedSessions: options.vector.map((entry, offset) => ({
            sessionIndex: offset + 1,
            serviceDate: entry.serviceDate,
            originalDate: entry.serviceDate,
            assignmentId: owners[entry.owner].assignmentId,
            scheduleId: owners[entry.owner].scheduleId,
            employeeId: owners[entry.owner].employeeId,
            provenanceVersion: "case-7",
        })),
    });
    for (const [key, schedule] of [["A", options.scheduleA], ["B", options.scheduleB]] as const) {
        const owner = owners[key];
        store.insert("service_record_assignment", {
            id: owner.assignmentId, branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID, scheduleId: owner.scheduleId,
            employeeId: owner.employeeId, employeeNameSnapshot: owner.name,
            employeePhoneSnapshot: key === "A" ? "01000000031" : "01000000032",
            startDate: date(schedule.startDate), endDate: date(schedule.endDate),
        });
    }
    for (const day of options.days) {
        const owner = owners[day.owner];
        store.insert("service_record_day", {
            id: `dddddddd-dddd-4ddd-8ddd-${String(day.sessionIndex).padStart(12, "0")}`,
            branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID, scheduleId: owner.scheduleId,
            employeeId: owner.employeeId, employeeNameSnapshot: owner.name,
            caseSessionIndex: day.sessionIndex, sessionIndex: day.sessionIndex, formVersion: 3,
            serviceDate: date(day.serviceDate), answers: { bath: "실시" }, notes: `메모 ${day.sessionIndex}`,
            paymentConfirmed: true, momApproval: "approved", clientSignature: `signature-${day.sessionIndex}`,
            clientSignedAt: new Date(day.submittedAt.getTime() - 60_000), locked: true, submittedAt: day.submittedAt,
        });
    }
    // B's link runs to the old end date; A's link was revoked at the replacement.
    store.insert("service_record_token", {
        id: "99999999-9999-4999-8999-00000000000b", branchId: BRANCH_ID, scheduleId: SCHEDULE_B,
        employeeId: EMPLOYEE_B, serviceRecordCaseId: CASE_ID, linkTokenHash: "hash-b", expectedPhoneHash: "phone-b",
        active: true, expiresAt: new Date(options.tokenBExpiresAt),
    });
    store.insert("service_record_token", {
        id: "99999999-9999-4999-8999-00000000000a", branchId: BRANCH_ID, scheduleId: SCHEDULE_A,
        employeeId: EMPLOYEE_A, serviceRecordCaseId: CASE_ID, linkTokenHash: "hash-a", expectedPhoneHash: "phone-a",
        active: false, revokedAt: new Date("2026-10-14T00:00:00.000Z"), expiresAt: new Date("2026-10-14T15:00:00.000Z"),
    });
    return store;
}

/**
 * S1: the golden incident. A (schedule 126) wrote session 1 on 10-01; B (schedule 139) wrote sessions 2..15
 * on the dates they were submitted (NEW_DATES, 18:00 KST) while the stored dates are still the old ones.
 * The stored vector owners are 1 -> A and 2..15 -> B; the stored end is 10-23.
 */
function seedGoldenIncident(): SequenceStore {
    return seedStore({
        duration: 15,
        clientStart: "2026-10-01",
        clientEnd: "2026-10-23",
        scheduleA: { startDate: "2026-10-01", endDate: "2026-10-14" },
        scheduleB: { startDate: "2026-10-14", endDate: "2026-10-23" },
        vector: OLD_DATES.map((serviceDate, offset) => ({ serviceDate, owner: offset === 0 ? "A" : "B" })),
        days: OLD_DATES.map((serviceDate, offset) => ({
            sessionIndex: offset + 1,
            serviceDate,
            submittedAt: submittedAtFor(NEW_DATES[offset]!),
            owner: offset === 0 ? "A" : "B",
        })),
        // Old end 10-23 20:00 KST.
        dueAt: "2026-10-23T11:00:00.000Z",
        // Midnight KST after the old end 10-23 = 10-24 00:00 KST.
        tokenBExpiresAt: "2026-10-23T15:00:00.000Z",
    });
}

/**
 * S2: the resume-day shape. Only session 1 is written (by A) and the persisted vector still gives every
 * session to A, because the replacement flow never rewrites it. B took over on 10-14 and has written nothing.
 */
function seedResumeDay(): SequenceStore {
    return seedStore({
        duration: 15,
        clientStart: "2026-10-01",
        clientEnd: "2026-10-23",
        scheduleA: { startDate: "2026-10-01", endDate: "2026-10-14" },
        scheduleB: { startDate: "2026-10-14", endDate: "2026-10-23" },
        vector: OLD_DATES.map((serviceDate) => ({ serviceDate, owner: "A" as const })),
        days: [{ sessionIndex: 1, serviceDate: "2026-10-01", submittedAt: submittedAtFor("2026-10-01"), owner: "A" }],
        dueAt: "2026-10-23T11:00:00.000Z",
        tokenBExpiresAt: "2026-10-23T15:00:00.000Z",
    });
}

/**
 * S3: three sessions. A (replaced, stored [10-01, 10-01]) wrote session 1 on 10-14 (that is when it was really
 * submitted); B (live, stored [10-02, 10-06]) owns 2 and 3 and has written nothing. The stored dates are the
 * business days from 10-01: Thu 10-01, Fri 10-02, [10-03 Sat, 10-04 Sun, 10-05 holiday], Tue 10-06.
 */
function seedThreeSessions(): SequenceStore {
    return seedStore({
        duration: 3,
        clientStart: "2026-10-01",
        clientEnd: "2026-10-06",
        scheduleA: { startDate: "2026-10-01", endDate: "2026-10-01" },
        scheduleB: { startDate: "2026-10-02", endDate: "2026-10-06" },
        vector: [
            { serviceDate: "2026-10-01", owner: "A" },
            { serviceDate: "2026-10-02", owner: "B" },
            { serviceDate: "2026-10-06", owner: "B" },
        ],
        days: [{ sessionIndex: 1, serviceDate: "2026-10-01", submittedAt: submittedAtFor("2026-10-14"), owner: "A" }],
        // 10-06 20:00 KST.
        dueAt: "2026-10-06T11:00:00.000Z",
        tokenBExpiresAt: "2026-10-06T15:00:00.000Z",
    });
}

/**
 * S8 seeds: three sessions on the stored dates 10-01 Thu, 10-02 Fri, 10-06 Tue (10-03..10-05 are a weekend and
 * the 개천절 substitute holiday). Each one differs from the others only in who owns and who wrote what.
 */
const THREE_DUE_AT = "2026-10-06T11:00:00.000Z"; // 10-06 20:00 KST
const THREE_TOKEN_B_EXPIRES_AT = "2026-10-06T15:00:00.000Z"; // midnight KST after 10-06

/**
 * S8a: the reviewer's tail shape. Every session is A's in the vector. A (replaced) is stored [10-01, 10-14] and
 * wrote ONLY session 3 (stored 10-06, inside A's period at that time); B (live) is stored [10-14, 10-23] and
 * wrote nothing.
 */
function seedHistoricalTail(): SequenceStore {
    return seedStore({
        duration: 3,
        clientStart: "2026-10-01",
        clientEnd: "2026-10-06",
        scheduleA: { startDate: "2026-10-01", endDate: "2026-10-14" },
        scheduleB: { startDate: "2026-10-14", endDate: "2026-10-23" },
        vector: [
            { serviceDate: "2026-10-01", owner: "A" },
            { serviceDate: "2026-10-02", owner: "A" },
            { serviceDate: "2026-10-06", owner: "A" },
        ],
        // Submitted on the date the session ends up on (10-16), so no submission precedes its new date.
        days: [{ sessionIndex: 3, serviceDate: "2026-10-06", submittedAt: submittedAtFor("2026-10-16"), owner: "A" }],
        dueAt: THREE_DUE_AT,
        tokenBExpiresAt: THREE_TOKEN_B_EXPIRES_AT,
    });
}

/**
 * S8b: the plain pause. B (live, stored [10-01, 10-06]) owns sessions 1 and 2 and wrote session 1 on 10-01;
 * A (replaced, stored [10-01, 10-01]) owns session 3, stored 10-06 (already outside A's period) and wrote it.
 * Resuming from session 2 keeps the caregiver: B is both outgoing and incoming.
 */
function seedPlainPauseWithHistoricalTail(): SequenceStore {
    return seedStore({
        duration: 3,
        clientStart: "2026-10-01",
        clientEnd: "2026-10-06",
        scheduleA: { startDate: "2026-10-01", endDate: "2026-10-01" },
        scheduleB: { startDate: "2026-10-01", endDate: "2026-10-06" },
        vector: [
            { serviceDate: "2026-10-01", owner: "B" },
            { serviceDate: "2026-10-02", owner: "B" },
            { serviceDate: "2026-10-06", owner: "A" },
        ],
        // Session 3 is submitted on the date it ends up on (10-15); session 1 on its own date.
        days: [
            { sessionIndex: 1, serviceDate: "2026-10-01", submittedAt: submittedAtFor("2026-10-01"), owner: "B" },
            { sessionIndex: 3, serviceDate: "2026-10-06", submittedAt: submittedAtFor("2026-10-15"), owner: "A" },
        ],
        dueAt: THREE_DUE_AT,
        tokenBExpiresAt: THREE_TOKEN_B_EXPIRES_AT,
    });
}

const SCHEDULE_Z = 100;
const EMPLOYEE_Z = 30;
const Z_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * S8c: three caregivers. Z (replaced, schedule 100, stored [10-01, 10-01]) wrote session 1 on 10-01 and owns
 * sessions 1 and 2 in the vector; A (replaced, schedule 126, stored [10-02, 10-02]) owns session 3 (stored 10-06,
 * outside A's period) and wrote it; B (live, schedule 139, stored [10-14, 10-23]) wrote nothing. Z is the lowest
 * schedule, so B is the one live successor either way; the test names it anyway.
 */
function seedOutgoingHistoricalTailIncoming(): SequenceStore {
    const store = seedStore({
        duration: 3,
        clientStart: "2026-10-01",
        clientEnd: "2026-10-06",
        scheduleA: { startDate: "2026-10-02", endDate: "2026-10-02" },
        scheduleB: { startDate: "2026-10-14", endDate: "2026-10-23" },
        vector: [
            { serviceDate: "2026-10-01", owner: "A" },
            { serviceDate: "2026-10-02", owner: "A" },
            { serviceDate: "2026-10-06", owner: "A" },
        ],
        days: [{ sessionIndex: 3, serviceDate: "2026-10-06", submittedAt: submittedAtFor("2026-10-15"), owner: "A" }],
        dueAt: THREE_DUE_AT,
        tokenBExpiresAt: THREE_TOKEN_B_EXPIRES_AT,
    });
    // Documented direct seeding: the third caregiver Z, and the vector's sessions 1 and 2 handed to Z.
    store.insert("employee", { id: EMPLOYEE_Z, branchId: BRANCH_ID, name: "박지수", phone: "01000000030" });
    store.insert("employee_schedule", {
        id: SCHEDULE_Z, branchId: BRANCH_ID, clientId: CLIENT_ID, primaryEmployeeId: EMPLOYEE_Z,
        startDate: date("2026-10-01"), endDate: date("2026-10-01"), replaced: true,
    });
    store.insert("service_record_assignment", {
        id: Z_ID, branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID, scheduleId: SCHEDULE_Z,
        employeeId: EMPLOYEE_Z, employeeNameSnapshot: "박지수", employeePhoneSnapshot: "01000000030",
        startDate: date("2026-10-01"), endDate: date("2026-10-01"),
    });
    store.insert("service_record_day", {
        id: `dddddddd-dddd-4ddd-8ddd-${String(1).padStart(12, "0")}`,
        branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID, scheduleId: SCHEDULE_Z, employeeId: EMPLOYEE_Z,
        employeeNameSnapshot: "박지수", caseSessionIndex: 1, sessionIndex: 1, formVersion: 3,
        serviceDate: date("2026-10-01"), answers: { bath: "실시" }, notes: "메모 1", paymentConfirmed: true,
        momApproval: "approved", clientSignature: "signature-1", clientSignedAt: new Date(submittedAtFor("2026-10-01").getTime() - 60_000),
        locked: true, submittedAt: submittedAtFor("2026-10-01"),
    });
    for (const planned of plannedOf(store).slice(0, 2)) {
        planned.assignmentId = Z_ID;
        planned.scheduleId = SCHEDULE_Z;
        planned.employeeId = EMPLOYEE_Z;
    }
    return store;
}

/**
 * S8d: the resume-day shape with three sessions. A (replaced, stored [10-01, 10-14]) owns every session and wrote
 * session 1 (stored 10-01, submitted on the resume day); B (live) is stored [10-14, 10-23].
 */
function seedResumeDayThreeSessions(): SequenceStore {
    return seedStore({
        duration: 3,
        clientStart: "2026-10-01",
        clientEnd: "2026-10-06",
        scheduleA: { startDate: "2026-10-01", endDate: "2026-10-14" },
        scheduleB: { startDate: "2026-10-14", endDate: "2026-10-23" },
        vector: [
            { serviceDate: "2026-10-01", owner: "A" },
            { serviceDate: "2026-10-02", owner: "A" },
            { serviceDate: "2026-10-06", owner: "A" },
        ],
        days: [{ sessionIndex: 1, serviceDate: "2026-10-01", submittedAt: submittedAtFor("2026-10-14"), owner: "A" }],
        dueAt: THREE_DUE_AT,
        tokenBExpiresAt: THREE_TOKEN_B_EXPIRES_AT,
    });
}

/**
 * S8e: the fixed-point shape. Every session is A's in the vector and none has a day row. A (replaced) is stored
 * [10-01, 10-14]; B (live) is stored [10-14, 10-23].
 */
function seedNoWritersAllA(): SequenceStore {
    return seedStore({
        duration: 3,
        clientStart: "2026-10-01",
        clientEnd: "2026-10-06",
        scheduleA: { startDate: "2026-10-01", endDate: "2026-10-14" },
        scheduleB: { startDate: "2026-10-14", endDate: "2026-10-23" },
        vector: [
            { serviceDate: "2026-10-01", owner: "A" },
            { serviceDate: "2026-10-02", owner: "A" },
            { serviceDate: "2026-10-06", owner: "A" },
        ],
        days: [],
        dueAt: THREE_DUE_AT,
        tokenBExpiresAt: THREE_TOKEN_B_EXPIRES_AT,
    });
}

// ---------------------------------------------------------------------------------------------
// Harness: the real editor over the real repository over the store
// ---------------------------------------------------------------------------------------------
type Internals = {
    appendRevisionWithClient: (tx: SequenceStore, input: Record<string, unknown>) => Promise<unknown>;
    createRevisionDocumentStateInTransaction: (context: unknown, input: Record<string, unknown>) => Promise<unknown>;
    allocateServiceRecordRevisionDocumentVersionInTransaction: (context: unknown, input: unknown) => Promise<number>;
    enqueueRevisionJob: (...args: unknown[]) => Promise<void>;
    enqueueRevisionOperationJob: (...args: unknown[]) => Promise<void>;
    assertCaseBelongsToBranchWithClient: (client: SequenceStore, branchId: string, caseId: string) => Promise<void>;
};

function createHarness(store: SequenceStore) {
    const repository = new ServiceRecordEditRepository(store as never);
    const internals = repository as unknown as Internals;
    const recorded = {
        documentStates: [] as Array<Record<string, unknown>>,
        revisionJobs: 0,
        operationJobs: 0,
    };

    // Raw-SQL / provider seams only. Everything that touches a case, client, day, assignment, schedule,
    // token or draft row runs for real against the store.
    jest.spyOn(internals, "appendRevisionWithClient").mockImplementation(async (tx, input) => {
        const latest = await tx.service_record_revision.findFirst({
            where: { branchId: input["branchId"], serviceRecordCaseId: input["serviceRecordCaseId"] },
            orderBy: { revisionNumber: "desc" },
            select: { revisionNumber: true },
        } as never) as { revisionNumber: number } | null;
        const created = await tx.service_record_revision.create({
            data: {
                branchId: input["branchId"],
                serviceRecordCaseId: input["serviceRecordCaseId"],
                revisionNumber: (latest?.revisionNumber ?? 0) + 1,
                confirmedByUserId: input["actorUserId"],
                payload: input["payload"],
                beforeSnapshot: input["beforeSnapshot"] ?? null,
                plannedSessions: input["plannedSessions"],
                provenance: input["provenance"],
                formVersionAtConfirm: input["formVersionAtConfirm"],
                snapshotReference: input["snapshotReference"] ?? null,
            },
        } as never) as Record<string, unknown>;
        return {
            id: created["id"],
            branchId: created["branchId"],
            serviceRecordCaseId: created["serviceRecordCaseId"],
            revisionNumber: created["revisionNumber"],
            confirmedByUserId: created["confirmedByUserId"],
            confirmedAt: created["confirmedAt"],
            payload: created["payload"],
            plannedSessions: created["plannedSessions"],
            provenance: created["provenance"],
            formVersionAtConfirm: created["formVersionAtConfirm"],
            snapshotReference: created["snapshotReference"],
        };
    });
    jest.spyOn(internals, "createRevisionDocumentStateInTransaction").mockImplementation(async (_context, input) => {
        recorded.documentStates.push(input);
        return {
            id: randomUUID(),
            generation: input["generation"],
            operation: input["operation"],
            status: input["status"] ?? "pending",
            step: input["step"],
        };
    });
    jest.spyOn(internals, "allocateServiceRecordRevisionDocumentVersionInTransaction").mockResolvedValue(1);
    jest.spyOn(internals, "enqueueRevisionJob").mockImplementation(async () => {
        recorded.revisionJobs += 1;
    });
    jest.spyOn(internals, "enqueueRevisionOperationJob").mockImplementation(async () => {
        recorded.operationJobs += 1;
    });
    // The case-ownership lock behind `startDraft` is `SELECT ... FOR UPDATE` (needs `$queryRaw`, which the
    // store deliberately lacks). Same check, answered from the store.
    // Accepted by the orchestrator as an exception to the brief's K1 list of spied methods: it replaces a
    // raw-SQL lock seam and keeps the id/branch predicate, so no case/client/day/assignment write is bypassed.
    jest.spyOn(internals, "assertCaseBelongsToBranchWithClient").mockImplementation(async (client, branchId, caseId) => {
        const owned = client.rows("service_record_case").filter((row) => row["id"] === caseId && row["branchId"] === branchId);
        if (owned.length !== 1) throw new ServiceRecordEditNotFoundError();
    });

    const editor = new AdminServiceRecordEditService(repository, createHolidayCalendarStub());
    return { editor, repository, recorded };
}
type Harness = ReturnType<typeof createHarness>;

/** start -> save -> preview. Confirm is a separate call so a test can act between preview and confirm. */
async function openEdit(
    harness: Harness,
    edit: { changes?: Record<string, unknown>; resumeReplan?: Record<string, unknown> },
) {
    const started = await harness.editor.startDraft(BRANCH_ID, CLIENT_ID, ACTOR_ID, {});
    const draft = started.draft;
    if (!draft) throw new Error("startDraft returned no draft");
    const patched = await harness.editor.updateDraft(BRANCH_ID, draft.id, ACTOR_ID, {
        expectedDraftVersion: draft.draftVersion,
        changes: edit.changes ?? {},
        ...(edit.resumeReplan ? { resumeReplan: edit.resumeReplan } : {}),
    } as never);
    if (!patched.draft) throw new Error("updateDraft returned no draft");
    const expectedDraftVersion = patched.draft.draftVersion;
    const preview = await harness.editor.previewDraft(BRANCH_ID, draft.id, ACTOR_ID, { expectedDraftVersion });
    const confirm = () => harness.editor.confirmDraft(BRANCH_ID, draft.id, ACTOR_ID, {
        expectedDraftVersion,
        previewId: preview.previewId,
        idempotencyKey: randomUUID(),
    });
    return { draftId: draft.id, expectedDraftVersion, preview, confirm };
}

// ---------------------------------------------------------------------------------------------
// Readers over the persisted state
// ---------------------------------------------------------------------------------------------
const caseRow = (store: SequenceStore) => store.one("service_record_case", { id: CASE_ID });
const clientRow = (store: SequenceStore) => store.one("client", { id: CLIENT_ID });
const tokenRow = (store: SequenceStore, key: "A" | "B") =>
    store.one("service_record_token", { scheduleId: key === "A" ? SCHEDULE_A : SCHEDULE_B });
const dayRows = (store: SequenceStore) =>
    [...store.rows("service_record_day")].sort((left, right) => (left["caseSessionIndex"] as number) - (right["caseSessionIndex"] as number));

type PlannedEntry = {
    sessionIndex: number; serviceDate: string; originalDate: string; assignmentId: string; scheduleId: number; employeeId: number;
};
const plannedOf = (store: SequenceStore) => caseRow(store)["plannedSessions"] as PlannedEntry[];

/** [startDate, endDate] of an assignment and of its schedule, as written in the store. */
function periods(store: SequenceStore) {
    const range = (row: Row) => [ymd(row["startDate"]), ymd(row["endDate"])];
    return {
        assignmentA: range(store.one("service_record_assignment", { id: A_ID })),
        scheduleA: range(store.one("employee_schedule", { id: SCHEDULE_A })),
        assignmentB: range(store.one("service_record_assignment", { id: B_ID })),
        scheduleB: range(store.one("employee_schedule", { id: SCHEDULE_B })),
    };
}

/** A's assignment and schedule rows out of a snapshot: the rows that must never move. */
const rowsOfA = (tables: ReturnType<SequenceStore["snapshot"]>) => ({
    assignment: tables["service_record_assignment"]!.find((row) => row["id"] === A_ID),
    schedule: tables["employee_schedule"]!.find((row) => row["id"] === SCHEDULE_A),
});

const writesTo = (writes: ReturnType<SequenceStore["writesSince"]>, table: string, method?: string) =>
    writes.filter((write) => write.table === table && (method === undefined || write.method === method));

function conflictCode(error: unknown): string | undefined {
    if (!(error instanceof ConflictException)) return undefined;
    return (error.getResponse() as { code?: string }).code;
}
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("expected the call to be rejected");
}

// ---------------------------------------------------------------------------------------------
// Finalization owner/writer check, through the real claim path (the check is private to the service)
// ---------------------------------------------------------------------------------------------
const REFERENCE_DATE = new Date("2026-11-30T00:00:00.000Z");

async function finalizationClaim(store: SequenceStore) {
    // Direct, documented mutation: the lifecycle would have derived READY_TO_FINALIZE once every session is
    // submitted; the claim only runs for such a case. The revision pointer is NOT set here: only a confirm sets it.
    caseRow(store)["status"] = "READY_TO_FINALIZE";
    expect(caseRow(store)["currentRevisionId"]).not.toBeNull();
    const jobService = {
        findByRequestKeyInTransaction: jest.fn().mockResolvedValue(null),
        enqueueInTransaction: jest.fn().mockResolvedValue({ existing: false, job: { requestKey: "unused" } }),
    };
    const editRepository = {
        createRevisionDocumentStateInTransaction: jest.fn().mockResolvedValue({ id: randomUUID(), documentVersion: 3 }),
        allocateServiceRecordRevisionDocumentVersionInTransaction: jest.fn().mockResolvedValue(3),
    };
    const lifecycle = { recompute: jest.fn().mockResolvedValue(undefined) };
    const service = new ServiceRecordFinalizationService(
        store as never,
        lifecycle as never,
        {} as never,
        createHolidayCalendarStub(),
        jobService as never,
        editRepository as never,
    );
    const before = store.snapshot();
    const result = await (service as unknown as {
        claimFinalizationCase: (id: string, branch: string, reference: Date) => Promise<unknown>;
    }).claimFinalizationCase(CASE_ID, BRANCH_ID, REFERENCE_DATE);
    // The generation freeze is a durable job, not a store write.
    expect(store.snapshot()).toEqual(before);
    return { result, jobService, lifecycle };
}

/** Owner and writer agree: the claim freezes the generation (blockedGeneration), one job, no lifecycle recompute. */
async function expectFinalizationMatch(store: SequenceStore) {
    const { result, jobService, lifecycle } = await finalizationClaim(store);
    expect(result).toEqual({ claimed: false, attempts: 0, blockedGeneration: true });
    expect(jobService.enqueueInTransaction).toHaveBeenCalledTimes(1);
    expect(lifecycle.recompute).not.toHaveBeenCalled();
}

/** The same final store with ONE day's schedule flipped to the other caregiver's: the claim must refuse it. */
async function expectFinalizationMismatchWhenADayIsFlipped(store: SequenceStore, sessionIndex: number) {
    const flipped = store.clone();
    const day = dayRows(flipped).find((row) => row["caseSessionIndex"] === sessionIndex)!;
    day["scheduleId"] = day["scheduleId"] === SCHEDULE_B ? SCHEDULE_A : SCHEDULE_B;
    const { result, jobService, lifecycle } = await finalizationClaim(flipped);
    expect(result).toEqual({ claimed: false, attempts: 0, blockedGeneration: true });
    expect(lifecycle.recompute).toHaveBeenCalledTimes(1);
    expect(jobService.enqueueInTransaction).not.toHaveBeenCalled();
}

/**
 * The same final store with ONE day recorded by a CONSISTENT alternate writer: both its `scheduleId` and its
 * `employeeId` (and name) become the other caregiver's, so the day names a real assignment of the case and
 * writer-existence (`assignmentsWrittenOnDay`, checked by `isCompleteFinalizationSource`) passes. The planned
 * owner stays as persisted, so only the planned-owner comparison in `currentPlannedSessionsMatchDays` can
 * refuse it. The scheduleId-only flip above is also caught by writer-existence, which hides that comparison.
 *
 * Direction: the session's planned owner is B (the later schedule, 139) and the writer is A (the earlier
 * schedule, 126). `isBackfilledBySuccessor` accepts a LATER writer on an EARLIER, replaced owner (A's
 * schedule is `replaced`, B's schedule id is greater); here the owner B is not replaced and the writer's
 * schedule id is lower, so the finalization rule rejects the day.
 */
async function expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store: SequenceStore, sessionIndex: number) {
    const planned = plannedOf(store).find((entry) => entry.sessionIndex === sessionIndex)!;
    expect(planned.scheduleId).toBe(SCHEDULE_B);
    expect(planned.employeeId).toBe(EMPLOYEE_B);
    const alternate = store.clone();
    const day = dayRows(alternate).find((row) => row["caseSessionIndex"] === sessionIndex)!;
    day["scheduleId"] = SCHEDULE_A;
    day["employeeId"] = EMPLOYEE_A;
    day["employeeNameSnapshot"] = "가상관리사갑";
    const { result, jobService, lifecycle } = await finalizationClaim(alternate);
    expect(result).toEqual({ claimed: false, attempts: 0, blockedGeneration: true });
    expect(lifecycle.recompute).toHaveBeenCalledTimes(1);
    expect(jobService.enqueueInTransaction).not.toHaveBeenCalled();
}

// ---------------------------------------------------------------------------------------------
// Steps shared by several sequences
// ---------------------------------------------------------------------------------------------
function createRealignment() {
    return new ServiceRecordScheduleRealignmentService();
}

/** Models the realignment service on its own; no client save runs it any more. */
async function realignWithSaturday(store: SequenceStore, now: string) {
    // Direct, documented mutation: the client's own flag write that triggers the realignment.
    clientRow(store)["allowSaturdayService"] = true;
    return store.$transaction((tx) => createRealignment().realignForServiceDayChangeInTransaction(tx as never, {
        branchId: BRANCH_ID,
        clientId: CLIENT_ID,
        calendar: KR_BUILTIN_CALENDAR,
        now: new Date(now),
    }));
}

/**
 * Simulates the caregiver's submissions of the sessions that have no row yet. Dates are READ from the
 * store's current vector (never re-typed), the owner is the vector's owner.
 */
function writeMissingDays(store: SequenceStore, submittedOn: (serviceDate: string) => Date = submittedAtFor) {
    const existing = new Set(dayRows(store).map((row) => row["caseSessionIndex"]));
    for (const entry of plannedOf(store)) {
        if (existing.has(entry.sessionIndex)) continue;
        const name = entry.employeeId === EMPLOYEE_A ? "가상관리사갑" : "가상관리사을";
        const submittedAt = submittedOn(entry.serviceDate);
        store.insert("service_record_day", {
            id: `dddddddd-dddd-4ddd-8ddd-${String(entry.sessionIndex).padStart(12, "0")}`,
            branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID, scheduleId: entry.scheduleId, employeeId: entry.employeeId,
            employeeNameSnapshot: name, caseSessionIndex: entry.sessionIndex, sessionIndex: entry.sessionIndex,
            formVersion: 3, serviceDate: date(entry.serviceDate), answers: { bath: "실시" }, notes: `메모 ${entry.sessionIndex}`,
            paymentConfirmed: true, momApproval: "approved", clientSignature: `signature-${entry.sessionIndex}`,
            clientSignedAt: new Date(submittedAt.getTime() - 60_000), locked: true, submittedAt,
        });
    }
}

/** S1 up to its final store (resume + header confirm), without assertions: the starting point of S4. */
async function goldenIncidentFinalStore(): Promise<SequenceStore> {
    const store = seedGoldenIncident();
    const harness = createHarness(store);
    const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14", incomingAssignmentId: B_ID } });
    await resume.confirm();
    const header = await openEdit(harness, { changes: { header: { momName: "가상산모(수정)" } } });
    await header.confirm();
    return store;
}

/**
 * The invariant of a resume: whatever it wrote, an immediately following header-only confirm on the reloaded
 * record has nothing left to move. Its preview lists no boundary, it writes no assignment and no schedule row,
 * and the persisted periods are exactly the ones the resume left.
 */
async function expectHeaderConfirmMovesNoPeriod(harness: Harness, store: SequenceStore) {
    const periodsBefore = periods(store);
    const header = await openEdit(harness, { changes: { header: { momName: "가상산모(수정)" } } });
    expect(header.preview.blockingReasons).toEqual([]);
    expect(header.preview.contentChanges.headerChanged).toBe(true);
    const mark = store.mark();
    expect((await header.confirm()).status).toBe("confirmed");
    const headerWrites = store.writesSince(mark);
    expect(writesTo(headerWrites, "service_record_assignment")).toEqual([]);
    expect(writesTo(headerWrites, "employee_schedule")).toEqual([]);
    expect(periods(store)).toEqual(periodsBefore);
}

// ---------------------------------------------------------------------------------------------
describe("service-record correction sequences (real services over one persisted store)", () => {
    beforeEach(() => {
        pinToday(SPEC_NOW);
        jest.restoreAllMocks();
    });
    afterEach(() => {
        unpinToday();
    });

    describe("S1 golden incident (가상산모)", () => {
        it("resume from 2 on 10-14 with B, then a header-only confirm, then the finalization owner/writer match", async () => {
            const store = seedGoldenIncident();
            const harness = createHarness(store);

            // --- Step 1: resume from session 2 on 10-14 with B, preview and confirm.
            const resume = await openEdit(harness, {
                resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14", incomingAssignmentId: B_ID },
            });
            expect(resume.preview.blockingReasons).toEqual([]);
            expect((resume.preview as { warnings?: unknown[] }).warnings).toEqual([]);
            expect(resume.preview.after.sessions.map(({ serviceDate }) => serviceDate)).toEqual(NEW_DATES);

            const versionBefore = caseRow(store)["version"] as number;
            const mark = store.mark();
            const confirmed = await resume.confirm();
            expect(confirmed.status).toBe("confirmed");
            const writes = store.writesSince(mark);

            // Persisted vector: new dates, the old ones kept as originalDate, owners 1 -> A, 2..15 -> B.
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(NEW_DATES);
            expect(plannedOf(store).map((entry) => entry.originalDate)).toEqual(OLD_DATES);
            expect(plannedOf(store).map((entry) => entry.assignmentId)).toEqual([A_ID, ...Array<string>(14).fill(B_ID)]);
            // Day rows: only the date moved; submission, lock and content are as seeded.
            expect(dayRows(store).map((row) => ymd(row["serviceDate"]))).toEqual(NEW_DATES);
            for (const [offset, row] of dayRows(store).entries()) {
                expect(row["locked"]).toBe(true);
                expect(row["notes"]).toBe(`메모 ${offset + 1}`);
                expect(instantOf(row["submittedAt"])).toBe(submittedAtFor(NEW_DATES[offset]!).toISOString());
                expect(row["scheduleId"]).toBe(offset === 0 ? SCHEDULE_A : SCHEDULE_B);
            }
            // Boundary, in both tables: A ends where it served (10-01), B runs to the new last date.
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-01"],
                scheduleA: ["2026-10-01", "2026-10-01"],
                assignmentB: ["2026-10-14", "2026-11-02"],
                scheduleB: ["2026-10-14", "2026-11-02"],
            });
            // Case, client, due time, link expiry. Due: 11-02 20:00 KST = 11:00Z. Link: midnight KST after 11-02 = 11-02T15:00Z.
            expect(ymd(caseRow(store)["endDate"])).toBe("2026-11-02");
            expect(ymd(clientRow(store)["endDate"])).toBe("2026-11-02");
            expect(instantOf(caseRow(store)["finalizationDueAt"])).toBe("2026-11-02T11:00:00.000Z");
            expect(instantOf(tokenRow(store, "B")["expiresAt"])).toBe("2026-11-02T15:00:00.000Z");
            expect(instantOf(tokenRow(store, "A")["expiresAt"])).toBe("2026-10-14T15:00:00.000Z");
            expect(tokenRow(store, "A")["active"]).toBe(false);
            // Version, revision pointer and draft.
            expect(caseRow(store)["version"]).toBe(versionBefore + 1);
            const revisions = store.rows("service_record_revision");
            expect(revisions).toHaveLength(1);
            expect(revisions[0]!["revisionNumber"]).toBe(1);
            expect(caseRow(store)["currentRevisionId"]).toBe(revisions[0]!["id"]);
            expect(store.one("service_record_edit_draft", { id: resume.draftId })["status"]).toBe("CONFIRMED");

            // The writes the confirm made, from the call log: nothing was skipped.
            expect(writesTo(writes, "service_record_revision", "create")).toHaveLength(1);
            expect(writesTo(writes, "service_record_case", "update")).toHaveLength(1);
            expect(writesTo(writes, "client", "updateMany")).toHaveLength(1);
            expect(writesTo(writes, "service_record_day", "updateMany")).toHaveLength(15);
            expect(writesTo(writes, "service_record_assignment", "updateMany").map((write) => (write.where as Row)["id"]).sort())
                .toEqual([A_ID, B_ID]);
            expect(writesTo(writes, "employee_schedule", "updateMany").map((write) => (write.where as Row)["id"]).sort())
                .toEqual([SCHEDULE_A, SCHEDULE_B]);
            expect(writesTo(writes, "service_record_token", "updateMany")).toHaveLength(1);
            expect(writesTo(writes, "service_record_token", "updateMany")[0]!.count).toBe(1);
            expect(writesTo(writes, "service_record_edit_draft", "updateMany")).toHaveLength(1);

            // --- Step 2: reload; a header-only edit previews and confirms with NO boundary change.
            const afterResume = store.snapshot();
            const header = await openEdit(harness, { changes: { header: { momName: "가상산모(수정)" } } });
            expect(header.preview.blockingReasons).toEqual([]);
            expect(header.preview.contentChanges.headerChanged).toBe(true);
            // Nothing in the reloaded state asks for a boundary move.
            expect((header.preview as { assignmentPeriods?: unknown[] }).assignmentPeriods ?? []).toEqual([]);
            const headerMark = store.mark();
            const headerConfirmed = await header.confirm();
            expect(headerConfirmed.status).toBe("confirmed");
            const headerWrites = store.writesSince(headerMark);
            expect(writesTo(headerWrites, "service_record_assignment")).toEqual([]);
            expect(writesTo(headerWrites, "employee_schedule")).toEqual([]);
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-01"],
                scheduleA: ["2026-10-01", "2026-10-01"],
                assignmentB: ["2026-10-14", "2026-11-02"],
                scheduleB: ["2026-10-14", "2026-11-02"],
            });
            expect(caseRow(store)["momName"]).toBe("가상산모(수정)");
            expect(caseRow(store)["version"]).toBe(versionBefore + 2);
            expect(store.rows("service_record_revision")).toHaveLength(2);
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(NEW_DATES);
            expect(dayRows(store).map((row) => ymd(row["serviceDate"]))).toEqual(NEW_DATES);
            expect(afterResume).not.toEqual(store.snapshot());

            // --- Step 3: finalization eligibility: every day is written by the owner the vector names.
            await expectFinalizationMatch(store);
            await expectFinalizationMismatchWhenADayIsFlipped(store, 5);
            await expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store, 5);
        });
    });

    describe("S2 resume-day handover (B has written nothing yet)", () => {
        it("resume -> header confirm -> Saturday realignment -> finalization match, A never moving", async () => {
            const store = seedResumeDay();
            const harness = createHarness(store);

            // --- Step 1: resume from 2 on 10-14 with the automatic successor (B, the one live caregiver after the replaced A).
            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" } });
            expect(resume.preview.blockingReasons).toEqual([]);
            expect((resume.preview as { warnings?: unknown[] }).warnings).toEqual([]);
            expect((await resume.confirm()).status).toBe("confirmed");
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(NEW_DATES);
            // The vector hands 2..15 to B; the one written row is still A's, untouched.
            expect(plannedOf(store).map((entry) => entry.assignmentId)).toEqual([A_ID, ...Array<string>(14).fill(B_ID)]);
            expect(plannedOf(store).map((entry) => entry.scheduleId)).toEqual([SCHEDULE_A, ...Array<number>(14).fill(SCHEDULE_B)]);
            expect(dayRows(store)).toHaveLength(1);
            expect(dayRows(store)[0]!["scheduleId"]).toBe(SCHEDULE_A);
            expect(ymd(dayRows(store)[0]!["serviceDate"])).toBe("2026-10-01");
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-01"],
                scheduleA: ["2026-10-01", "2026-10-01"],
                assignmentB: ["2026-10-14", "2026-11-02"],
                scheduleB: ["2026-10-14", "2026-11-02"],
            });
            expect(instantOf(caseRow(store)["finalizationDueAt"])).toBe("2026-11-02T11:00:00.000Z");
            expect(instantOf(tokenRow(store, "B")["expiresAt"])).toBe("2026-11-02T15:00:00.000Z");

            // --- Step 2: header-only confirm on the reloaded state.
            const header = await openEdit(harness, { changes: { header: { momName: "가상산모(수정)" } } });
            expect(header.preview.blockingReasons).toEqual([]);
            const headerMark = store.mark();
            expect((await header.confirm()).status).toBe("confirmed");
            expect(writesTo(store.writesSince(headerMark), "service_record_assignment")).toEqual([]);
            expect(writesTo(store.writesSince(headerMark), "employee_schedule")).toEqual([]);

            // --- Step 3: the client now takes Saturdays; the realignment runs at 2026-10-14 00:00 KST.
            // Session 1 is written, so the split is after it; lowerBound = max(10-02, today 10-14) = Wed 10-14.
            // Saturday is a service day, Sunday is not: Wed 10-14, Thu 10-15, Fri 10-16, Sat 10-17, [Sun 10-18],
            // Mon 10-19, Tue 10-20, Wed 10-21, Thu 10-22, Fri 10-23, Sat 10-24, [Sun 10-25], Mon 10-26, Tue 10-27,
            // Wed 10-28, Thu 10-29 = 4 + 6 + 4 = 14 sessions (2..15). Last date Thu 10-29.
            const SATURDAY_DATES = [
                "2026-10-01",
                "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-19", "2026-10-20", "2026-10-21",
                "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29",
            ];
            const aBefore = rowsOfA(store.snapshot());
            const realignMark = store.mark();
            const realigned = await realignWithSaturday(store, "2026-10-13T15:00:00.000Z");
            expect(realigned).toMatchObject({ changed: true, mode: "planned", endDate: "2026-10-29" });
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(SATURDAY_DATES);
            expect(plannedOf(store).map((entry) => entry.originalDate)).toEqual(OLD_DATES);
            // A never moved; B takes the vector end.
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-01"],
                scheduleA: ["2026-10-01", "2026-10-01"],
                assignmentB: ["2026-10-14", "2026-10-29"],
                scheduleB: ["2026-10-14", "2026-10-29"],
            });
            expect(rowsOfA(store.snapshot())).toEqual(aBefore);
            const realignWrites = store.writesSince(realignMark);
            expect(writesTo(realignWrites, "service_record_assignment", "updateMany").map((write) => (write.where as Row)["id"])).toEqual([B_ID]);
            expect(writesTo(realignWrites, "employee_schedule", "updateMany").map((write) => (write.where as Row)["id"])).toEqual([SCHEDULE_B]);
            expect(ymd(caseRow(store)["endDate"])).toBe("2026-10-29");
            expect(ymd(clientRow(store)["endDate"])).toBe("2026-10-29");
            // The realignment rewrites the active link unconditionally: midnight KST after 10-29 = 10-29T15:00Z.
            expect(instantOf(tokenRow(store, "B")["expiresAt"])).toBe("2026-10-29T15:00:00.000Z");

            // --- Step 4: B submits sessions 2..15 on the dates the store now holds.
            writeMissingDays(store);
            expect(dayRows(store)).toHaveLength(15);

            // --- Step 5: reload the editor on the final state; a header edit still previews and confirms cleanly.
            const reload = await openEdit(harness, { changes: { header: { momName: "가상산모(재수정)" } } });
            expect(reload.preview.blockingReasons).toEqual([]);
            const reloadMark = store.mark();
            expect((await reload.confirm()).status).toBe("confirmed");
            expect(writesTo(store.writesSince(reloadMark), "service_record_assignment")).toEqual([]);
            expect(writesTo(store.writesSince(reloadMark), "employee_schedule")).toEqual([]);
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(SATURDAY_DATES);

            // --- Step 6: finalization eligibility on the final store.
            await expectFinalizationMatch(store);
            await expectFinalizationMismatchWhenADayIsFlipped(store, 9);
            await expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store, 9);
        });
    });

    describe("S3 three-회차 correction from session 1, then a second resume whose whole prefix is historical", () => {
        it("from-1 resume -> second resume -> header confirm -> Saturday realignment -> finalization match, A staying 10-01..10-01", async () => {
            const store = seedThreeSessions();
            const harness = createHarness(store);

            // --- Step 1: resume from session 1 on Wed 10-14. Sessions: Wed 10-14, Thu 10-15, Fri 10-16 (A, B, B).
            // A's session 1 moves to 10-14, far outside A's stored [10-01, 10-01]: that row is A's historical slot.
            // A keeps [10-01, 10-01]; B starts on its first OWNED session (10-15) and ends on the last date (10-16).
            const first = await openEdit(harness, { resumeReplan: { fromSessionIndex: 1, resumeDate: "2026-10-14" } });
            expect(first.preview.blockingReasons).toEqual([]);
            expect((first.preview as { assignmentPeriods?: unknown[] }).assignmentPeriods).toEqual([
                { assignmentId: B_ID, employeeName: "가상관리사을", before: { startDate: "2026-10-02", endDate: "2026-10-06" }, after: { startDate: "2026-10-15", endDate: "2026-10-16" } },
            ]);
            expect((await first.confirm()).status).toBe("confirmed");
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
            expect(plannedOf(store).map((entry) => entry.assignmentId)).toEqual([A_ID, B_ID, B_ID]);
            expect(plannedOf(store).map((entry) => entry.originalDate)).toEqual(["2026-10-01", "2026-10-02", "2026-10-06"]);
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-01"],
                scheduleA: ["2026-10-01", "2026-10-01"],
                assignmentB: ["2026-10-15", "2026-10-16"],
                scheduleB: ["2026-10-15", "2026-10-16"],
            });
            // A's written row follows the vector to 10-14; it stays A's row and stays locked.
            expect(dayRows(store).map((row) => [ymd(row["serviceDate"]), row["scheduleId"], row["locked"]])).toEqual([["2026-10-14", SCHEDULE_A, true]]);
            expect(ymd(caseRow(store)["endDate"])).toBe("2026-10-16");
            expect(instantOf(caseRow(store)["finalizationDueAt"])).toBe("2026-10-16T11:00:00.000Z");
            expect(instantOf(tokenRow(store, "B")["expiresAt"])).toBe("2026-10-16T15:00:00.000Z");

            // --- Step 2: resume again from session 2 on Tue 10-20. The whole kept prefix (session 1) is A's
            // historical slot, so A is not the outgoing caregiver and is not extended; B, the only caregiver bearing
            // a period, takes sessions 2..3 on Tue 10-20 and Wed 10-21 and starts on its first owned session.
            const second = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-20" } });
            expect(second.preview.blockingReasons).toEqual([]);
            expect((await second.confirm()).status).toBe("confirmed");
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(["2026-10-14", "2026-10-20", "2026-10-21"]);
            expect(plannedOf(store).map((entry) => entry.assignmentId)).toEqual([A_ID, B_ID, B_ID]);
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-01"],
                scheduleA: ["2026-10-01", "2026-10-01"],
                assignmentB: ["2026-10-20", "2026-10-21"],
                scheduleB: ["2026-10-20", "2026-10-21"],
            });
            expect(ymd(caseRow(store)["endDate"])).toBe("2026-10-21");
            expect(instantOf(tokenRow(store, "B")["expiresAt"])).toBe("2026-10-21T15:00:00.000Z");

            // --- Step 3: header-only confirm on the reloaded state: no boundary moves (A's row on 10-14 is not a period).
            const header = await openEdit(harness, { changes: { header: { momName: "가상산모(수정)" } } });
            expect(header.preview.blockingReasons).toEqual([]);
            const headerMark = store.mark();
            expect((await header.confirm()).status).toBe("confirmed");
            expect(writesTo(store.writesSince(headerMark), "service_record_assignment")).toEqual([]);
            expect(writesTo(store.writesSince(headerMark), "employee_schedule")).toEqual([]);
            expect(periods(store).assignmentA).toEqual(["2026-10-01", "2026-10-01"]);
            expect(periods(store).assignmentB).toEqual(["2026-10-20", "2026-10-21"]);

            // --- Step 4: Saturday realignment at Oct 17 KST stays outside the stored weekday pause.
            // Oct 15, 16 and 19 lie between the fixed Oct 14 and resumed Oct 20. The old oracle
            // erased that pause by moving B to Oct 17/19; the pause invariant keeps Oct 20/21.
            const aBefore = rowsOfA(store.snapshot());
            const realignMark = store.mark();
            const realigned = await realignWithSaturday(store, "2026-10-16T15:00:00.000Z");
            expect(realigned).toMatchObject({ changed: false, mode: "planned", endDate: null });
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(["2026-10-14", "2026-10-20", "2026-10-21"]);
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-01"],
                scheduleA: ["2026-10-01", "2026-10-01"],
                assignmentB: ["2026-10-20", "2026-10-21"],
                scheduleB: ["2026-10-20", "2026-10-21"],
            });
            expect(rowsOfA(store.snapshot())).toEqual(aBefore);
            const realignWrites = store.writesSince(realignMark);
            expect(writesTo(realignWrites, "service_record_assignment")).toEqual([]);
            expect(writesTo(realignWrites, "employee_schedule")).toEqual([]);
            expect(ymd(caseRow(store)["endDate"])).toBe("2026-10-21");
            expect(ymd(clientRow(store)["endDate"])).toBe("2026-10-21");
            expect(instantOf(tokenRow(store, "B")["expiresAt"])).toBe("2026-10-21T15:00:00.000Z");

            // --- Step 5: B submits sessions 2..3 on the dates now in the store; the owner/writer match holds.
            writeMissingDays(store);
            await expectFinalizationMatch(store);
            await expectFinalizationMismatchWhenADayIsFlipped(store, 2);
            await expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store, 2);
        });
    });

    it("resumes after a pause, moves within that segment on Saturday, and finalizes the same dates", async () => {
        // Wed 14 is written. Thu 15 is a pause. Fri 16 -> Mon 19 spans only a weekend.
        const store = seedStore({
            duration: 3, clientStart: "2026-10-14", clientEnd: "2026-10-16",
            scheduleA: { startDate: "2026-10-14", endDate: "2026-10-14" },
            scheduleB: { startDate: "2026-10-15", endDate: "2026-10-16" },
            vector: [
                { serviceDate: "2026-10-14", owner: "A" },
                { serviceDate: "2026-10-15", owner: "B" },
                { serviceDate: "2026-10-16", owner: "B" },
            ],
            days: [{ sessionIndex: 1, serviceDate: "2026-10-14", submittedAt: submittedAtFor("2026-10-14"), owner: "A" }],
            dueAt: "2026-10-16T11:00:00.000Z", tokenBExpiresAt: "2026-10-16T15:00:00.000Z",
        });
        const harness = createHarness(store);
        const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-16" } });
        expect(resume.preview.blockingReasons).toEqual([]);
        expect((await resume.confirm()).status).toBe("confirmed");
        expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(["2026-10-14", "2026-10-16", "2026-10-19"]);

        const aBefore = rowsOfA(store.snapshot());
        const mark = store.mark();
        const result = await realignWithSaturday(store, "2026-10-14T15:00:00Z"); // Exactly Oct 15 00:00 KST.

        expect(result).toMatchObject({ changed: true, mode: "planned", endDate: "2026-10-17" });
        expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(["2026-10-14", "2026-10-16", "2026-10-17"]);
        expect(periods(store)).toEqual({
            assignmentA: ["2026-10-14", "2026-10-14"], scheduleA: ["2026-10-14", "2026-10-14"],
            assignmentB: ["2026-10-16", "2026-10-17"], scheduleB: ["2026-10-16", "2026-10-17"],
        });
        expect(rowsOfA(store.snapshot())).toEqual(aBefore);
        const writes = store.writesSince(mark);
        expect(writesTo(writes, "service_record_assignment", "updateMany").map((write) => [write.where, write.data])).toEqual([
            [{ id: B_ID, branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID }, { startDate: date("2026-10-16"), endDate: date("2026-10-17") }],
        ]);
        expect(writesTo(writes, "employee_schedule", "updateMany").map((write) => [write.where, write.data])).toEqual([
            [{ id: SCHEDULE_B, branchId: BRANCH_ID }, { startDate: date("2026-10-16"), endDate: date("2026-10-17") }],
        ]);
        expect(ymd(caseRow(store)["endDate"])).toBe("2026-10-17");
        expect(ymd(clientRow(store)["endDate"])).toBe("2026-10-17");
        expect(instantOf(tokenRow(store, "B")["expiresAt"])).toBe("2026-10-17T15:00:00.000Z");

        writeMissingDays(store);
        expect(dayRows(store).map((row) => ymd(row["serviceDate"]))).toEqual(["2026-10-14", "2026-10-16", "2026-10-17"]);
        await expectFinalizationMatch(store);
        await expectFinalizationMismatchWhenADayIsFlipped(store, 3);
        await expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store, 3);
    });

    describe("S8 a resume writes exactly the periods the next confirm would compute", () => {
        // Every sequence: resume confirm -> reload -> header-only confirm (no assignment / schedule write) ->
        // finalization claim. Calendar for all of them: Wed 10-14, Thu 10-15, Fri 10-16 are the three consecutive
        // business days from the resume date.

        it("(a) a historical writer's kept tail slot does not stretch the incoming end (from 1, B incoming)", async () => {
            const store = seedHistoricalTail();
            const harness = createHarness(store);

            // Resume from 1 on 10-14: sessions 10-14, 10-15, 10-16. B (the live successor of the replaced A) takes
            // sessions 1 and 2. Session 3 stays A's (A wrote that row); on 10-16 it is outside A's [10-01, 10-14],
            // so it is A's historical slot and A bears no period. B therefore ends on its own last session, 10-15,
            // never on A's kept tail slot (10-16).
            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 1, resumeDate: "2026-10-14" } });
            expect(resume.preview.blockingReasons).toEqual([]);
            expect((resume.preview as { assignmentPeriods?: unknown[] }).assignmentPeriods).toEqual([
                { assignmentId: B_ID, employeeName: "가상관리사을", before: { startDate: "2026-10-14", endDate: "2026-10-23" }, after: { startDate: "2026-10-14", endDate: "2026-10-15" } },
            ]);
            expect((await resume.confirm()).status).toBe("confirmed");
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
            expect(plannedOf(store).map((entry) => entry.assignmentId)).toEqual([B_ID, B_ID, A_ID]);
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-14"],
                scheduleA: ["2026-10-01", "2026-10-14"],
                assignmentB: ["2026-10-14", "2026-10-15"],
                scheduleB: ["2026-10-14", "2026-10-15"],
            });

            await expectHeaderConfirmMovesNoPeriod(harness, store);
            expect(periods(store).assignmentB).toEqual(["2026-10-14", "2026-10-15"]);
            expect(periods(store).assignmentA).toEqual(["2026-10-01", "2026-10-14"]);

            // B submits sessions 1 and 2 on the dates now stored; A's row for session 3 is the one it wrote.
            writeMissingDays(store);
            await expectFinalizationMatch(store);
            await expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store, 1);
        });

        it("(b) a plain pause: the continuing caregiver ends on its own last slot, before a historical writer's tail", async () => {
            const store = seedPlainPauseWithHistoricalTail();
            const harness = createHarness(store);

            // Resume from 2 on 10-14: session 2 -> Wed 10-14, session 3 -> Thu 10-15. B (live) wrote session 1
            // and owns session 2, so it continues (outgoing == incoming, no handover). Session 3 stays A's row; on
            // 10-15 it is outside A's [10-01, 10-01], a historical slot. B ends on its own last session, 10-14.
            // B keeps its start 10-01 (its first session). A, historical-only, keeps [10-01, 10-01].
            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" } });
            expect(resume.preview.blockingReasons).toEqual([]);
            expect((resume.preview as { assignmentPeriods?: unknown[] }).assignmentPeriods).toEqual([
                { assignmentId: B_ID, employeeName: "가상관리사을", before: { startDate: "2026-10-01", endDate: "2026-10-06" }, after: { startDate: "2026-10-01", endDate: "2026-10-14" } },
            ]);
            expect((await resume.confirm()).status).toBe("confirmed");
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(["2026-10-01", "2026-10-14", "2026-10-15"]);
            expect(plannedOf(store).map((entry) => entry.assignmentId)).toEqual([B_ID, B_ID, A_ID]);
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-01"],
                scheduleA: ["2026-10-01", "2026-10-01"],
                assignmentB: ["2026-10-01", "2026-10-14"],
                scheduleB: ["2026-10-01", "2026-10-14"],
            });

            await expectHeaderConfirmMovesNoPeriod(harness, store);

            writeMissingDays(store);
            await expectFinalizationMatch(store);
            await expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store, 2);
        });

        it("(c) three caregivers from 2: outgoing Z ends where it served, B starts and ends on its own sessions", async () => {
            const store = seedOutgoingHistoricalTailIncoming();
            const harness = createHarness(store);

            // Resume from 2 on 10-14 with B named: session 2 -> 10-14, session 3 -> 10-15. Z served session 1 (10-01,
            // inside its [10-01, 10-01]) and is the outgoing caregiver: it keeps [10-01, 10-01]. Session 2 goes to B.
            // Session 3 stays A's row; on 10-15 it is outside A's [10-02, 10-02], so A is historical-only and keeps
            // its dates. B starts on its first session (10-14) and ends on its own last one (10-14), not on A's 10-15.
            const resume = await openEdit(harness, {
                resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14", incomingAssignmentId: B_ID },
            });
            expect(resume.preview.blockingReasons).toEqual([]);
            // Z is listed as the outgoing boundary although its dates do not move; A, historical-only, is not listed.
            expect((resume.preview as { assignmentPeriods?: unknown[] }).assignmentPeriods).toEqual([
                { assignmentId: Z_ID, employeeName: "박지수", before: { startDate: "2026-10-01", endDate: "2026-10-01" }, after: { startDate: "2026-10-01", endDate: "2026-10-01" } },
                { assignmentId: B_ID, employeeName: "가상관리사을", before: { startDate: "2026-10-14", endDate: "2026-10-23" }, after: { startDate: "2026-10-14", endDate: "2026-10-14" } },
            ]);
            expect((await resume.confirm()).status).toBe("confirmed");
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(["2026-10-01", "2026-10-14", "2026-10-15"]);
            expect(plannedOf(store).map((entry) => entry.assignmentId)).toEqual([Z_ID, B_ID, A_ID]);
            const range = (id: string, scheduleId: number) => ({
                assignment: store.one("service_record_assignment", { id }), schedule: store.one("employee_schedule", { id: scheduleId }),
            });
            for (const [id, scheduleId, expected] of [
                [Z_ID, SCHEDULE_Z, ["2026-10-01", "2026-10-01"]],
                [A_ID, SCHEDULE_A, ["2026-10-02", "2026-10-02"]],
                [B_ID, SCHEDULE_B, ["2026-10-14", "2026-10-14"]],
            ] as const) {
                const rows = range(id, scheduleId);
                expect([ymd(rows.assignment["startDate"]), ymd(rows.assignment["endDate"])]).toEqual(expected);
                expect([ymd(rows.schedule["startDate"]), ymd(rows.schedule["endDate"])]).toEqual(expected);
            }

            const headerPeriods = () => ["service_record_assignment", "employee_schedule"].map((table) => store.snapshot()[table]);
            const before = headerPeriods();
            const header = await openEdit(harness, { changes: { header: { momName: "가상산모(수정)" } } });
            expect(header.preview.blockingReasons).toEqual([]);
            const mark = store.mark();
            expect((await header.confirm()).status).toBe("confirmed");
            expect(writesTo(store.writesSince(mark), "service_record_assignment")).toEqual([]);
            expect(writesTo(store.writesSince(mark), "employee_schedule")).toEqual([]);
            expect(headerPeriods()).toEqual(before);

            writeMissingDays(store);
            await expectFinalizationMatch(store);
            await expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store, 2);
        });

        it("(d) the resume-day shape from 1: the replaced A's period follows its own session at once, in the preview too", async () => {
            const store = seedResumeDayThreeSessions();
            const harness = createHarness(store);

            // Resume from 1 on 10-14: sessions 10-14, 10-15, 10-16. A (replaced) keeps session 1, which it wrote:
            // that row is now dated 10-14, inside A's [10-01, 10-14], so it is A's only period-bearing session
            // and A's period is [10-14, 10-14] (the outer-edge rule the next confirm applies to the head). B takes
            // sessions 2 and 3 and starts on its first owned session (10-15), ending on the last date (10-16).
            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 1, resumeDate: "2026-10-14" } });
            expect(resume.preview.blockingReasons).toEqual([]);
            expect((resume.preview as { warnings?: unknown[] }).warnings).toEqual([]);
            expect((resume.preview as { assignmentPeriods?: unknown[] }).assignmentPeriods).toEqual([
                { assignmentId: A_ID, employeeName: "가상관리사갑", before: { startDate: "2026-10-01", endDate: "2026-10-14" }, after: { startDate: "2026-10-14", endDate: "2026-10-14" } },
                { assignmentId: B_ID, employeeName: "가상관리사을", before: { startDate: "2026-10-14", endDate: "2026-10-23" }, after: { startDate: "2026-10-15", endDate: "2026-10-16" } },
            ]);
            expect((await resume.confirm()).status).toBe("confirmed");
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
            expect(plannedOf(store).map((entry) => entry.assignmentId)).toEqual([A_ID, B_ID, B_ID]);
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-14", "2026-10-14"],
                scheduleA: ["2026-10-14", "2026-10-14"],
                assignmentB: ["2026-10-15", "2026-10-16"],
                scheduleB: ["2026-10-15", "2026-10-16"],
            });

            await expectHeaderConfirmMovesNoPeriod(harness, store);

            writeMissingDays(store);
            await expectFinalizationMatch(store);
            await expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store, 2);
        });

        it("(e) the settle reaches a fixed point: a second pass would flip head and tail, so the resume writes the settled periods", async () => {
            const store = seedNoWritersAllA();
            const harness = createHarness(store);

            // Resume from 1 on 10-07: sessions Wed 10-07, Thu 10-08, Mon 10-12 (Fri 10-09 is Hangul Day). B takes
            // all three; no session has a writer, so A bears no session and B owns every one.
            // The plan writes B [10-07, 10-12] (its first and last session). A owns no session, so the plan leaves
            // it at its stored [10-01, 10-14]. The first settle pass moves A's start onto the head (10-07) and
            // leaves A [10-07, 10-14]. That reorders the stored periods by (start, end): B [10-07, 10-12] now sorts
            // before A [10-07, 10-14], so the tail the next confirm picks is A, not B: it ends A on the last
            // session date, 10-12. A second settle pass writes exactly that, A [10-07, 10-12], and a third moves
            // nothing. A single pass would have written A [10-07, 10-14], which a header-only confirm then moves.
            // Expected: A [10-07, 10-12] and B [10-07, 10-12] in both tables.
            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 1, resumeDate: "2026-10-07" } });
            expect(resume.preview.blockingReasons).toEqual([]);
            expect(resume.preview.after.sessions.map(({ serviceDate }) => serviceDate)).toEqual(["2026-10-07", "2026-10-08", "2026-10-12"]);
            expect((await resume.confirm()).status).toBe("confirmed");
            expect(plannedOf(store).map((entry) => entry.assignmentId)).toEqual([B_ID, B_ID, B_ID]);
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-07", "2026-10-12"],
                scheduleA: ["2026-10-07", "2026-10-12"],
                assignmentB: ["2026-10-07", "2026-10-12"],
                scheduleB: ["2026-10-07", "2026-10-12"],
            });

            await expectHeaderConfirmMovesNoPeriod(harness, store);

            writeMissingDays(store);
            await expectFinalizationMatch(store);
            await expectFinalizationMismatchWhenAConsistentAlternateWriterIsRecorded(store, 1);
        });
    });

    describe("S4 boundary-only and link-only confirms on a corrected record", () => {
        it("(a) a boundary-only difference is a real confirm, not no_changes", async () => {
            const store = (await goldenIncidentFinalStore()).clone();
            // Documented direct mutation: A's end falls back to the pre-correction 10-14 in BOTH tables.
            store.one("service_record_assignment", { id: A_ID })["endDate"] = date("2026-10-14");
            store.one("employee_schedule", { id: SCHEDULE_A })["endDate"] = date("2026-10-14");
            const harness = createHarness(store);
            const before = store.snapshot();
            const versionBefore = caseRow(store)["version"] as number;
            const revisionsBefore = store.rows("service_record_revision").length;

            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" } });
            expect(resume.preview.blockingReasons).toEqual([]);
            const mark = store.mark();
            const confirmed = await resume.confirm();
            expect(confirmed.status).toBe("confirmed");
            expect(confirmed.revisionId).not.toBeNull();
            expect(caseRow(store)["version"]).toBe(versionBefore + 1);
            expect(store.rows("service_record_revision")).toHaveLength(revisionsBefore + 1);
            // Only A's boundary changed.
            expect(periods(store)).toEqual({
                assignmentA: ["2026-10-01", "2026-10-01"],
                scheduleA: ["2026-10-01", "2026-10-01"],
                assignmentB: ["2026-10-14", "2026-11-02"],
                scheduleB: ["2026-10-14", "2026-11-02"],
            });
            const writes = store.writesSince(mark);
            expect(writesTo(writes, "service_record_assignment", "updateMany").map((write) => (write.where as Row)["id"])).toEqual([A_ID]);
            expect(writesTo(writes, "employee_schedule", "updateMany").map((write) => (write.where as Row)["id"])).toEqual([SCHEDULE_A]);
            // Dates, owners and tokens are exactly as before.
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(NEW_DATES);
            expect(dayRows(store).map((row) => ymd(row["serviceDate"]))).toEqual(NEW_DATES);
            expect(store.snapshot()["service_record_token"]).toEqual(before["service_record_token"]);
            expect(instantOf(tokenRow(store, "B")["expiresAt"])).toBe("2026-11-02T15:00:00.000Z");
        });

        it("(b) a link-only difference raises the link and closes the draft without a revision", async () => {
            const store = (await goldenIncidentFinalStore()).clone();
            // Documented direct mutation: B's active link expires on the pre-correction 10-23 (10-24 00:00 KST).
            tokenRow(store, "B")["expiresAt"] = new Date("2026-10-23T15:00:00.000Z");
            const harness = createHarness(store);
            const versionBefore = caseRow(store)["version"] as number;
            const revisionsBefore = store.rows("service_record_revision").length;
            const before = store.snapshot();

            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" } });
            expect(resume.preview.blockingReasons).toEqual([]);
            const mark = store.mark();
            const confirmed = await resume.confirm();
            expect(confirmed.status).toBe("no_changes");
            expect(confirmed.revisionId).toBeNull();
            expect(caseRow(store)["version"]).toBe(versionBefore);
            expect(store.snapshot()["service_record_case"]).toEqual(before["service_record_case"]);
            expect(store.rows("service_record_revision")).toHaveLength(revisionsBefore);
            expect(store.one("service_record_edit_draft", { id: resume.draftId })["status"]).toBe("CONFIRMED");
            // B's link is raised to midnight KST after 11-02; A's revoked link is untouched.
            expect(instantOf(tokenRow(store, "B")["expiresAt"])).toBe("2026-11-02T15:00:00.000Z");
            expect(store.snapshot()["service_record_token"]!.find((row) => row["scheduleId"] === SCHEDULE_A))
                .toEqual(before["service_record_token"]!.find((row) => row["scheduleId"] === SCHEDULE_A));
            // The only writes: the link and the draft.
            const writes = store.writesSince(mark);
            expect(writes.map((write) => [write.table, write.method])).toEqual([
                ["service_record_token", "updateMany"],
                ["service_record_edit_draft", "updateMany"],
            ]);
            expect(writes[0]!.count).toBe(1);
        });
    });

    describe("S5 a stale preview is rejected and writes nothing", () => {
        it("(a) a case version bump after the preview -> REQUEST_STALE, store unchanged", async () => {
            const store = seedGoldenIncident();
            const harness = createHarness(store);
            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" } });
            // Documented direct mutation: another writer bumped the case version after the preview.
            caseRow(store)["version"] = (caseRow(store)["version"] as number) + 1;
            const snapshot = store.snapshot();
            const mark = store.mark();

            const error = await rejectionOf(resume.confirm());
            expect(conflictCode(error)).toBe("REQUEST_STALE");
            expect(store.snapshot()).toEqual(snapshot);
            expect(store.writesSince(mark)).toEqual([]);
        });

        it("(b) a day edited after the preview -> SERVICE_RECORD_WRITE_TARGET_CHANGED, store unchanged", async () => {
            const store = seedGoldenIncident();
            const harness = createHarness(store);
            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14" } });
            // Documented direct mutation: a caregiver edited session 3's note after the preview.
            dayRows(store)[2]!["notes"] = "미리보기 이후 수정된 메모";
            const snapshot = store.snapshot();
            const mark = store.mark();

            const error = await rejectionOf(resume.confirm());
            expect(conflictCode(error)).toBe("SERVICE_RECORD_WRITE_TARGET_CHANGED");
            expect(store.snapshot()).toEqual(snapshot);
            expect(store.writesSince(mark)).toEqual([]);
        });
    });

    describe("S6 an injected failure inside the confirm transaction leaves nothing written", () => {
        it("the assignment write throws after the case, client and day writes: the store equals its pre-confirm snapshot", async () => {
            const store = seedGoldenIncident();
            const harness = createHarness(store);
            const resume = await openEdit(harness, { resumeReplan: { fromSessionIndex: 2, resumeDate: "2026-10-14", incomingAssignmentId: B_ID } });
            const snapshot = store.snapshot();
            const mark = store.mark();
            const boom = new Error("injected assignment write failure");
            store.injectFailure("service_record_assignment", "updateMany", boom);

            await expect(resume.confirm()).rejects.toBe(boom);

            expect(store.snapshot()).toEqual(snapshot);
            // The earlier writes DID happen inside the transaction (and were rolled back), and the injected one fired.
            const attempted = store.writesSince(mark);
            expect(writesTo(attempted, "service_record_case", "update")).toHaveLength(1);
            expect(writesTo(attempted, "service_record_day", "updateMany").length).toBeGreaterThan(0);
            expect(writesTo(attempted, "service_record_revision", "create")).toHaveLength(1);
            expect(writesTo(attempted, "service_record_assignment", "updateMany")).toEqual([
                expect.objectContaining({ failed: true }),
            ]);
            expect(store.one("service_record_edit_draft", { id: resume.draftId })["status"]).toBe("ACTIVE");
            expect(store.rows("service_record_revision")).toHaveLength(0);

            // The draft is still confirmable: a retry after the failure writes the full correction.
            expect((await resume.confirm()).status).toBe("confirmed");
            expect(plannedOf(store).map((entry) => entry.serviceDate)).toEqual(NEW_DATES);
            expect(periods(store).assignmentA).toEqual(["2026-10-01", "2026-10-01"]);
            expect(store.rows("service_record_revision")).toHaveLength(1);
        });
    });

    describe("the store refuses what it does not model (a silent no-op can never pass a test)", () => {
        it("an unmodelled table and unmodelled methods are absent, and there is no raw SQL", () => {
            const store = seedGoldenIncident();
            const surface = store as unknown as Record<string, Record<string, unknown> | undefined>;
            expect(surface["message_trigger_rule"]).toBeUndefined();
            expect(surface["eformsign_document_job"]).toBeUndefined();
            expect(surface["$queryRaw"]).toBeUndefined();
            expect(surface["$executeRaw"]).toBeUndefined();
            // Present, but only with the methods the services actually call: no findMany, so document scope stays unverified.
            expect(surface["eformsign_doc"]?.["findMany"]).toBeUndefined();
            expect(typeof surface["eformsign_doc"]?.["updateMany"]).toBe("function");
            expect(() => store.insert("message_trigger_rule", {})).toThrow(/unmodelled table/);
        });

        it("throws on an unsupported where field, select key, data column, argument and orderBy", async () => {
            const store = seedGoldenIncident();
            await expect(store.service_record_case.findMany({ where: { client: { is: { deletedAt: null } } } })).rejects.toThrow(/unsupported where field "client"/);
            await expect(store.service_record_case.findMany({ select: { notAColumn: true } })).rejects.toThrow(/unsupported select\/include "notAColumn"/);
            await expect(store.service_record_case.updateMany({ where: { id: CASE_ID }, data: { notAColumn: 1 } })).rejects.toThrow(/unknown data column/);
            await expect(store.service_record_case.findMany({ where: { id: CASE_ID }, take: 1 } as never)).rejects.toThrow(/unsupported argument "take"/);
            await expect(store.service_record_case.findMany({ orderBy: { version: "sideways" } } as never)).rejects.toThrow(/orderBy direction/);
            await expect(store.service_record_case.findMany({ where: { version: { between: [1, 2] } } })).rejects.toThrow(/unsupported operator/);
        });

        it("accepts only the isolationLevel transaction option and rolls every table back when the callback throws", async () => {
            const store = seedGoldenIncident();
            await expect(store.$transaction(async () => undefined, { timeout: 1 })).rejects.toThrow(/unsupported \$transaction option/);
            const snapshot = store.snapshot();
            await expect(store.$transaction(async (tx) => {
                await tx.service_record_case.updateMany({ where: { id: CASE_ID }, data: { version: { increment: 5 } } });
                await tx.service_record_day.create({ data: { branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID, sessionIndex: 99 } });
                throw new Error("boom");
            }, { isolationLevel: "RepeatableRead" })).rejects.toThrow("boom");
            expect(store.snapshot()).toEqual(snapshot);
        });

        it("evaluates the whole where: a wrong id matches nothing and nothing is written", async () => {
            const store = seedGoldenIncident();
            const snapshot = store.snapshot();
            const result = await store.service_record_token.updateMany({
                where: { branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID, active: true, revokedAt: null, expiresAt: { lt: new Date("2026-10-01T00:00:00.000Z") } },
                data: { expiresAt: new Date("2030-01-01T00:00:00.000Z") },
            });
            expect(result).toEqual({ count: 0 });
            expect(store.snapshot()).toEqual(snapshot);
        });

        it("validates the whole request before matching: bad shapes throw even when no row would match", async () => {
            const store = new SequenceStore();
            // An unknown data column on an empty-match updateMany (it used to be accepted: no row, no check).
            await expect(store.service_record_case.updateMany({ where: { id: CASE_ID }, data: { notAColumn: true } })).rejects.toThrow(/unknown data column "notAColumn"/);
            await expect(store.service_record_case.updateMany({ data: { branch: { connect: { id: BRANCH_ID } } } })).rejects.toThrow(/nested relation write "branch"/);
            await expect(store.service_record_case.updateMany({ data: { version: { increment: 1, decrement: 1 } } })).rejects.toThrow(/unsupported numeric operation/);
            // An invalid select key, include key, where operator, where field and orderBy field on an empty table.
            await expect(store.service_record_case.findMany({ select: { notAColumn: true } })).rejects.toThrow(/unsupported select\/include "notAColumn"/);
            await expect(store.service_record_case.findMany({ include: { notARelation: true } })).rejects.toThrow(/unsupported select\/include "notARelation"/);
            await expect(store.service_record_case.findMany({ include: { days: { where: { notAColumn: 1 } } } })).rejects.toThrow(/unsupported where field "notAColumn"/);
            await expect(store.service_record_case.findMany({ where: { version: { between: [1, 2] } } })).rejects.toThrow(/unsupported operator "between"/);
            await expect(store.service_record_case.findMany({ where: { version: { in: 1 } } })).rejects.toThrow(/needs a list/);
            await expect(store.service_record_case.findMany({ where: { notAColumn: 1 } })).rejects.toThrow(/unsupported where field "notAColumn"/);
            await expect(store.service_record_case.findMany({ orderBy: { notAColumn: "asc" } })).rejects.toThrow(/orderBy on unknown column/);
        });

        it("refuses a single-row operation whose where names no modelled unique key, and acts on the keyed row otherwise", async () => {
            const store = seedGoldenIncident();
            const snapshot = store.snapshot();
            const nonUnique = { branchId: BRANCH_ID };
            await expect(store.service_record_case.update({ where: nonUnique, data: { version: 99 } })).rejects.toThrow(/names none of the unique keys/);
            await expect(store.service_record_case.findUnique({ where: nonUnique })).rejects.toThrow(/names none of the unique keys/);
            await expect(store.service_record_case.upsert({ where: nonUnique, create: { branchId: BRANCH_ID }, update: { version: 99 } })).rejects.toThrow(/names none of the unique keys/);
            // A compound key is not selectable by its plain fields either (Prisma needs `a_b: { a, b }`).
            await expect(store.service_record_day.update({ where: { serviceRecordCaseId: CASE_ID, caseSessionIndex: 1 }, data: { notes: "x" } })).rejects.toThrow(/names none of the unique keys/);
            // A null, list, `{ equals }` or other object value does not identify a row (Prisma's WhereUniqueInput types reject them).
            await expect(store.service_record_case.update({ where: { id: { equals: CASE_ID }, branchId: BRANCH_ID }, data: { formVersion: 4 } })).rejects.toThrow(/unique key "id" must be a string literal/);
            await expect(store.service_record_case.findUnique({ where: { clientId: { equals: CLIENT_ID } } })).rejects.toThrow(/unique key "clientId" must be a int literal/);
            await expect(store.service_record_case.findUnique({ where: { id: null } })).rejects.toThrow(/unique key "id" must be a string literal/);
            await expect(store.service_record_case.findUnique({ where: { id: { in: [CASE_ID] } } })).rejects.toThrow(/unique key "id" must be a string literal/);
            expect(store.snapshot()).toEqual(snapshot);

            // The primary key (alone, or with extra filters as Prisma allows) and a modelled @unique work.
            expect(await store.service_record_case.findUnique({ where: { id: CASE_ID }, select: { id: true } })).toEqual({ id: CASE_ID });
            expect(await store.service_record_case.findUnique({ where: { clientId: CLIENT_ID }, select: { id: true } })).toEqual({ id: CASE_ID });
            await store.service_record_case.update({ where: { id: CASE_ID, branchId: BRANCH_ID }, data: { formVersion: 4 } });
            expect(store.one("service_record_case", { id: CASE_ID })["formVersion"]).toBe(4);
            // Extra filters that match nothing still fail like Prisma's "record not found".
            await expect(store.service_record_case.update({ where: { id: CASE_ID, branchId: "other" }, data: { formVersion: 5 } })).rejects.toThrow(/record to update not found/);
        });

        describe("unique selectors: every supplied single-column unique key must itself be a literal", () => {
            type SingleRowMethod = "findUnique" | "update" | "upsert";
            interface UniqueKey { column: string; value: unknown; wrongKind: unknown }
            interface UniqueModel {
                table: string;
                methods: SingleRowMethod[];
                /** Two single-column unique keys of the table (modelled from prisma/schema.prisma `@id` / `@unique`). */
                keys: [UniqueKey, UniqueKey];
                /** A harmless column write for `update` / the upsert update branch, and a create payload. */
                data: Row;
                create: Row;
            }
            const ASSIGNMENT_ID = "eeeeeeee-eeee-4eee-8eee-000000000001";
            const MODELS: UniqueModel[] = [
                {
                    table: "service_record_case", methods: ["findUnique", "update", "upsert"],
                    keys: [{ column: "id", value: CASE_ID, wrongKind: 7 }, { column: "clientId", value: CLIENT_ID, wrongKind: "5" }],
                    data: { formVersion: 4 }, create: { branchId: BRANCH_ID },
                },
                // A second multi-key model, with the string key and the int key the other way round.
                {
                    table: "client", methods: ["findUnique", "update"],
                    keys: [{ column: "id", value: CLIENT_ID, wrongKind: "5" }, { column: "eDocId", value: "edoc-1", wrongKind: 9 }],
                    data: { name: "x" }, create: { branchId: BRANCH_ID },
                },
                {
                    table: "service_record_assignment", methods: ["upsert"],
                    keys: [{ column: "id", value: ASSIGNMENT_ID, wrongKind: 1 }, { column: "scheduleId", value: SCHEDULE_A, wrongKind: "126" }],
                    data: { employeeNameSnapshot: "x" }, create: { branchId: BRANCH_ID },
                },
            ];
            type RowCall = (args: Row) => Promise<unknown>;
            const request = (model: UniqueModel, method: SingleRowMethod, where: unknown): Row => {
                if (method === "findUnique") return { where };
                if (method === "update") return { where, data: model.data };
                return { where, create: model.create, update: model.data };
            };
            const issue = (store: SequenceStore, model: UniqueModel, method: SingleRowMethod, where: unknown): Promise<unknown> =>
                (store as unknown as Record<string, Record<string, RowCall>>)[model.table]![method]!(request(model, method, where));

            /** One valid key plus one bad value for the other, in both arrangements and with the bad key first and second. */
            const badWheres = (model: UniqueModel) => model.keys.flatMap((bad) => {
                const values: Array<[string, unknown]> = [
                    ["an { equals } object", { equals: bad.value }], ["an { in } object", { in: [bad.value] }], ["null", null],
                    ["a list", [bad.value]], ["a wrong-kind scalar", bad.wrongKind], ["an empty object", {}],
                ];
                return values.map(([label, value]) => ({
                    label: `${bad.column} as ${label}`,
                    column: bad.column,
                    // Property order follows the model's key order, so each bad key is exercised both first and second.
                    where: Object.fromEntries(model.keys.map((key) => [key.column, key === bad ? value : key.value])),
                }));
            });

            for (const model of MODELS) {
                for (const method of model.methods) {
                    for (const [variant, makeStore] of [["an empty store", () => new SequenceStore()], ["a populated store", seedGoldenIncident]] as const) {
                        it(`${model.table}.${method} on ${variant}: another valid unique key never excuses an object, list, null or wrong-kind one`, async () => {
                            const store = makeStore();
                            const snapshot = store.snapshot();
                            const mark = store.mark();
                            const cases = badWheres(model);
                            const outcomes: Array<{ label: string; outcome: string }> = [];
                            for (const { label, where } of cases) {
                                const outcome = await issue(store, model, method, where).then(() => "accepted", (error: Error) => error.message);
                                outcomes.push({ label, outcome });
                            }
                            expect(outcomes).toEqual(cases.map(({ label, column }) => ({
                                label,
                                outcome: expect.stringMatching(new RegExp(`^service-record-sequence-store: ${model.table}\\.${method}: unique key "${column}" must be a (string|int) literal`)),
                            })));
                            // Rejected at request validation: no write reached the store, so nothing changed.
                            expect(store.writesSince(mark)).toEqual([]);
                            expect(store.snapshot()).toEqual(snapshot);
                        });
                    }
                }
            }

            it("accepts a literal unique key beside other keys: both literal keys, a non-unique filter, nested predicates", async () => {
                const store = seedGoldenIncident();
                const only = { select: { id: true } };
                // Both literal unique keys.
                expect(await store.service_record_case.findUnique({ where: { id: CASE_ID, clientId: CLIENT_ID }, ...only })).toEqual({ id: CASE_ID });
                await store.service_record_case.update({ where: { id: CASE_ID, clientId: CLIENT_ID }, data: { formVersion: 4 } });
                await store.service_record_case.upsert({ where: { id: CASE_ID, clientId: CLIENT_ID }, create: { branchId: BRANCH_ID }, update: { formVersion: 5 } });
                expect(store.one("service_record_case", { id: CASE_ID })["formVersion"]).toBe(5);
                expect(store.rows("service_record_case")).toHaveLength(1);
                // A literal key plus a non-unique filter (even an operator object on the non-unique field).
                expect(await store.service_record_case.findUnique({ where: { clientId: CLIENT_ID, branchId: BRANCH_ID }, ...only })).toEqual({ id: CASE_ID });
                expect(await store.service_record_case.findUnique({ where: { id: CASE_ID, version: { gte: 1 } }, ...only })).toEqual({ id: CASE_ID });
                // A literal key plus ordinary nested predicates: AND / OR / NOT follow ordinary `where` rules, so an
                // `{ equals }` on a unique column inside them is a plain filter, not a unique selector.
                expect(await store.service_record_case.findUnique({
                    where: { id: CASE_ID, AND: [{ id: { equals: CASE_ID } }, { branchId: { not: "other" } }], OR: [{ version: { gte: 1 } }], NOT: { clientId: { in: [99] } } },
                    ...only,
                })).toEqual({ id: CASE_ID });
                // The second model: both literal keys of an assignment, on the upsert path.
                const assignmentId = store.one("service_record_assignment", { scheduleId: SCHEDULE_A })["id"] as string;
                await store.service_record_assignment.upsert({ where: { id: assignmentId, scheduleId: SCHEDULE_A }, create: { branchId: BRANCH_ID }, update: { employeeNameSnapshot: "x" } });
                expect(store.one("service_record_assignment", { id: assignmentId })["employeeNameSnapshot"]).toBe("x");
                expect(store.rows("service_record_assignment")).toHaveLength(2);
            });

            it("a contradictory extra predicate beside valid literal keys prevents matching", async () => {
                const store = seedGoldenIncident();
                const snapshot = store.snapshot();
                // The keys agree with each other but the row is not that client's, so nothing matches.
                expect(await store.service_record_case.findUnique({ where: { id: CASE_ID, clientId: 999 } })).toBeNull();
                expect(await store.service_record_case.findUnique({ where: { id: CASE_ID, AND: [{ branchId: "other" }] } })).toBeNull();
                expect(await store.service_record_case.findUnique({ where: { id: CASE_ID, NOT: { branchId: BRANCH_ID } } })).toBeNull();
                await expect(store.service_record_case.update({ where: { id: CASE_ID, clientId: 999 }, data: { formVersion: 9 } })).rejects.toThrow(/record to update not found/);
                await expect(store.service_record_case.update({ where: { id: CASE_ID, OR: [{ branchId: "other" }] }, data: { formVersion: 9 } })).rejects.toThrow(/record to update not found/);
                expect(store.snapshot()).toEqual(snapshot);
                // An upsert whose where matches nothing takes the create branch instead of updating the keyed row.
                await store.service_record_case.upsert({ where: { id: CASE_ID, clientId: 999 }, create: { branchId: BRANCH_ID, clientId: 999 }, update: { formVersion: 9 } });
                expect(store.rows("service_record_case")).toHaveLength(2);
                expect(store.one("service_record_case", { id: CASE_ID })["formVersion"]).toBe(3);
                // The same on the second model: the id belongs to schedule A, not B, so the create branch runs.
                const assignmentId = store.one("service_record_assignment", { scheduleId: SCHEDULE_A })["id"] as string;
                await store.service_record_assignment.upsert({ where: { id: assignmentId, scheduleId: SCHEDULE_B }, create: { branchId: BRANCH_ID, scheduleId: 4242 }, update: { employeeNameSnapshot: "x" } });
                expect(store.rows("service_record_assignment")).toHaveLength(3);
                expect(store.one("service_record_assignment", { id: assignmentId })["employeeNameSnapshot"]).not.toBe("x");
            });
        });

        it("rejects every nested shape Prisma's generated types reject, on an empty store too", async () => {
            const store = new SequenceStore();
            const scheduleIds = [1, 2];
            // Codex's three shapes (each used to leave the whole suite green when injected into production).
            await expect(store.eformsign_doc.updateMany({
                where: { employeeScheduleId: { in: scheduleIds, not: { between: [1, 2] } } } as never,
                data: { serviceRecordCaseId: CASE_ID },
            })).rejects.toThrow(/unsupported operator "between"/);
            await expect(store.eformsign_doc.updateMany({
                where: { employeeScheduleId: { in: scheduleIds } },
                data: { serviceRecordCaseId: { notAColumn: true } } as never,
            })).rejects.toThrow(/unsupported numeric operation or value for a string column/);
            await expect(store.service_record_case.update({
                where: { id: { equals: CASE_ID }, branchId: BRANCH_ID } as never,
                data: { formVersion: 2 },
            })).rejects.toThrow(/unique key "id" must be a string literal/);
            // A nested `not` is validated by the same rules as the outer filter.
            await expect(store.service_record_case.findMany({ where: { version: { not: { gte: 1, between: [1, 2] } } } as never })).rejects.toThrow(/unsupported operator "between"/);
            await expect(store.service_record_case.findMany({ where: { version: { not: { in: 1 } } } as never })).rejects.toThrow(/needs a list/);
            await expect(store.service_record_case.findMany({ where: { version: { not: { gte: { nested: 1 } } } } as never })).rejects.toThrow(/needs a int literal/);
            // Operands must be literals of the column's kind; a list holds literals only.
            await expect(store.service_record_case.findMany({ where: { version: { in: [{ nested: 1 }] } } as never })).rejects.toThrow(/needs a list of int literals/);
            await expect(store.service_record_case.findMany({ where: { version: { in: [null] } } as never })).rejects.toThrow(/needs a list of int literals/);
            await expect(store.service_record_case.findMany({ where: { version: { in: ["1"] } } as never })).rejects.toThrow(/needs a list of int literals/);
            await expect(store.service_record_case.findMany({ where: { version: { gte: { nested: 1 } } } as never })).rejects.toThrow(/needs a int literal/);
            await expect(store.service_record_case.findMany({ where: { version: { equals: { nested: 1 } } } as never })).rejects.toThrow(/needs a int literal or null/);
            await expect(store.service_record_case.findMany({ where: { version: { nested: 1 } } as never })).rejects.toThrow(/unsupported operator "nested"/);
            await expect(store.service_record_case.findMany({ where: { id: { nested: 1 } } as never })).rejects.toThrow(/unsupported operator "nested"/);
            await expect(store.service_record_case.findMany({ where: { id: { gte: new Date() } } as never })).rejects.toThrow(/needs a string literal/);
            await expect(store.service_record_case.findMany({ where: { id: [CASE_ID] } as never })).rejects.toThrow(/unsupported filter value/);
            await expect(store.service_record_case.findMany({ where: { version: new Date() } as never })).rejects.toThrow(/unsupported filter value/);
            // A boolean has no ordering or list operators; a Json column has no modelled filter.
            await expect(store.service_record_day.findMany({ where: { locked: { in: [true] } } as never })).rejects.toThrow(/unsupported operator "in"/);
            await expect(store.service_record_case.findMany({ where: { plannedSessions: { path: ["a"], equals: 1 } } as never })).rejects.toThrow(/a Json column has no modelled filter/);
            // data: a scalar column takes a literal, null or `increment` on an int; any other object throws.
            await expect(store.service_record_case.updateMany({ data: { formVersion: { notAColumn: 1 } } as never })).rejects.toThrow(/unsupported numeric operation or value for a int column/);
            await expect(store.service_record_case.updateMany({ data: { momName: { increment: 1 } } as never })).rejects.toThrow(/for a string column/);
            await expect(store.service_record_case.updateMany({ data: { version: { increment: "1" } } as never })).rejects.toThrow(/for a int column/);
            await expect(store.service_record_case.updateMany({ data: { version: { set: 3 } } as never })).rejects.toThrow(/for a int column/);
            await expect(store.service_record_case.updateMany({ data: { version: "3" } as never })).rejects.toThrow(/for a int column/);
            await expect(store.service_record_case.updateMany({ data: { completedAt: { equals: new Date() } } as never })).rejects.toThrow(/for a datetime column/);
            await expect(store.service_record_case.updateMany({ data: { momName: [] } as never })).rejects.toThrow(/for a string column/);
            // Unique selectors: the key's value is a scalar literal; `{ equals }`, null and lists are rejected.
            await expect(store.service_record_case.findUnique({ where: { id: { equals: CASE_ID } } as never })).rejects.toThrow(/unique key "id" must be a string literal/);
            await expect(store.service_record_case.upsert({ where: { id: { equals: CASE_ID } } as never, create: { branchId: BRANCH_ID }, update: {} })).rejects.toThrow(/unique key "id" must be a string literal/);
            // What Prisma does accept still works: operators over literals, a nested `not`, Json data, a plain literal key.
            await expect(store.service_record_case.findMany({
                where: { version: { in: [1, 2], not: { in: [3] }, gte: 1 }, completedAt: { not: null }, momName: { not: "x" } },
            })).resolves.toEqual([]);
            await expect(store.service_record_case.updateMany({ data: { plannedSessions: { increment: { deep: [1, { a: null }] } } } })).resolves.toEqual({ count: 0 });
            await expect(store.service_record_case.findUnique({ where: { id: CASE_ID, branchId: { not: "other" } } })).resolves.toBeNull();
        });

        it("enforces modelled uniqueness on every insert path", async () => {
            const store = seedGoldenIncident();
            const snapshot = store.snapshot();
            // create: the primary key, then the compound (case, session) key.
            await expect(store.service_record_day.create({ data: { id: "dddddddd-dddd-4ddd-8ddd-000000000001", branchId: BRANCH_ID } })).rejects.toThrow(/unique constraint \(id\)/);
            await expect(store.service_record_day.create({ data: { branchId: BRANCH_ID, serviceRecordCaseId: CASE_ID, caseSessionIndex: 1 } })).rejects.toThrow(/unique constraint \(serviceRecordCaseId, caseSessionIndex\)/);
            // upsert-create: the where matches no row, so the create branch runs and must not duplicate a key.
            await expect(store.service_record_case.upsert({ where: { clientId: 777 }, create: { id: CASE_ID, branchId: BRANCH_ID, clientId: 777 }, update: {} })).rejects.toThrow(/unique constraint \(id\)/);
            await expect(store.service_record_case.upsert({ where: { id: "00000000-0000-4000-8000-0000000000c2" }, create: { branchId: BRANCH_ID, clientId: CLIENT_ID }, update: {} })).rejects.toThrow(/unique constraint \(clientId\)/);
            await expect(store.service_record_assignment.upsert({ where: { scheduleId: 4242 }, create: { branchId: BRANCH_ID, scheduleId: SCHEDULE_A }, update: {} })).rejects.toThrow(/unique constraint \(scheduleId\)/);
            // test-facing insert and seeding.
            expect(() => store.insert("service_record_case", { id: CASE_ID })).toThrow(/unique constraint/);
            expect(() => new SequenceStore({ tables: { client: [{ id: 1 }, { id: 1 }] } })).toThrow(/unique constraint/);
            expect(store.snapshot()).toEqual(snapshot);

            // A fresh key is created, and an upsert whose where matches updates instead of inserting.
            await store.service_record_case.upsert({ where: { clientId: 777 }, create: { branchId: BRANCH_ID, clientId: 777 }, update: {} });
            expect(store.rows("service_record_case")).toHaveLength(2);
            await store.service_record_case.upsert({ where: { clientId: CLIENT_ID }, create: { branchId: BRANCH_ID, clientId: CLIENT_ID }, update: { formVersion: 9 } });
            expect(store.rows("service_record_case")).toHaveLength(2);
            expect(store.one("service_record_case", { id: CASE_ID })["formVersion"]).toBe(9);
        });
    });
});
