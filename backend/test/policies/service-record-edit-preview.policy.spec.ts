import { createHash } from "node:crypto";
import {
    assignmentWrites,
    buildServiceRecordEditPreview,
    confirmAssignmentWrites,
    draftServiceDays,
    normalizeServiceRecordEditChanges,
    pendingServiceDays,
    planResumeReplan,
    resolveResumeReplan,
    resolveServiceRecordScheduleProjection,
    ServiceRecordResumeAssignmentError,
    ServiceRecordScheduleValidationError,
    storedServiceDays,
} from "application/policies/service-record-edit-preview.policy";
import {
    KOREAN_HOLIDAY_CALENDAR,
    KR_BUILTIN_CALENDAR,
    UnsupportedKoreanHolidayYearError,
    createKrBusinessDayCalendar,
} from "domain/utils/business-days";
import type {
    ServiceRecordEditSource,
    ServiceRecordEditJsonValue,
} from "domain/repositories/service-record-edit.repository.interface";

const assignment = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    branchId: "11111111-1111-4111-8111-111111111111",
    serviceRecordCaseId: "22222222-2222-4222-8222-222222222222",
    scheduleId: 55,
    employeeId: 9,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    replaced: false,
    employeeName: "제공자",
    scheduleStartDate: "2026-09-01",
    scheduleEndDate: "2026-09-30",
    scheduleTerminatedAt: null,
    primaryEmployeeId: 9,
    secondaryEmployeeId: null,
    primaryEmployeeName: "제공자",
};

function source(overrides: Partial<ServiceRecordEditSource> = {}): ServiceRecordEditSource {
    const dates = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"];
    return {
        caseId: "22222222-2222-4222-8222-222222222222",
        caseVersion: 7,
        formVersion: 3,
        caseLifecycle: {
            status: "IN_PROGRESS",
            completedAt: null,
            finalizationDueAt: null,
            finalizationStartedAt: null,
            finalizedAt: null,
            documentsCompletedAt: null,
        },
        requiredSessionCount: dates.length,
        startDate: dates[0]!,
        endDate: dates.at(-1)!,
        header: {
            momName: "산모",
            momBirth: "900101",
            babyName: "아기",
            babyBirth: "260901",
            deliveryType: "자연분만",
            babyWeight: "3.2",
        },
        sessions: dates.map((serviceDate, index) => ({
            id: `day-${index + 1}`,
            branchId: assignment.branchId!,
            sourceRowId: `day-${index + 1}`,
            scheduleId: assignment.scheduleId,
            sessionIndex: index + 1,
            rawCaseSessionIndex: index + 1,
            rawSessionIndex: index + 1,
            ambiguous: false,
            serviceDate,
            answers: {},
            etcService: null,
            notes: null,
            paymentConfirmed: false,
            momApproval: null,
            clientSignature: null,
            clientSignedAt: null,
            locked: false,
            submittedAt: null,
            employeeId: assignment.employeeId,
            employeeNameSnapshot: assignment.employeeName,
            formVersion: 3,
        })),
        assignments: [assignment],
        plannedSessions: dates.map((serviceDate, index) => ({
            sessionIndex: index + 1,
            serviceDate,
            originalDate: serviceDate,
            assignmentId: assignment.id,
            scheduleId: assignment.scheduleId,
            employeeId: assignment.employeeId,
            provenanceVersion: "case-7",
        })),
        client: {
            id: 101,
            branchId: assignment.branchId,
            name: "산모",
            duration: 15,
            startDate: dates[0]!,
            endDate: dates.at(-1)!,
            serviceStatus: "in_progress",
        },
        ...overrides,
    };
}

describe("service-record-edit-preview.policy", () => {
    it("preserves later dates for an explicitly single-session correction", () => {
        const normalized = normalizeServiceRecordEditChanges(source(), {}, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 1, toDate: "2026-09-04", shiftFollowing: false });
        expect(normalized.entries?.map((entry) => entry.serviceDate)).toEqual(["2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
        expect(() => normalizeServiceRecordEditChanges(source(), {}, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 1, toDate: "2026-09-08", shiftFollowing: false })).toThrow();
    });

    it("keeps nominal duration separate and shifts only the selected suffix", () => {
        const normalized = normalizeServiceRecordEditChanges(
            source(),
            {},
            { sessions: [{ sessionIndex: 3, notes: "변경" }] },
            KR_BUILTIN_CALENDAR,
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        expect(normalized.entries?.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-11", "2026-09-14", "2026-09-15",
        ]);
        expect(source().client.duration).toBe(15);

        const preview = buildServiceRecordEditPreview({
            calendar: KR_BUILTIN_CALENDAR,
            draftId: "33333333-3333-4333-8333-333333333333",
            draftVersion: 2,
            sourceCaseVersion: 7,
            sourceFingerprint: "source-fingerprint",
            source: source(),
            changes: normalized.changes,
            previewId: "preview-1",
        });
        expect(preview.before.sessions.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
        ]);
        expect(preview.after.sessions.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-11", "2026-09-14", "2026-09-15",
        ]);
        expect(preview.contentChanges.changedSessionIndexes).toContain(3);
        expect(preview.blockingReasons).toEqual([]);
    });

    it("describes impacted assignments with caregiver name and stored period", () => {
        const build = (assignmentOverrides: Partial<Omit<typeof assignment, "employeeName">> & { employeeName?: string | null }) => {
            const base = source();
            const named = source({ assignments: [{ ...assignment, ...assignmentOverrides }] });
            const normalized = normalizeServiceRecordEditChanges(
                base,
                {},
                { sessions: [{ sessionIndex: 3, notes: "변경" }] },
                KR_BUILTIN_CALENDAR,
                { sessionIndex: 3, toDate: "2026-09-11" },
            );
            return buildServiceRecordEditPreview({
                calendar: KR_BUILTIN_CALENDAR,
                draftId: "33333333-3333-4333-8333-333333333333",
                draftVersion: 2,
                sourceCaseVersion: 7,
                sourceFingerprint: "source-fingerprint",
                source: named,
                changes: normalized.changes,
                previewId: "preview-1",
            });
        };

        const preview = build({ employeeName: "가상관리사을", startDate: "2026-09-01", endDate: "2026-09-30" });
        expect(preview.impactedAssignments).toEqual([assignment.id]);
        expect(preview.impactedAssignmentDetails).toEqual([
            { assignmentId: assignment.id, employeeName: "가상관리사을", startDate: "2026-09-01", endDate: "2026-09-30" },
        ]);

        const unnamed = build({ employeeName: null, startDate: "", endDate: "", scheduleStartDate: "2026-09-02", scheduleEndDate: "2026-09-29" });
        expect(unnamed.impactedAssignmentDetails).toEqual([
            { assignmentId: assignment.id, employeeName: null, startDate: "2026-09-02", endDate: "2026-09-29" },
        ]);
    });

    it("allows a reverse move from the normalized current draft baseline", () => {
        const first = normalizeServiceRecordEditChanges(
            source(),
            {},
            { sessions: [] },
            KR_BUILTIN_CALENDAR,
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        const second = normalizeServiceRecordEditChanges(
            source(),
            first.changes,
            { sessions: [] },
            KR_BUILTIN_CALENDAR,
            { sessionIndex: 3, toDate: "2026-09-09" },
        );
        expect(second.entries?.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
        ]);
    });

    it("preserves an earlier suffix move when a later move is applied", () => {
        const first = normalizeServiceRecordEditChanges(
            source(),
            {},
            { sessions: [] },
            KR_BUILTIN_CALENDAR,
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        const second = normalizeServiceRecordEditChanges(
            source(),
            first.changes,
            { sessions: [] },
            KR_BUILTIN_CALENDAR,
            { sessionIndex: 5, toDate: "2026-09-18" },
        );

        expect(second.entries?.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-11", "2026-09-14", "2026-09-18",
        ]);
        expect((second.changes["sessions"] as Array<{ sessionIndex: number; serviceDate?: string }>).map((session) => [
            session.sessionIndex,
            session.serviceDate,
        ])).toEqual([
            [3, "2026-09-11"],
            [4, "2026-09-14"],
            [5, "2026-09-18"],
        ]);
    });

    it("preserves normalized dates when a later content save resends the full snapshot", () => {
        const first = normalizeServiceRecordEditChanges(
            source(),
            {},
            { sessions: [] },
            KR_BUILTIN_CALENDAR,
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        const second = normalizeServiceRecordEditChanges(
            source(),
            first.changes,
            {
                header: { momName: "수정 산모" },
                sessions: first.changes["sessions"] as ServiceRecordEditJsonValue,
            },
            KR_BUILTIN_CALENDAR,
        );
        expect(second.entries?.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-11", "2026-09-14", "2026-09-15",
        ]);
        expect(second.changes["header"]).toEqual({ momName: "수정 산모" });
    });

    it("reports date changes for unwritten planned slots and leaves equal content unchanged", () => {
        const sparse = source({ sessions: source().sessions.slice(0, 2) });
        const normalized = normalizeServiceRecordEditChanges(
            sparse,
            {},
            { sessions: [] },
            KR_BUILTIN_CALENDAR,
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        const preview = buildServiceRecordEditPreview({
            calendar: KR_BUILTIN_CALENDAR,
            draftId: "33333333-3333-4333-8333-333333333333",
            draftVersion: 1,
            sourceCaseVersion: 7,
            sourceFingerprint: "source-fingerprint",
            source: sparse,
            changes: normalized.changes,
            previewId: "preview-1",
        });
        expect(preview.contentChanges.changedSessionIndexes).toEqual([3, 4, 5]);
        expect(preview.contentChanges.headerChanged).toBe(false);

        const noOp = buildServiceRecordEditPreview({
            calendar: KR_BUILTIN_CALENDAR,
            draftId: "33333333-3333-4333-8333-333333333333",
            draftVersion: 1,
            sourceCaseVersion: 7,
            sourceFingerprint: "source-fingerprint",
            source: source(),
            changes: { header: { momName: "산모" }, sessions: [{ sessionIndex: 1, answers: {} }] },
            previewId: "preview-1",
        });
        expect(noOp.contentChanges).toEqual({ headerChanged: false, changedSessionIndexes: [] });
    });

    it("blocks incomplete persisted provenance while preserving a draftable source", () => {
        const incomplete = source({
            plannedSessions: [{
                sessionIndex: 1,
                serviceDate: "2026-09-07",
                assignmentId: assignment.id,
                scheduleId: assignment.scheduleId,
                employeeId: assignment.employeeId,
            }] as unknown as ServiceRecordEditJsonValue,
        });
        const projection = resolveServiceRecordScheduleProjection(incomplete, KR_BUILTIN_CALENDAR);
        expect(projection.entries).toEqual([]);
        expect(projection.blockingReasons.map(({ code }) => code)).toContain("INCOMPLETE_VECTOR");
        const preview = buildServiceRecordEditPreview({
            calendar: KR_BUILTIN_CALENDAR,
            draftId: "33333333-3333-4333-8333-333333333333",
            draftVersion: 1,
            sourceCaseVersion: 7,
            sourceFingerprint: "source-fingerprint",
            source: incomplete,
            changes: {},
            previewId: "preview-1",
        });
        expect(preview.blockingReasons.length).toBeGreaterThan(0);
        expect(preview.before.sessions).toEqual([]);
    });

    it("blocks a persisted vector when an actual day contradicts its planned date", () => {
        const contradictory = source({
            sessions: source().sessions.map((session, index) => index === 0
                ? { ...session, serviceDate: "2026-09-08" }
                : session),
        });
        const projection = resolveServiceRecordScheduleProjection(contradictory, KR_BUILTIN_CALENDAR);
        expect(projection.blockingReasons.map(({ code }) => code)).toContain("ACTUAL_DAY_CONTRADICTION");
    });

    it("rejects changed date snapshots unless a typed dateMove is supplied", () => {
        expect(() => normalizeServiceRecordEditChanges(
            source(),
            {},
            { sessions: [{ sessionIndex: 3, serviceDate: "2026-09-11" }] },
            KR_BUILTIN_CALENDAR,
        )).toThrow(/dateMove/);
    });

    it("blocks an ambiguous legacy source instead of inventing assignment ownership", () => {
        const legacy = source({
            plannedSessions: null,
            sessions: source().sessions.map((session, index) => index === 2
                ? { ...session, ambiguous: true }
                : session),
        });
        const projection = resolveServiceRecordScheduleProjection(legacy, KR_BUILTIN_CALENDAR);
        expect(projection.blockingReasons.map(({ code }) => code)).toContain("AMBIGUOUS_LEGACY_PROVENANCE");
    });

    it("keeps persisted ownership when a move expands its assignment range", () => {
        const bounded = source({
            assignments: [{ ...assignment, endDate: "2026-09-10", scheduleEndDate: "2026-09-10" }],
            plannedSessions: source().plannedSessions,
        });
        const normalized = normalizeServiceRecordEditChanges(
            bounded,
            {},
            { sessions: [] },
            KR_BUILTIN_CALENDAR,
            { sessionIndex: 3, toDate: "2026-09-14" },
        );
        const preview = buildServiceRecordEditPreview({
            calendar: KR_BUILTIN_CALENDAR,
            draftId: "33333333-3333-4333-8333-333333333333",
            draftVersion: 1,
            sourceCaseVersion: 7,
            sourceFingerprint: "source-fingerprint",
            source: bounded,
            changes: normalized.changes,
            previewId: "preview-1",
        });
        expect(preview.blockingReasons).toEqual([]);
        expect(preview.provenance).toEqual([expect.objectContaining({ endDate: "2026-09-16" })]);
    });

    describe("legacy ownership follows the writer or the current assignee", () => {
        const BRANCH = assignment.branchId;
        const CASE = assignment.serviceRecordCaseId;
        const caregiverA = {
            ...assignment,
            id: "aaaaaaaa-0000-4000-8000-00000000000a",
            scheduleId: 701,
            employeeId: 31,
            employeeName: "가상관리사갑",
            startDate: "2026-10-01",
            endDate: "2026-10-14",
            replaced: true,
            scheduleStartDate: "2026-10-01",
            scheduleEndDate: "2026-10-14",
        };
        const caregiverB = {
            ...assignment,
            id: "bbbbbbbb-0000-4000-8000-00000000000b",
            scheduleId: 702,
            employeeId: 32,
            employeeName: "가상관리사을",
            startDate: "2026-10-14",
            endDate: "2026-10-23",
            replaced: false,
            scheduleStartDate: "2026-10-14",
            scheduleEndDate: "2026-10-23",
        };
        // 15 business days from 2026-10-01 with 10-05 (substitute) and 10-09 off.
        const dates = [
            "2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08",
            "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16",
            "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
        ];

        function written(sessionIndex: number, owner: typeof caregiverA) {
            const serviceDate = dates[sessionIndex - 1]!;
            return {
                ...source().sessions[0]!,
                id: `day-${sessionIndex}`,
                sourceRowId: `day-${sessionIndex}`,
                sessionIndex,
                rawCaseSessionIndex: sessionIndex,
                rawSessionIndex: sessionIndex,
                serviceDate,
                scheduleId: owner.scheduleId,
                employeeId: owner.employeeId,
                employeeNameSnapshot: owner.employeeName,
            };
        }

        function legacy(rows: Array<ReturnType<typeof written>>, assignments: typeof caregiverA[]): ServiceRecordEditSource {
            return source({
                plannedSessions: null,
                requiredSessionCount: dates.length,
                startDate: dates[0]!,
                endDate: dates.at(-1)!,
                sessions: rows,
                assignments: assignments.map((item) => ({ ...item, branchId: BRANCH, serviceRecordCaseId: CASE })),
            });
        }

        const calendar = KR_BUILTIN_CALENDAR;

        it("does not treat the handover day as ambiguous when only the outgoing caregiver wrote session 1", () => {
            const projection = resolveServiceRecordScheduleProjection(
                legacy([written(1, caregiverA)], [caregiverA, caregiverB]),
                calendar,
            );
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries.map(({ serviceDate }) => serviceDate)).toEqual(dates);
            // Sessions 2..7 are unwritten but lie inside A's range, so A keeps them.
            expect(projection.entries.slice(0, 7).every((entry) => entry.assignmentId === caregiverA.id)).toBe(true);
            // Session 8 falls on the handover day (in both ranges) and resolves to the current assignee.
            expect(projection.entries[7]).toEqual(expect.objectContaining({ sessionIndex: 8, assignmentId: caregiverB.id }));
            expect(projection.entries.slice(7).every((entry) => entry.assignmentId === caregiverB.id)).toBe(true);
        });

        it("keeps unwritten sessions inside the outgoing range with their original owner", () => {
            const preview = buildServiceRecordEditPreview({
                calendar,
                draftId: "33333333-3333-4333-8333-333333333333",
                draftVersion: 1,
                sourceCaseVersion: 7,
                sourceFingerprint: "source-fingerprint",
                source: legacy(
                    [written(1, caregiverA), written(2, caregiverA), written(3, caregiverA), written(8, caregiverB)],
                    [caregiverA, caregiverB],
                ),
                changes: {},
                previewId: "preview-1",
            });
            expect(preview.blockingReasons).toEqual([]);
            expect(preview.provenance).toEqual([
                expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-13" }),
                expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-14", endDate: "2026-10-23" }),
            ]);
            const projection = resolveServiceRecordScheduleProjection(
                legacy(
                    [written(1, caregiverA), written(2, caregiverA), written(3, caregiverA), written(8, caregiverB)],
                    [caregiverA, caregiverB],
                ),
                calendar,
            );
            expect(projection.entries.slice(0, 7).every((entry) => entry.assignmentId === caregiverA.id)).toBe(true);
            expect(projection.entries.slice(7).every((entry) => entry.assignmentId === caregiverB.id)).toBe(true);
        });

        it("matches a row with no schedule id but an employee id by the employee and the session date", () => {
            const orphan = { ...written(3, caregiverA), scheduleId: null as unknown as number };
            const projection = resolveServiceRecordScheduleProjection(
                legacy([written(1, caregiverA), orphan], [caregiverA, caregiverB]),
                calendar,
            );
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries[2]).toEqual(expect.objectContaining({ sessionIndex: 3, assignmentId: caregiverA.id }));
        });

        it("does not report an overlap when a session between two written ones is left unwritten", () => {
            const projection = resolveServiceRecordScheduleProjection(
                legacy(
                    [written(1, caregiverA), written(2, caregiverA), written(4, caregiverA)],
                    [caregiverA, caregiverB],
                ),
                calendar,
            );
            expect(projection.blockingReasons.map(({ code }) => code)).not.toContain("ASSIGNMENT_RANGE_OVERLAP");
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries.slice(0, 7).every((entry) => entry.assignmentId === caregiverA.id)).toBe(true);
        });

        it("lets the new assignee own sessions it backfilled before its own start date", () => {
            const rows = [written(1, caregiverA), ...[2, 3, 4, 5, 6, 7].map((index) => written(index, caregiverB))];
            const projection = resolveServiceRecordScheduleProjection(legacy(rows, [caregiverA, caregiverB]), calendar);
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries[0]!.assignmentId).toBe(caregiverA.id);
            expect(projection.entries.slice(1).every((entry) => entry.assignmentId === caregiverB.id)).toBe(true);
        });

        it("gives unwritten sessions after a partial backfill to the new assignee instead of blocking on overlap", () => {
            // A wrote 1; B backfilled 2-3 (dated before B's own start); 4-7 are still unwritten.
            const rows = [written(1, caregiverA), written(2, caregiverB), written(3, caregiverB)];
            const projection = resolveServiceRecordScheduleProjection(legacy(rows, [caregiverA, caregiverB]), calendar);
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries[0]!.assignmentId).toBe(caregiverA.id);
            expect(projection.entries.slice(1).every((entry) => entry.assignmentId === caregiverB.id)).toBe(true);

            const preview = buildServiceRecordEditPreview({
                calendar,
                draftId: "33333333-3333-4333-8333-333333333333",
                draftVersion: 1,
                sourceCaseVersion: 7,
                sourceFingerprint: "source-fingerprint",
                source: legacy(rows, [caregiverA, caregiverB]),
                changes: {},
                previewId: "preview-1",
            });
            expect(preview.blockingReasons).toEqual([]);
            expect(preview.provenance).toEqual([
                expect.objectContaining({ assignmentId: caregiverA.id, startDate: "2026-10-01", endDate: "2026-10-01" }),
                expect.objectContaining({ assignmentId: caregiverB.id, startDate: "2026-10-02", endDate: "2026-10-23" }),
            ]);
        });

        it("leaves an unwritten session before the new assignee's first backfilled one with the date owner", () => {
            const rows = [written(1, caregiverA), written(3, caregiverB)];
            const projection = resolveServiceRecordScheduleProjection(legacy(rows, [caregiverA, caregiverB]), calendar);
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries.slice(0, 2).every((entry) => entry.assignmentId === caregiverA.id)).toBe(true);
            expect(projection.entries.slice(2).every((entry) => entry.assignmentId === caregiverB.id)).toBe(true);
        });

        it("does not treat a later session written inside the new assignee's own range as a backfill", () => {
            // B only wrote session 8 (the handover day, not before its start), so 4-7 stay with A.
            const projection = resolveServiceRecordScheduleProjection(
                legacy([written(1, caregiverA), written(8, caregiverB)], [caregiverA, caregiverB]),
                calendar,
            );
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries.slice(0, 7).every((entry) => entry.assignmentId === caregiverA.id)).toBe(true);
            expect(projection.entries.slice(7).every((entry) => entry.assignmentId === caregiverB.id)).toBe(true);
        });

        it("still blocks an unwritten session when there is no unique current assignment", () => {
            const secondCurrent = { ...caregiverA, replaced: false };
            const projection = resolveServiceRecordScheduleProjection(
                legacy([], [secondCurrent, caregiverB]),
                calendar,
            );
            expect(projection.blockingReasons.map(({ code }) => code)).toContain("MISSING_ASSIGNMENT_PROVENANCE");
            expect(projection.entries).toEqual([]);
        });

        it("blocks a written row whose schedule is not among the source assignments", () => {
            const projection = resolveServiceRecordScheduleProjection(
                legacy([{ ...written(1, caregiverA), scheduleId: 999 }], [caregiverA, caregiverB]),
                calendar,
            );
            expect(projection.blockingReasons.map(({ code }) => code)).toContain("MISSING_ASSIGNMENT_PROVENANCE");
        });
    });

    describe("persisted vector with a backfilled session", () => {
        const caregiverA = {
            ...assignment,
            id: "aaaaaaaa-0000-4000-8000-00000000000a",
            scheduleId: 701,
            employeeId: 31,
            employeeName: "가상관리사갑",
            startDate: "2026-10-01",
            endDate: "2026-10-14",
            replaced: true,
            scheduleStartDate: "2026-10-01",
            scheduleEndDate: "2026-10-14",
        };
        const caregiverB = {
            ...assignment,
            id: "bbbbbbbb-0000-4000-8000-00000000000b",
            scheduleId: 702,
            employeeId: 32,
            employeeName: "가상관리사을",
            startDate: "2026-10-14",
            endDate: "2026-10-23",
            replaced: false,
            scheduleStartDate: "2026-10-14",
            scheduleEndDate: "2026-10-23",
        };
        const dates = [
            "2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08",
            "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16",
            "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
        ];

        function written(sessionIndex: number, owner: typeof caregiverA) {
            return {
                ...source().sessions[0]!,
                id: `day-${sessionIndex}`,
                sourceRowId: `day-${sessionIndex}`,
                sessionIndex,
                rawCaseSessionIndex: sessionIndex,
                rawSessionIndex: sessionIndex,
                serviceDate: dates[sessionIndex - 1]!,
                scheduleId: owner.scheduleId,
                employeeId: owner.employeeId,
                employeeNameSnapshot: owner.employeeName,
            };
        }

        /** The vector attributes sessions 1-7 to A and 8-15 to B, as a confirmed edit would have stored it. */
        function persisted(
            rows: Array<ReturnType<typeof written>>,
            assignments: typeof caregiverA[] = [caregiverA, caregiverB],
            ownerOf: (sessionIndex: number) => typeof caregiverA = (sessionIndex) => sessionIndex <= 7 ? caregiverA : caregiverB,
        ): ServiceRecordEditSource {
            return source({
                requiredSessionCount: dates.length,
                startDate: dates[0]!,
                endDate: dates.at(-1)!,
                sessions: rows,
                assignments: assignments.map((item) => ({
                    ...item,
                    branchId: assignment.branchId,
                    serviceRecordCaseId: assignment.serviceRecordCaseId,
                })),
                plannedSessions: dates.map((serviceDate, index) => {
                    const owner = ownerOf(index + 1);
                    return {
                        sessionIndex: index + 1,
                        serviceDate,
                        originalDate: serviceDate,
                        assignmentId: owner.id,
                        scheduleId: owner.scheduleId,
                        employeeId: owner.employeeId,
                        provenanceVersion: "case-7",
                    };
                }),
            });
        }

        it("treats the current caregiver's row on a slot the vector gives a replaced one as that caregiver's", () => {
            const rows = [written(1, caregiverA), ...[2, 3, 4, 5, 6, 7].map((index) => written(index, caregiverB))];
            const projection = resolveServiceRecordScheduleProjection(persisted(rows), KR_BUILTIN_CALENDAR);
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries[0]).toEqual(expect.objectContaining({ assignmentId: caregiverA.id, scheduleId: 701, employeeId: 31 }));
            for (const entry of projection.entries.slice(1)) {
                expect(entry).toEqual(expect.objectContaining({ assignmentId: caregiverB.id, scheduleId: 702, employeeId: 32 }));
            }
            // The vector's dates are untouched.
            expect(projection.entries.map(({ serviceDate }) => serviceDate)).toEqual(dates);

            const preview = buildServiceRecordEditPreview({
                calendar: KR_BUILTIN_CALENDAR,
                draftId: "33333333-3333-4333-8333-333333333333",
                draftVersion: 1,
                sourceCaseVersion: 7,
                sourceFingerprint: "source-fingerprint",
                source: persisted(rows),
                changes: {},
                previewId: "preview-1",
            });
            expect(preview.blockingReasons).toEqual([]);
        });

        it("gives the slots after a partial persisted backfill to the caregiver who backfilled", () => {
            // A wrote 1-2, B backfilled 3; 4-7 have no row and the vector still names A for them.
            const rows = [written(1, caregiverA), written(2, caregiverA), written(3, caregiverB)];
            const projection = resolveServiceRecordScheduleProjection(persisted(rows), KR_BUILTIN_CALENDAR);
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries.slice(0, 2).every((entry) => entry.assignmentId === caregiverA.id)).toBe(true);
            expect(projection.entries.slice(2).every((entry) => entry.assignmentId === caregiverB.id)).toBe(true);
        });

        it("keeps the slots before the first persisted backfill with their vector owner", () => {
            const rows = [written(1, caregiverA), written(4, caregiverB)];
            const projection = resolveServiceRecordScheduleProjection(persisted(rows), KR_BUILTIN_CALENDAR);
            expect(projection.blockingReasons).toEqual([]);
            expect(projection.entries.slice(0, 3).every((entry) => entry.assignmentId === caregiverA.id)).toBe(true);
            expect(projection.entries.slice(3).every((entry) => entry.assignmentId === caregiverB.id)).toBe(true);
        });

        describe("successor is decided by schedule order, not by stored assignment dates", () => {
            const allTo = (owner: typeof caregiverA) => () => owner;
            const blocked = (projection: { blockingReasons: Array<{ code: string }> }) =>
                projection.blockingReasons.map(({ code }) => code);

            it("accepts a backfill when the replaced caregiver was stored as [start, start] inside the successor's range", () => {
                // Scenario A: A was replaced before her own start, so she is stored [10-06, 10-06]
                // while B (current) starts on the earlier replacement date.
                const replacedBeforeStart = {
                    ...caregiverA,
                    startDate: "2026-10-06",
                    endDate: "2026-10-06",
                    scheduleStartDate: "2026-10-06",
                    scheduleEndDate: "2026-10-06",
                };
                const current = {
                    ...caregiverB,
                    startDate: "2026-10-01",
                    endDate: "2026-10-23",
                    scheduleStartDate: "2026-10-01",
                    scheduleEndDate: "2026-10-23",
                };
                const rows = [1, 2, 3].map((index) => written(index, current));
                const source = persisted(rows, [replacedBeforeStart, current], allTo(replacedBeforeStart));
                const projection = resolveServiceRecordScheduleProjection(source, KR_BUILTIN_CALENDAR);
                expect(blocked(projection)).toEqual([]);
                expect(projection.entries.every((entry) => entry.assignmentId === current.id)).toBe(true);
                const preview = buildServiceRecordEditPreview({
                    calendar: KR_BUILTIN_CALENDAR,
                    draftId: "33333333-3333-4333-8333-333333333333",
                    draftVersion: 1,
                    sourceCaseVersion: 7,
                    sourceFingerprint: "source-fingerprint",
                    source,
                    changes: {},
                    previewId: "preview-1",
                });
                expect(preview.blockingReasons).toEqual([]);
            });

            it("accepts a backfill when the successor's stored start was moved before the replaced caregiver's end", () => {
                // Scenario B: A [10-01, 10-15] replaced, B [10-14, 10-23]; the vector gives 1-7 to A.
                const overlappedA = { ...caregiverA, endDate: "2026-10-15", scheduleEndDate: "2026-10-15" };
                const rows = [written(1, overlappedA), ...[2, 3, 4, 5, 6, 7].map((index) => written(index, caregiverB))];
                const projection = resolveServiceRecordScheduleProjection(
                    persisted(rows, [overlappedA, caregiverB]),
                    KR_BUILTIN_CALENDAR,
                );
                expect(blocked(projection)).toEqual([]);
                expect(projection.entries.slice(1).every((entry) => entry.assignmentId === caregiverB.id)).toBe(true);
            });

            it("still accepts the non-overlapping control (A [10-01, 10-14], B [10-14, 10-23])", () => {
                const rows = [written(1, caregiverA), ...[2, 3, 4, 5, 6, 7].map((index) => written(index, caregiverB))];
                expect(blocked(resolveServiceRecordScheduleProjection(persisted(rows), KR_BUILTIN_CALENDAR))).toEqual([]);
            });

            it("still blocks a writer whose schedule id is lower than the replaced planned owner's", () => {
                // The vector names the later (replaced) schedule 702; the earlier schedule 701 wrote slot 3,
                // even though its stored dates would have satisfied the old date comparison.
                const laterReplaced = {
                    ...caregiverB,
                    replaced: true,
                    startDate: "2026-10-01",
                    scheduleStartDate: "2026-10-01",
                    endDate: "2026-10-02",
                    scheduleEndDate: "2026-10-02",
                };
                const earlier = {
                    ...caregiverA,
                    startDate: "2026-10-05",
                    endDate: "2026-10-23",
                    scheduleStartDate: "2026-10-05",
                    scheduleEndDate: "2026-10-23",
                };
                const rows = [written(3, earlier)];
                const projection = resolveServiceRecordScheduleProjection(
                    persisted(rows, [earlier, laterReplaced], allTo(laterReplaced)),
                    KR_BUILTIN_CALENDAR,
                );
                expect(blocked(projection)).toContain("ASSIGNMENT_PROVENANCE_MISMATCH");
            });
        });

        it("blocks a later schedule's write over a slot whose planned owner was never replaced", () => {
            // A (701) still owns slots 1-7 in the vector and is not replaced; B (702) wrote slot 3.
            const currentA = { ...caregiverA, replaced: false };
            const rows = [written(3, caregiverB)];
            const projection = resolveServiceRecordScheduleProjection(
                persisted(rows, [currentA, caregiverB]),
                KR_BUILTIN_CALENDAR,
            );
            expect(projection.blockingReasons.map(({ code }) => code)).toContain("ASSIGNMENT_PROVENANCE_MISMATCH");
        });

        describe("when the backfilling caregiver was itself replaced", () => {
            const middle = {
                ...caregiverB,
                id: "cccccccc-0000-4000-8000-00000000000c",
                scheduleId: 703,
                employeeId: 33,
                employeeName: "중간",
                startDate: "2026-10-14",
                scheduleStartDate: "2026-10-14",
                endDate: "2026-10-19",
                scheduleEndDate: "2026-10-19",
                replaced: true,
            };
            const latest = {
                ...caregiverB,
                id: "dddddddd-0000-4000-8000-00000000000d",
                scheduleId: 704,
                employeeId: 34,
                employeeName: "현재",
                startDate: "2026-10-19",
                scheduleStartDate: "2026-10-19",
                endDate: "2026-10-23",
                scheduleEndDate: "2026-10-23",
                replaced: false,
            };
            const chain = [caregiverA, middle, latest];
            const ownerOf = (sessionIndex: number) => sessionIndex <= 7 ? caregiverA : sessionIndex <= 11 ? middle : latest;

            it("still treats the middle caregiver's rows on the first caregiver's slots as that caregiver's", () => {
                const rows = [written(1, caregiverA), ...[2, 3, 4, 5, 6, 7].map((index) => written(index, middle))];
                const projection = resolveServiceRecordScheduleProjection(persisted(rows, chain, ownerOf), KR_BUILTIN_CALENDAR);
                expect(projection.blockingReasons).toEqual([]);
                expect(projection.entries.slice(1, 11).every((entry) => entry.assignmentId === middle.id)).toBe(true);
                expect(projection.entries.slice(11).every((entry) => entry.assignmentId === latest.id)).toBe(true);
            });

            describe("with a vector of A 1-7, B 8-10 and C 11-15", () => {
                const threeWay = (sessionIndex: number) => sessionIndex <= 7 ? caregiverA : sessionIndex <= 10 ? middle : latest;
                const owners = (rows: Array<ReturnType<typeof written>>) =>
                    resolveServiceRecordScheduleProjection(persisted(rows, chain, threeWay), KR_BUILTIN_CALENDAR);
                const ownerNames = (entries: Array<{ assignmentId: string }>) => entries.map((entry) =>
                    entry.assignmentId === caregiverA.id ? "A" : entry.assignmentId === middle.id ? "B" : "C").join("");

                it("lets a later caregiver's backfill carry across the middle caregiver's unwritten slots", () => {
                    const projection = owners([written(1, caregiverA), written(2, latest)]);
                    expect(projection.blockingReasons).toEqual([]);
                    expect(ownerNames(projection.entries)).toBe("ACCCCCCCCCCCCCC");
                });

                it("follows the nearest preceding backfiller when the backfilling caregiver was replaced in turn", () => {
                    // B backfilled 5 while current, then C replaced B and wrote 9.
                    const projection = owners([written(1, caregiverA), written(5, middle), written(9, latest)]);
                    expect(projection.blockingReasons).toEqual([]);
                    expect(ownerNames(projection.entries)).toBe("AAAABBBBCCCCCCC");
                });

                it("hands the slots after a later backfiller's row to that backfiller", () => {
                    // B (now replaced) backfilled 3, then C wrote 4.
                    const projection = owners([written(1, caregiverA), written(3, middle), written(4, latest)]);
                    expect(projection.blockingReasons).toEqual([]);
                    expect(ownerNames(projection.entries)).toBe("AABCCCCCCCCCCCC");
                });
            });

            it("still blocks an earlier caregiver writing over a later caregiver's slot", () => {
                const projection = resolveServiceRecordScheduleProjection(
                    persisted([written(9, caregiverA)], chain, ownerOf),
                    KR_BUILTIN_CALENDAR,
                );
                expect(projection.blockingReasons.map(({ code }) => code)).toContain("ASSIGNMENT_PROVENANCE_MISMATCH");
            });
        });

        it("still blocks a date contradiction on a re-attributed slot", () => {
            const rows = [written(1, caregiverA), { ...written(2, caregiverB), serviceDate: "2026-10-03" }];
            const projection = resolveServiceRecordScheduleProjection(persisted(rows), KR_BUILTIN_CALENDAR);
            expect(projection.blockingReasons.map(({ code }) => code)).toContain("ACTUAL_DAY_CONTRADICTION");
        });

        it("still blocks when the writer is a replaced assignment and the vector names the current one", () => {
            const rows = [written(1, caregiverA), written(8, caregiverA)];
            const projection = resolveServiceRecordScheduleProjection(persisted(rows), KR_BUILTIN_CALENDAR);
            expect(projection.blockingReasons.map(({ code }) => code)).toContain("ASSIGNMENT_PROVENANCE_MISMATCH");
        });

        it("still blocks a row written by a schedule that is not an assignment of the case", () => {
            const rows = [{ ...written(2, caregiverB), scheduleId: 999 }];
            const projection = resolveServiceRecordScheduleProjection(persisted(rows), KR_BUILTIN_CALENDAR);
            expect(projection.blockingReasons.map(({ code }) => code)).toContain("ASSIGNMENT_PROVENANCE_MISMATCH");
        });

        it("still blocks when the row's employee disagrees with the current assignment's", () => {
            const rows = [{ ...written(2, caregiverB), employeeId: 99 }];
            const projection = resolveServiceRecordScheduleProjection(persisted(rows), KR_BUILTIN_CALENDAR);
            expect(projection.blockingReasons.map(({ code }) => code)).toContain("ASSIGNMENT_PROVENANCE_MISMATCH");
        });
    });

    describe("branch calendar", () => {
        const withBranchHoliday = (date: string, version: string) => createKrBusinessDayCalendar(
            [...KOREAN_HOLIDAY_CALENDAR[2026]!, date],
            { version, supportedYears: [2026] },
        );
        const baseInput = {
            draftId: "33333333-3333-4333-8333-333333333333",
            draftVersion: 1,
            sourceCaseVersion: 7,
            sourceFingerprint: "source-fingerprint",
            previewId: "preview-1",
        };

        it("skips a branch-only holiday when the suffix is shifted", () => {
            // 2026-09-16 is a Wednesday that only this branch closes.
            const branchCalendar = withBranchHoliday("2026-09-16", "kr-db-branch-a");
            const move = { sessionIndex: 4, toDate: "2026-09-15" };
            const builtin = normalizeServiceRecordEditChanges(source(), {}, {}, KR_BUILTIN_CALENDAR, move);
            expect(builtin.entries?.map(({ serviceDate }) => serviceDate)).toEqual([
                "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-15", "2026-09-16",
            ]);
            const branch = normalizeServiceRecordEditChanges(source(), {}, {}, branchCalendar, move);
            expect(branch.entries?.map(({ serviceDate }) => serviceDate)).toEqual([
                "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-15", "2026-09-17",
            ]);
        });

        it("preserves legacy session dates after a branch holiday is added", () => {
            const legacy = source({ plannedSessions: null });
            const preview = buildServiceRecordEditPreview({
                ...baseInput,
                calendar: withBranchHoliday("2026-09-09", "kr-db-legacy-revised"),
                source: legacy,
                changes: {},
            });

            expect(preview.blockingReasons.map(({ code }) => code)).not.toContain("NON_BUSINESS_DATE");
            expect(preview.blockingReasons).toEqual([]);
            expect(preview.before.sessions.map(({ serviceDate }) => serviceDate))
                .toEqual(legacy.sessions.map(({ serviceDate }) => serviceDate));
            expect(preview.after.sessions).toEqual(preview.before.sessions);
        });

        it("preserves a persisted vector after a branch holiday is added and reports the calendar version", () => {
            const builtinPreview = buildServiceRecordEditPreview({
                ...baseInput,
                calendar: KR_BUILTIN_CALENDAR,
                source: source(),
                changes: {},
            });
            expect(builtinPreview.blockingReasons).toEqual([]);
            expect(builtinPreview.calendarVersion).toBe(KR_BUILTIN_CALENDAR.version);

            // 2026-09-09 is a Wednesday inside the existing vector.
            const branchPreview = buildServiceRecordEditPreview({
                ...baseInput,
                calendar: withBranchHoliday("2026-09-09", "kr-db-branch-b"),
                source: source(),
                changes: {},
            });
            expect(branchPreview.calendarVersion).toBe("kr-db-branch-b");
            expect(branchPreview.blockingReasons).toEqual([]);
            expect(branchPreview.before.sessions).toEqual(builtinPreview.before.sessions);
        });
    });
});

describe("service-record-edit-preview.policy admin date correction", () => {
    function preview(changes: ServiceRecordEditJsonValue, src = source(), calendar = KR_BUILTIN_CALENDAR) {
        return buildServiceRecordEditPreview({
            draftId: "draft-admin-dates", draftVersion: 1, sourceCaseVersion: 7,
            sourceFingerprint: "source-fingerprint", previewId: "preview-admin-dates",
            source: src, calendar, changes,
        });
    }
    function written(index: number, locked = true) {
        const src = source();
        src.sessions = src.sessions.map((session) => session.sessionIndex === index
            ? { ...session, locked, submittedAt: locked ? null : "2026-09-11T04:00:00.000Z" }
            : session);
        return src;
    }

    it.each([
        [1, "2026-08-28", true],
        [5, "2026-09-21", false],
    ] as const)("blocks a changed written session %s outside the caregiver window", (sessionIndex, serviceDate, locked) => {
        expect(preview({ sessions: [{ sessionIndex, serviceDate }] }, written(sessionIndex, locked)).blockingReasons)
            .toContainEqual(expect.objectContaining({ code: "SERVICE_DATE_OUT_OF_RANGE", message: "고를 수 있는 기간이 아니에요.", sessionIndex }));
    });

    it.each([
        ["2026-09-12", KR_BUILTIN_CALENDAR],
        ["2026-09-17", createKrBusinessDayCalendar([...KOREAN_HOLIDAY_CALENDAR[2026]!, "2026-09-17"], {
            version: "branch-admin-dates", supportedYears: [2026],
        })],
    ] as const)("blocks a changed written session on a non-service day %s", (serviceDate, calendar) => {
        expect(preview({ sessions: [{ sessionIndex: 5, serviceDate }] }, written(5), calendar).blockingReasons)
            .toContainEqual(expect.objectContaining({ code: "NON_SERVICE_DAY", message: "서비스를 하지 않는 날이에요.", sessionIndex: 5 }));
    });

    it.each([
        ["2026-09-12", "allowSaturdayService"],
        ["2026-09-13", "allowSundayService"],
        ["2026-09-17", "allowHolidayService"],
    ] as const)("allows a written session on %s when the client's flag is on", (serviceDate, flag) => {
        const src = written(5);
        src.client[flag] = true;
        const calendar = createKrBusinessDayCalendar([...KOREAN_HOLIDAY_CALENDAR[2026]!, "2026-09-17"], {
            version: "branch-admin-dates", supportedYears: [2026],
        });
        expect(preview({ sessions: [{ sessionIndex: 5, serviceDate }] }, src, calendar).blockingReasons).toEqual([]);
    });

    it.each(["startDate", "endDate"] as const)("skips the window when %s is missing", (bound) => {
        const src = written(5);
        src[bound] = null;
        const normalized = normalizeServiceRecordEditChanges(src, {}, {}, KR_BUILTIN_CALENDAR, {
            sessionIndex: 5, toDate: "2026-09-21", shiftFollowing: false,
        });
        expect(preview(normalized.changes, src).blockingReasons).toEqual([]);
    });

    it("reports an unsupported holiday year using the existing preview fallback", () => {
        const result = preview({ sessions: [{ sessionIndex: 5, serviceDate: "2028-01-03" }] }, written(5));
        expect(result.blockingReasons).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_HOLIDAY_YEAR" }));
    });

    it("still rejects another session's date", () => {
        expect(preview({ sessions: [{ sessionIndex: 1, serviceDate: "2026-09-08" }] }, written(1)).blockingReasons)
            .toContainEqual(expect.objectContaining({ code: "DUPLICATE_SERVICE_DATE" }));
    });

    it.each(["2026-08-31", "2026-09-04"])("allows a locked session moved to a valid day %s", (serviceDate) => {
        expect(preview({ sessions: [{ sessionIndex: 1, serviceDate }] }, written(1)).blockingReasons).toEqual([]);
    });

    it("allows a written session at end plus seven", () => {
        expect(preview({ sessions: [{ sessionIndex: 5, serviceDate: "2026-09-18" }] }, written(5)).blockingReasons).toEqual([]);
    });

    it("leaves an unchanged historical non-service day alone", () => {
        const src = written(5);
        src.sessions[4]!.serviceDate = "2026-09-12";
        (src.plannedSessions as Array<{ serviceDate: string }>)[4]!.serviceDate = "2026-09-12";
        expect(preview({ sessions: [{ sessionIndex: 5, notes: "메모" }] }, src).blockingReasons).toEqual([]);
    });

    it("allows a schedule draft to plan beyond end plus seven", () => {
        const dates = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-21"];
        const normalized = normalizeServiceRecordEditChanges(source(), {}, {}, KR_BUILTIN_CALENDAR, undefined, {
            serviceDays: { saturday: false, sunday: false, holiday: false }, dates,
        });
        expect(preview(normalized.changes).blockingReasons).toEqual([]);
    });

    it("keeps a schedule draft exempt when a later dateMove goes beyond end plus seven", () => {
        const scheduled = normalizeServiceRecordEditChanges(source(), {}, {}, KR_BUILTIN_CALENDAR, undefined, {
            serviceDays: { saturday: false, sunday: false, holiday: false },
            dates: ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"],
        });
        const moved = normalizeServiceRecordEditChanges(source(), scheduled.changes, {}, KR_BUILTIN_CALENDAR, {
            sessionIndex: 5, toDate: "2026-09-21", shiftFollowing: false,
        });
        expect(preview(moved.changes).blockingReasons).toEqual([]);
    });

    it("checks a shifted written follower against the window", () => {
        const src = written(5);
        const normalized = normalizeServiceRecordEditChanges(src, {}, {}, KR_BUILTIN_CALENDAR, {
            sessionIndex: 1, toDate: "2026-09-18", shiftFollowing: true,
        });
        expect(preview(normalized.changes, src).blockingReasons).toContainEqual(expect.objectContaining({
            code: "SERVICE_DATE_OUT_OF_RANGE", sessionIndex: 5,
        }));
    });

    it("allows a dateMove to shift an unwritten follower beyond end plus seven", () => {
        const src = written(1);
        const normalized = normalizeServiceRecordEditChanges(src, {}, {}, KR_BUILTIN_CALENDAR, {
            sessionIndex: 1, toDate: "2026-09-18", shiftFollowing: true,
        });
        expect(normalized.entries?.at(-1)?.serviceDate).toBe("2026-09-28");
        expect(preview(normalized.changes, src).blockingReasons).toEqual([]);
    });
});

describe("service-record-edit-preview.policy service-day schedule replacement", () => {
    // Source dates are Mon 2026-09-07 .. Fri 2026-09-11. 2026-09-12 is a Saturday, 09-13 a Sunday.
    const off = { saturday: false, sunday: false, holiday: false };
    const saturdayOn = { saturday: true, sunday: false, holiday: false };
    const baseInput = {
        draftId: "33333333-3333-4333-8333-333333333333",
        draftVersion: 1,
        sourceCaseVersion: 7,
        sourceFingerprint: "source-fingerprint",
        previewId: "preview-1",
    };
    const weekdayDates = ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"];
    const withSaturday = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-11", "2026-09-12"];

    function replace(
        dates: string[],
        serviceDays = off,
        src: ServiceRecordEditSource = source(),
        previous: ServiceRecordEditJsonValue = {},
    ) {
        return normalizeServiceRecordEditChanges(src, previous, {}, KR_BUILTIN_CALENDAR, undefined, { serviceDays, dates });
    }
    function codeOf(run: () => unknown): string | undefined {
        try {
            run();
        } catch (error) {
            if (error instanceof ServiceRecordScheduleValidationError) return error.code;
            throw error;
        }
        return undefined;
    }
    function previewOf(src: ServiceRecordEditSource, changes: ServiceRecordEditJsonValue) {
        return buildServiceRecordEditPreview({ ...baseInput, calendar: KR_BUILTIN_CALENDAR, source: src, changes });
    }
    const lockedSource = (indexes: number[]) => {
        const base = source();
        return source({
            sessions: base.sessions.map((session) => (indexes.includes(session.sessionIndex)
                ? { ...session, locked: true, submittedAt: "2026-09-08T04:00:00.000Z" }
                : session)),
        });
    };

    it("replaces every date at once, keeps provenance and binds the toggles into the preview", () => {
        const normalized = replace(withSaturday, saturdayOn);
        expect(normalized.changes["serviceDays"]).toEqual(saturdayOn);
        expect((normalized.changes["sessions"] as Array<Record<string, unknown>>).map((entry) => entry["serviceDate"]))
            .toEqual(withSaturday);
        const original = source().plannedSessions as Array<Record<string, unknown>>;
        for (const [index, entry] of (normalized.entries ?? []).entries()) {
            expect(entry).toMatchObject({
                sessionIndex: index + 1,
                originalDate: original[index]!["originalDate"],
                assignmentId: original[index]!["assignmentId"],
                scheduleId: original[index]!["scheduleId"],
                employeeId: original[index]!["employeeId"],
                provenanceVersion: original[index]!["provenanceVersion"],
            });
        }

        const preview = previewOf(source(), normalized.changes);
        expect(preview.blockingReasons).toEqual([]);
        expect(preview.serviceDays).toEqual({ before: off, after: saturdayOn });
        expect(preview.calendarVersion).toBe(`${KR_BUILTIN_CALENDAR.version}+sd-100`);
        expect(preview.after.sessions.map(({ serviceDate }) => serviceDate)).toEqual(withSaturday);
        expect(preview.before.sessions.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
        ]);
        const plain = previewOf(source(), {});
        expect(plain.calendarVersion).toBe(KR_BUILTIN_CALENDAR.version);
        expect("serviceDays" in plain).toBe(false);
        expect(preview.previewId).toBe("preview-1");
        expect(preview.calendarVersion).not.toBe(plain.calendarVersion);
    });

    it("rejects a count other than N", () => {
        expect(codeOf(() => replace(weekdayDates.slice(0, 4)))).toBe("SCHEDULE_COUNT_MISMATCH");
        expect(codeOf(() => replace([...weekdayDates, "2026-09-15"]))).toBe("SCHEDULE_COUNT_MISMATCH");
    });

    it("never sorts silently: descending, duplicate and malformed dates use the shared vector codes", () => {
        expect(codeOf(() => replace(["2026-09-09", "2026-09-08", "2026-09-10", "2026-09-11", "2026-09-14"])))
            .toBe("INVERTED_SERVICE_DATES");
        expect(codeOf(() => replace(["2026-09-08", "2026-09-09", "2026-09-09", "2026-09-11", "2026-09-14"])))
            .toBe("DUPLICATE_SERVICE_DATE");
        expect(codeOf(() => replace(["2026-09-08", "2026-09-09", "2026-09-31", "2026-09-11", "2026-09-14"])))
            .toBe("INVALID_DATE");
    });

    it("rejects a date before the service start", () => {
        expect(codeOf(() => replace(["2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"])))
            .toBe("SCHEDULE_BEFORE_START");
    });

    it("accepts a Saturday only when Saturday service is on, naming the session otherwise", () => {
        let thrown: unknown;
        try {
            replace(withSaturday, off);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toMatchObject({ code: "NON_SERVICE_DAY", sessionIndex: 5 });
        expect(() => replace(withSaturday, saturdayOn)).not.toThrow();
        // Sunday needs its own toggle, and a holiday weekday needs the holiday toggle.
        const sunday = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-11", "2026-09-13"];
        expect(codeOf(() => replace(sunday, saturdayOn))).toBe("NON_SERVICE_DAY");
        expect(() => replace(sunday, { saturday: false, sunday: true, holiday: false })).not.toThrow();
        const chuseok = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-28"];
        expect(codeOf(() => replace(chuseok, off))).toBe("NON_SERVICE_DAY");
        expect(() => replace(chuseok, { saturday: false, sunday: false, holiday: true })).not.toThrow();
    });

    it("lets the draft's toggles override the client's stored ones, and falls back to them", () => {
        const saturdayClient = source();
        saturdayClient.client.allowSaturdayService = true;
        expect(storedServiceDays(saturdayClient)).toEqual(saturdayOn);
        expect(pendingServiceDays(saturdayClient, {})).toEqual(saturdayOn);
        expect(pendingServiceDays(saturdayClient, { serviceDays: off })).toEqual(off);
        expect(draftServiceDays({ serviceDays: { saturday: true } })).toBeNull();
        expect(() => replace(withSaturday, saturdayOn, saturdayClient)).not.toThrow();
        expect(codeOf(() => replace(withSaturday, off, saturdayClient))).toBe("NON_SERVICE_DAY");
    });

    it("does not judge a written session's date (historical dates stay valid)", () => {
        const base = source();
        const historic = source({
            sessions: base.sessions.map((session) => (session.sessionIndex === 5
                ? { ...session, serviceDate: "2026-09-12", locked: true, submittedAt: "2026-09-12T04:00:00.000Z" }
                : session)),
            plannedSessions: (base.plannedSessions as Array<Record<string, unknown>>).map((entry) => (
                entry["sessionIndex"] === 5 ? { ...entry, serviceDate: "2026-09-12" } : entry)) as ServiceRecordEditJsonValue,
        });
        // Saturday 09-12 is written at session 5 with Saturday off; only sessions 1-4 move.
        const normalized = replace(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"], off, historic);
        expect(previewOf(historic, normalized.changes).blockingReasons).toEqual([]);
    });

    describe("an unchanged date is judged against the pending policy unless written history fixes it", () => {
        // Mon 2026-12-14 ... ; 2026-12-12 and 2026-12-19 are Saturdays.
        const december = (dates: string[], writtenIndexes: number[], saturdayClient = false) => {
            const days = source();
            const decemberAssignment = {
                ...assignment,
                startDate: dates[0]!,
                endDate: dates.at(-1)!,
                scheduleStartDate: dates[0]!,
                scheduleEndDate: dates.at(-1)!,
            };
            const result = source({
                startDate: dates[0]!,
                endDate: dates.at(-1)!,
                assignments: [decemberAssignment],
                sessions: days.sessions.map((session, index) => ({
                    ...session,
                    serviceDate: dates[index]!,
                    ...(writtenIndexes.includes(session.sessionIndex)
                        ? { locked: true, submittedAt: "2026-12-01T04:00:00.000Z" }
                        : {}),
                })),
                plannedSessions: dates.map((serviceDate, index) => ({
                    sessionIndex: index + 1,
                    serviceDate,
                    originalDate: serviceDate,
                    assignmentId: assignment.id,
                    scheduleId: assignment.scheduleId,
                    employeeId: assignment.employeeId,
                    provenanceVersion: "case-7",
                })) as ServiceRecordEditJsonValue,
            });
            result.client.startDate = dates[0]!;
            result.client.endDate = dates.at(-1)!;
            if (saturdayClient) result.client.allowSaturdayService = true;
            return result;
        };
        const unwrittenSaturday = ["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-18", "2026-12-19"];
        const keepAll = (dates: string[]) => dates.map((serviceDate, index) => ({ sessionIndex: index + 1, serviceDate }));

        it("refuses to turn Saturday off while an unwritten session past the written ones is still on it", () => {
            const src = december(unwrittenSaturday, [1, 2, 3], true);
            expect(() => replace(unwrittenSaturday, saturdayOn, src)).not.toThrow();
            expect(codeOf(() => replace(unwrittenSaturday, off, src))).toBe("NON_SERVICE_DAY");
        });

        it("blocks a stored draft that keeps a Saturday session after Saturday was switched off", () => {
            const src = december(unwrittenSaturday, [1, 2, 3], true);
            // Built directly from stored changes, not through a save helper that would throw first.
            const preview = previewOf(src, { serviceDays: off, sessions: keepAll(unwrittenSaturday) });
            expect(preview.blockingReasons).toEqual([
                expect.objectContaining({ code: "NON_SERVICE_DAY", sessionIndex: 5 }),
            ]);
        });

        it("keeps an unchanged Saturday date allowed up to the last written date", () => {
            const dates = ["2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-14"];
            const src = december(dates, [5], true);
            const normalized = replace(dates, off, src);
            expect(previewOf(src, normalized.changes).blockingReasons).toEqual([]);
        });

        it("refuses a changed date moved into the fixed region onto a day that is now off", () => {
            const dates = ["2026-12-09", "2026-12-10", "2026-12-11", "2026-12-14", "2026-12-16"];
            const src = december(dates, [5], true);
            const moved = ["2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-16"];
            expect(() => replace(moved, saturdayOn, src)).not.toThrow();
            expect(codeOf(() => replace(moved, off, src))).toBe("NON_SERVICE_DAY");
        });

        it("reports nothing for an all-weekday schedule submitted unchanged with every toggle off", () => {
            const normalized = replace(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"], off);
            expect(previewOf(source(), normalized.changes).blockingReasons).toEqual([]);
        });
    });

    describe("the preview payload for a default (all-false) client", () => {
        // The pre-feature payload shape, in its original key order.
        const baseKeys = [
            "previewId", "draftId", "draftVersion", "sourceCaseVersion", "sourceFingerprint",
            "requiredSessionCount", "calendarVersion", "before", "after", "provenance",
            "contentChanges", "impactedAssignments", "impactedAssignmentDetails",
            "blockingReasons", "signatureMetadata", "documentScope",
        ];

        // Independent oracle: these hashes were produced ONCE by running the BASE builder
        // (`git show 246bf74c0:backend/application/policies/service-record-edit-preview.policy.ts`,
        // copied outside the tree's tracked files) on the same fixtures, then hashing
        // `previewId`-less output exactly as admin-service-record-edit.service.ts does
        // (sha256 over stableStringify(JSON value, keys sorted)). They are not derived from
        // the code under test, so any change to the default payload (a key, a value) fails.
        const stable = (value: unknown): string => {
            if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
            if (value && typeof value === "object") {
                return `{${Object.entries(value as Record<string, unknown>)
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
                    .join(",")}}`;
            }
            return JSON.stringify(value);
        };
        const hashOf = (preview: Record<string, unknown>) => {
            const { previewId: _ignored, ...rest } = preview;
            void _ignored;
            return createHash("sha256").update(stable(JSON.parse(JSON.stringify(rest)))).digest("hex");
        };
        const baseDraftInput = { ...baseInput, previewId: "pending" };
        const baseHashes: Array<[string, ServiceRecordEditJsonValue, string]> = [
            ["default (no change)", {}, "2419e0dcdc753dfdc94070cd5dd0664f8f5d1034c6bd82e84dff8495e7a27646"],
            [
                "non-schedule dateMove (session 3 to 09-10, following shifted)",
                {
                    sessions: [
                        { sessionIndex: 3, serviceDate: "2026-09-10" },
                        { sessionIndex: 4, serviceDate: "2026-09-11" },
                        { sessionIndex: 5, serviceDate: "2026-09-14" },
                    ],
                },
                "aa306700093975609487b884d6f93ab2c446d1e1f678f690d91ada71e65ffb5b",
            ],
        ];

        it.each(baseHashes)("omits serviceDays and matches the pre-feature base payload hash: %s", (_name, changes, expectedHash) => {
            const plain = buildServiceRecordEditPreview({
                ...baseDraftInput, calendar: KR_BUILTIN_CALENDAR, source: source(), changes,
            });
            expect("serviceDays" in plain).toBe(false);
            expect(Object.keys(plain)).toEqual(baseKeys);
            expect(plain.calendarVersion).toBe(KR_BUILTIN_CALENDAR.version);
            expect(hashOf(plain as unknown as Record<string, unknown>)).toBe(expectedHash);
        });

        it("still carries serviceDays for a schedule draft and for a client with stored toggles", () => {
            expect(previewOf(source(), { serviceDays: off }).serviceDays).toEqual({ before: off, after: off });
            const saturdayClient = source();
            saturdayClient.client.allowSaturdayService = true;
            expect(previewOf(saturdayClient, {}).serviceDays).toEqual({ before: saturdayOn, after: saturdayOn });
        });
    });

    it("checks unwritten non-service days only for a schedule replacement draft", () => {
        // A plain date snapshot of an unwritten session is still a plan date.
        const plain = previewOf(source(), { sessions: [{ sessionIndex: 5, serviceDate: "2026-09-12" }] });
        expect(plain.blockingReasons).toEqual([]);
        const replaced = previewOf(source(), {
            serviceDays: off,
            sessions: [{ sessionIndex: 5, serviceDate: "2026-09-12" }],
        });
        expect(replaced.blockingReasons).toEqual([
            expect.objectContaining({ code: "NON_SERVICE_DAY", sessionIndex: 5 }),
        ]);
    });

    it("re-checks a replacement against the preview's own policy", () => {
        const dates = ["2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"];
        const preview = previewOf(source(), {
            serviceDays: off,
            sessions: dates.map((serviceDate, index) => ({ sessionIndex: index + 1, serviceDate })),
        });
        expect(preview.blockingReasons.map(({ code }) => code)).toEqual(["SCHEDULE_BEFORE_START"]);
    });

    it("keeps a locked or submitted session's date fixed for a replacement", () => {
        const locked = lockedSource([1]);
        expect(codeOf(() => replace(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"], off, locked)))
            .toBe("LOCKED_SESSION_DATE_CHANGED");
        const kept = replace(["2026-09-07", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"], off, locked);
        expect(previewOf(locked, kept.changes).blockingReasons).toEqual([]);
        // submittedAt alone locks the date too.
        const submitted = source({
            sessions: source().sessions.map((session) => (session.sessionIndex === 2
                ? { ...session, submittedAt: "2026-09-08T04:00:00.000Z" }
                : session)),
        });
        expect(codeOf(() => replace(["2026-09-07", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"], off, submitted)))
            .toBe("LOCKED_SESSION_DATE_CHANGED");
    });

    it("lets a date move change a locked or submitted session, as before schedule replacement", () => {
        expect(() => normalizeServiceRecordEditChanges(
            lockedSource([1]), {}, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 1, toDate: "2026-09-04", shiftFollowing: false },
        )).not.toThrow();
        // A suffix move drags every later session along, including a locked one.
        expect(() => normalizeServiceRecordEditChanges(
            lockedSource([4]), {}, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 2, toDate: "2026-09-09" },
        )).not.toThrow();
        expect(() => normalizeServiceRecordEditChanges(
            lockedSource([1]), {}, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 3, toDate: "2026-09-11" },
        )).not.toThrow();
    });

    it("blocks the preview when a locked session's date was changed in a stored schedule draft", () => {
        const preview = previewOf(lockedSource([1]), { serviceDays: off, sessions: [{ sessionIndex: 1, serviceDate: "2026-09-04" }] });
        expect(preview.blockingReasons).toEqual([
            expect.objectContaining({ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 1 }),
        ]);
    });

    it("does not block the preview of a date-move draft that changed a locked session's date", () => {
        const preview = previewOf(lockedSource([1]), { sessions: [{ sessionIndex: 1, serviceDate: "2026-09-04" }] });
        expect(preview.blockingReasons.map(({ code }) => code)).not.toContain("LOCKED_SESSION_DATE_CHANGED");
    });

    it("carries the toggles through later saves and applies them to a later date move", () => {
        const first = replace(withSaturday, saturdayOn);
        const header = normalizeServiceRecordEditChanges(source(), first.changes, { header: { momName: "수정" } }, KR_BUILTIN_CALENDAR);
        expect(header.changes["serviceDays"]).toEqual(saturdayOn);
        expect((header.changes["sessions"] as Array<Record<string, unknown>>).map((entry) => entry["serviceDate"]))
            .toEqual(withSaturday);
        expect(header.changes["header"]).toEqual({ momName: "수정" });

        // The pending Saturday toggle lets a later move land on a Saturday.
        const moved = normalizeServiceRecordEditChanges(
            source(), first.changes, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 5, toDate: "2026-09-12", shiftFollowing: false },
        );
        expect(moved.changes["serviceDays"]).toEqual(saturdayOn);
        expect(() => normalizeServiceRecordEditChanges(
            source(), {}, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 5, toDate: "2026-09-12", shiftFollowing: false },
        )).toThrow();
    });

    it("never takes service days from the client-sent changes", () => {
        const normalized = normalizeServiceRecordEditChanges(
            source(), {}, { header: { momName: "수정" }, serviceDays: saturdayOn } as unknown as ServiceRecordEditJsonValue, KR_BUILTIN_CALENDAR,
        );
        expect(normalized.changes["serviceDays"]).toBeUndefined();
    });

    it("surfaces a date in an unpopulated year as the shared unsupported-year error", () => {
        expect(() => replace(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2028-01-03"]))
            .toThrow(UnsupportedKoreanHolidayYearError);
        const preview = previewOf(source(), {
            serviceDays: off,
            sessions: [{ sessionIndex: 5, serviceDate: "2028-01-03" }],
        });
        expect(preview.blockingReasons.map(({ code }) => code)).toEqual(["UNSUPPORTED_HOLIDAY_YEAR"]);
    });
});

describe("service-record-edit-preview.policy resume replan", () => {
    // The real incident, with synthetic ids: service from 2026-10-01 with caregiver A, paused
    // 10-02..10-13, resumed 10-14 with caregiver B. KR holidays in range: 10-03, 10-05, 10-09.
    const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
    const CASE_ID = "22222222-2222-4222-8222-222222222222";
    const OLD_DATES = [
        "2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13",
        "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
    ];
    // Written down by hand from the calendar, not computed with the code under test.
    const NEW_DATES = [
        "2026-10-01", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21",
        "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02",
    ];
    const baseInput = {
        draftId: "33333333-3333-4333-8333-333333333333",
        draftVersion: 1,
        sourceCaseVersion: 7,
        sourceFingerprint: "source-fingerprint",
        previewId: "preview-1",
    };
    const golden = { fromSessionIndex: 2, resumeDate: "2026-10-14" };

    function assignmentRow(overrides: Record<string, unknown>) {
        return {
            branchId: BRANCH_ID,
            serviceRecordCaseId: CASE_ID,
            scheduleTerminatedAt: null,
            secondaryEmployeeId: null,
            ...overrides,
        };
    }

    function goldenSource(overrides: Partial<ServiceRecordEditSource> = {}): ServiceRecordEditSource {
        const owner = (index: number) => (index === 1
            ? { id: A_ID, scheduleId: 55, employeeId: 9 }
            : { id: B_ID, scheduleId: 56, employeeId: 10 });
        return {
            caseId: CASE_ID,
            caseVersion: 7,
            formVersion: 3,
            caseLifecycle: {
                status: "IN_PROGRESS",
                completedAt: null,
                finalizationDueAt: "2026-10-23T11:00:00.000Z",
                finalizationStartedAt: null,
                finalizedAt: null,
                documentsCompletedAt: null,
            },
            requiredSessionCount: 15,
            startDate: "2026-10-01",
            endDate: "2026-10-23",
            header: {
                momName: "산모", momBirth: "900101", babyName: "아기", babyBirth: "260901", deliveryType: "자연분만", babyWeight: "3.2",
            },
            // Every row is locked and submitted at 18:00 KST on the date it is about to get.
            sessions: OLD_DATES.map((serviceDate, offset) => ({
                id: `day-${offset + 1}`,
                branchId: BRANCH_ID,
                sourceRowId: `day-${offset + 1}`,
                scheduleId: owner(offset + 1).scheduleId,
                sessionIndex: offset + 1,
                rawCaseSessionIndex: offset + 1,
                rawSessionIndex: offset + 1,
                ambiguous: false,
                serviceDate,
                answers: { bath: "실시" },
                etcService: null,
                notes: `메모 ${offset + 1}`,
                paymentConfirmed: false,
                momApproval: "approved",
                clientSignature: "signature",
                clientSignedAt: `${NEW_DATES[offset]}T09:00:00.000Z`,
                locked: true,
                submittedAt: `${NEW_DATES[offset]}T09:00:00.000Z`,
                employeeId: owner(offset + 1).employeeId,
                employeeNameSnapshot: offset === 0 ? "관리사A" : "관리사B",
                formVersion: 3,
            })),
            assignments: [
                assignmentRow({
                    id: A_ID, scheduleId: 55, employeeId: 9, startDate: "2026-10-01", endDate: "2026-10-14", replaced: true,
                    employeeName: "관리사A", scheduleStartDate: "2026-10-01", scheduleEndDate: "2026-10-14", primaryEmployeeId: 9,
                    primaryEmployeeName: "관리사A",
                }),
                assignmentRow({
                    id: B_ID, scheduleId: 56, employeeId: 10, startDate: "2026-10-14", endDate: "2026-10-23", replaced: false,
                    employeeName: "관리사B", scheduleStartDate: "2026-10-14", scheduleEndDate: "2026-10-23", primaryEmployeeId: 10,
                    primaryEmployeeName: "관리사B",
                }),
            ] as ServiceRecordEditSource["assignments"],
            plannedSessions: OLD_DATES.map((serviceDate, offset) => ({
                sessionIndex: offset + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: owner(offset + 1).id,
                scheduleId: owner(offset + 1).scheduleId,
                employeeId: owner(offset + 1).employeeId,
                provenanceVersion: "case-7",
            })),
            client: {
                id: 101,
                branchId: BRANCH_ID,
                name: "산모",
                duration: 15,
                startDate: "2026-10-01",
                endDate: "2026-10-23",
                serviceStatus: "in_progress",
                allowSaturdayService: false,
                allowSundayService: false,
                allowHolidayService: false,
            },
            ...overrides,
        };
    }

    /** One caregiver owns every session: a pause without a replacement. */
    function pauseSource(): ServiceRecordEditSource {
        const base = goldenSource();
        return {
            ...base,
            sessions: base.sessions.map((session) => ({ ...session, scheduleId: 56, employeeId: 10 })),
            assignments: [{ ...base.assignments[1]!, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" }],
            plannedSessions: OLD_DATES.map((serviceDate, offset) => ({
                sessionIndex: offset + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: B_ID,
                scheduleId: 56,
                employeeId: 10,
                provenanceVersion: "case-7",
            })),
        };
    }

    /** The golden vector (session 1 -> A, 2..15 -> B) with both caregivers live: an authoritative split. */
    function liveSplitSource(): ServiceRecordEditSource {
        const base = goldenSource();
        return { ...base, assignments: base.assignments.map((assignment) => ({ ...assignment, replaced: false })) };
    }

    const resumeOf = (
        src: ServiceRecordEditSource,
        resumeReplan: { fromSessionIndex: number; resumeDate: string; outgoingLastServedDate?: string; incomingAssignmentId?: string },
        previous: ServiceRecordEditJsonValue = {},
        incoming: ServiceRecordEditJsonValue = {},
        calendar = KR_BUILTIN_CALENDAR,
    ) => normalizeServiceRecordEditChanges(src, previous, incoming, calendar, undefined, undefined, resumeReplan);
    const previewOf = (src: ServiceRecordEditSource, changes: ServiceRecordEditJsonValue, calendar = KR_BUILTIN_CALENDAR) =>
        buildServiceRecordEditPreview({ ...baseInput, calendar, source: src, changes });
    function codeOf(run: () => unknown): string | undefined {
        try {
            run();
        } catch (error) {
            if (error instanceof ServiceRecordScheduleValidationError) return error.code;
            throw error;
        }
        return undefined;
    }
    const dates = (entries: Array<{ serviceDate: string }> | null | undefined) => entries?.map((entry) => entry.serviceDate);

    describe("the golden incident", () => {
        it("re-plans sessions 2..15 onto consecutive business days and keeps everything else", () => {
            const normalized = resumeOf(goldenSource(), golden);
            expect(dates(normalized.entries)).toEqual(NEW_DATES);
            expect(normalized.entries?.map((entry) => entry.originalDate)).toEqual(OLD_DATES);
            expect(normalized.entries?.map((entry) => entry.assignmentId)).toEqual(
                goldenSource().plannedSessions && (goldenSource().plannedSessions as Array<{ assignmentId: string }>).map((entry) => entry.assignmentId),
            );
            expect(normalized.changes["resumeReplan"]).toEqual(golden);
            expect(normalized.changes["serviceDays"]).toBeUndefined();
            // Only the re-planned sessions carry an override; session 1 stays untouched.
            expect(normalized.changes["sessions"]).toEqual(
                NEW_DATES.slice(1).map((serviceDate, offset) => ({ sessionIndex: offset + 2, serviceDate })),
            );
        });

        it("previews the boundary and warns about nothing", () => {
            const changes = resumeOf(goldenSource(), golden).changes;
            const preview = previewOf(goldenSource(), changes);
            expect(preview.blockingReasons).toEqual([]);
            expect(preview.warnings).toEqual([]);
            expect(dates(preview.after.sessions)).toEqual(NEW_DATES);
            expect(preview.before.endDate).toBe("2026-10-23");
            expect(preview.after.endDate).toBe("2026-11-02");
            expect(preview.assignmentPeriods).toEqual([
                {
                    assignmentId: A_ID,
                    employeeName: "관리사A",
                    before: { startDate: "2026-10-01", endDate: "2026-10-14" },
                    after: { startDate: "2026-10-01", endDate: "2026-10-01" },
                },
                {
                    assignmentId: B_ID,
                    employeeName: "관리사B",
                    before: { startDate: "2026-10-14", endDate: "2026-10-23" },
                    after: { startDate: "2026-10-14", endDate: "2026-11-02" },
                },
            ]);
            // The locked and submitted sessions move without LOCKED_SESSION_DATE_CHANGED.
            expect(preview.blockingReasons.map(({ code }) => code)).not.toContain("LOCKED_SESSION_DATE_CHANGED");
        });

        it("derives the confirm's assignment writes with the same function", () => {
            const resolution = resolveResumeReplan(goldenSource(), resumeOf(goldenSource(), golden).changes, KR_BUILTIN_CALENDAR);
            expect(resolution?.reasons).toEqual([]);
            expect(resolution?.plan?.endDate).toBe("2026-11-02");
            expect(resolution?.plan?.assignmentWrites).toEqual([
                { assignmentId: A_ID, scheduleId: 55, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: true },
                { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-14", endDate: "2026-11-02", datesChanged: true },
            ]);
        });

        it("is not blocked at READY_TO_FINALIZE or AWAITING_COMPLETION", () => {
            const changes = resumeOf(goldenSource(), golden).changes;
            for (const status of ["READY_TO_FINALIZE", "AWAITING_COMPLETION", "IN_PROGRESS"]) {
                const src = goldenSource();
                src.caseLifecycle = { ...src.caseLifecycle, status };
                expect(previewOf(src, changes).blockingReasons).toEqual([]);
            }
        });

        it.each(["FINALIZING", "FINALIZATION_FAILED", "DOCUMENTS_CREATED", "COMPLETED"])(
            "blocks a %s case with CASE_FINALIZED",
            (status) => {
                const src = goldenSource();
                src.caseLifecycle = { ...src.caseLifecycle, status };
                const preview = previewOf(src, resumeOf(goldenSource(), golden).changes);
                expect(preview.blockingReasons.map(({ code }) => code)).toEqual(["CASE_FINALIZED"]);
            },
        );
    });

    describe("assignment boundary", () => {
        it("moves only the end of the one caregiver when a pause has no replacement", () => {
            const normalized = resumeOf(pauseSource(), golden);
            expect(dates(normalized.entries)).toEqual(NEW_DATES);
            const resolution = resolveResumeReplan(pauseSource(), normalized.changes, KR_BUILTIN_CALENDAR);
            expect(resolution?.plan?.assignmentWrites).toEqual([
                { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-01", endDate: "2026-11-02", datesChanged: true },
            ]);
            expect(resolution?.plan?.assignmentPeriods).toEqual([{
                assignmentId: B_ID,
                employeeName: "관리사B",
                before: { startDate: "2026-10-01", endDate: "2026-10-23" },
                after: { startDate: "2026-10-01", endDate: "2026-11-02" },
            }]);
        });

        it("uses a valid outgoingLastServedDate for the outgoing end", () => {
            const input = { ...golden, outgoingLastServedDate: "2026-10-08" };
            const resolution = resolveResumeReplan(goldenSource(), resumeOf(goldenSource(), input).changes, KR_BUILTIN_CALENDAR);
            expect(resolution?.plan?.assignmentWrites[0]).toMatchObject({ assignmentId: A_ID, startDate: "2026-10-01", endDate: "2026-10-08" });
            expect(resumeOf(goldenSource(), input).changes["resumeReplan"]).toEqual(input);
        });

        it.each([
            ["before the last kept session", "2026-09-30"],
            ["on the first re-planned date", "2026-10-14"],
            ["after the first re-planned date", "2026-10-20"],
        ])("rejects an outgoingLastServedDate %s", (_label, outgoingLastServedDate) => {
            expect(codeOf(() => resumeOf(goldenSource(), { ...golden, outgoingLastServedDate })))
                .toBe("OUTGOING_LAST_SERVED_OUT_OF_RANGE");
        });

        it("rejects an outgoingLastServedDate from session 1 and when the caregiver does not change", () => {
            expect(codeOf(() => resumeOf(goldenSource(), { fromSessionIndex: 1, resumeDate: "2026-10-02", outgoingLastServedDate: "2026-10-01" })))
                .toBe("OUTGOING_LAST_SERVED_OUT_OF_RANGE");
            expect(codeOf(() => resumeOf(pauseSource(), { ...golden, outgoingLastServedDate: "2026-10-08" })))
                .toBe("OUTGOING_LAST_SERVED_OUT_OF_RANGE");
        });

        it("follows the outer-edge rule from session 1 for a persisted split between live caregivers", () => {
            const input = { fromSessionIndex: 1, resumeDate: "2026-10-02" };
            const normalized = resumeOf(liveSplitSource(), input);
            expect(normalized.entries?.[0]?.serviceDate).toBe("2026-10-02");
            expect(normalized.entries?.at(-1)?.serviceDate).toBe("2026-10-26");
            const resolution = resolveResumeReplan(liveSplitSource(), normalized.changes, KR_BUILTIN_CALENDAR);
            // The first assignment starts on the new first date, the last ends on the new last date.
            expect(resolution?.plan?.assignmentWrites).toEqual([
                { assignmentId: A_ID, scheduleId: 55, startDate: "2026-10-02", endDate: "2026-10-14", datesChanged: true },
                { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-14", endDate: "2026-10-26", datesChanged: true },
            ]);
        });

        it("keeps the first start for a later session", () => {
            const resolution = resolveResumeReplan(goldenSource(), resumeOf(goldenSource(), golden).changes, KR_BUILTIN_CALENDAR);
            expect(resolution?.plan?.assignmentWrites[0]).toMatchObject({ assignmentId: A_ID, startDate: "2026-10-01" });
        });

        it("leaves every other assignment untouched", () => {
            const src = goldenSource();
            const third = assignmentRow({
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", scheduleId: 57, employeeId: 11, startDate: "2026-08-01",
                endDate: "2026-08-02", replaced: true, employeeName: "관리사C", scheduleStartDate: "2026-08-01",
                // The two tables disagree: a confirm for any other change would re-sync them.
                scheduleEndDate: "2026-08-05", primaryEmployeeId: 11, primaryEmployeeName: "관리사C",
            }) as ServiceRecordEditSource["assignments"][number];
            src.assignments = [third, ...src.assignments];
            const resolution = resolveResumeReplan(src, resumeOf(src, golden).changes, KR_BUILTIN_CALENDAR);
            expect(resolution?.plan?.assignmentWrites.find((write) => write.assignmentId === third.id))
                .toMatchObject({ datesChanged: false });
            expect(resolution?.plan?.assignmentPeriods.map(({ assignmentId }) => assignmentId)).toEqual([A_ID, B_ID]);
        });

        it("refuses a replan that spans more than one assignment from a later session", () => {
            // Session 1 -> A, 2..8 -> B, 9..15 -> C: re-planning from 2 would cross the B/C handover.
            const src = goldenSource();
            const planned = src.plannedSessions as Array<Record<string, unknown>>;
            src.plannedSessions = planned.map((entry) => (
                (entry["sessionIndex"] as number) >= 9 ? { ...entry, assignmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", scheduleId: 57, employeeId: 11 } : entry
            )) as never;
            src.assignments = [...src.assignments, assignmentRow({
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", scheduleId: 57, employeeId: 11, startDate: "2026-10-15", endDate: "2026-10-23",
                replaced: false, employeeName: "관리사C", scheduleStartDate: "2026-10-15", scheduleEndDate: "2026-10-23",
                primaryEmployeeId: 11, primaryEmployeeName: "관리사C",
            }) as ServiceRecordEditSource["assignments"][number]];
            src.sessions = src.sessions.map((session) => (session.sessionIndex >= 9 ? { ...session, scheduleId: 57, employeeId: 11 } : session));
            // Two live caregivers follow A, so the caller has to choose: both are listed.
            expect(codeOf(() => resumeOf(src, golden))).toBe("INCOMING_ASSIGNMENT_REQUIRED");
            expect(() => resumeOf(src, golden)).toThrow(ServiceRecordResumeAssignmentError);
            try {
                resumeOf(src, golden);
            } catch (error) {
                expect((error as ServiceRecordResumeAssignmentError).candidates).toEqual([
                    { assignmentId: B_ID, employeeName: "관리사B" },
                    { assignmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", employeeName: "관리사C" },
                ]);
            }
            // With an explicit choice the re-planned sessions go to that caregiver, except the ones C already wrote.
            const chosen = resumeOf(src, { ...golden, incomingAssignmentId: B_ID });
            expect(chosen.entries?.map((entry) => entry.assignmentId)).toEqual([
                A_ID,
                ...Array<string>(7).fill(B_ID),
                ...Array<string>(7).fill("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
            ]);
        });
    });

    describe("handover to the incoming caregiver", () => {
        const C_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        const D_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

        /**
         * Resume day: only session 1 is written (by A) and the persisted vector still gives every
         * session to A, because the replacement flow never rewrites it. B took over on 10-14.
         */
        function resumeDaySource(): ServiceRecordEditSource {
            const base = goldenSource();
            return {
                ...base,
                sessions: base.sessions.slice(0, 1),
                plannedSessions: OLD_DATES.map((serviceDate, offset) => ({
                    sessionIndex: offset + 1,
                    serviceDate,
                    originalDate: serviceDate,
                    assignmentId: A_ID,
                    scheduleId: 55,
                    employeeId: 9,
                    provenanceVersion: "case-7",
                })),
            };
        }
        const extraAssignment = (id: string, scheduleId: number, overrides: Record<string, unknown> = {}) => assignmentRow({
            id, scheduleId, employeeId: scheduleId + 100, startDate: "2026-10-14", endDate: "2026-10-23", replaced: false,
            employeeName: `관리사${scheduleId}`, scheduleStartDate: "2026-10-14", scheduleEndDate: "2026-10-23",
            primaryEmployeeId: scheduleId + 100, primaryEmployeeName: `관리사${scheduleId}`, ...overrides,
        }) as ServiceRecordEditSource["assignments"][number];
        const owners = (entries: Array<{ assignmentId: string }> | null | undefined) => entries?.map((entry) => entry.assignmentId);
        const handedOver = [A_ID, ...Array<string>(14).fill(B_ID)];

        it("hands sessions 2..15 to B on resume day without extending A", () => {
            const normalized = resumeOf(resumeDaySource(), golden);
            expect(dates(normalized.entries)).toEqual(NEW_DATES);
            expect(owners(normalized.entries)).toEqual(handedOver);
            expect(normalized.entries?.slice(1).map((entry) => [entry.scheduleId, entry.employeeId])).toEqual(
                Array.from({ length: 14 }, () => [56, 10]),
            );
            expect(normalized.entries?.map((entry) => entry.originalDate)).toEqual(OLD_DATES);
            expect(normalized.changes["resumeReplan"]).toEqual(golden);

            const resolution = resolveResumeReplan(resumeDaySource(), normalized.changes, KR_BUILTIN_CALENDAR);
            expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
            expect(resolution?.plan?.assignmentWrites).toEqual([
                { assignmentId: A_ID, scheduleId: 55, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: true },
                { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-14", endDate: "2026-11-02", datesChanged: true },
            ]);
        });

        it("previews the handover: both periods, the new owners, no blocking reasons", () => {
            const preview = previewOf(resumeDaySource(), resumeOf(resumeDaySource(), golden).changes);
            expect(preview.blockingReasons).toEqual([]);
            expect(preview.warnings).toEqual([]);
            expect(dates(preview.after.sessions)).toEqual(NEW_DATES);
            expect(owners(preview.after.sessions)).toEqual(handedOver);
            expect(owners(preview.before.sessions)).toEqual(Array<string>(15).fill(A_ID));
            expect(preview.assignmentPeriods).toEqual([
                {
                    assignmentId: A_ID,
                    employeeName: "관리사A",
                    before: { startDate: "2026-10-01", endDate: "2026-10-14" },
                    after: { startDate: "2026-10-01", endDate: "2026-10-01" },
                },
                {
                    assignmentId: B_ID,
                    employeeName: "관리사B",
                    before: { startDate: "2026-10-14", endDate: "2026-10-23" },
                    after: { startDate: "2026-10-14", endDate: "2026-11-02" },
                },
            ]);
        });

        it("gives the same result with an explicit incomingAssignmentId and stores it in the marker", () => {
            const input = { ...golden, incomingAssignmentId: B_ID };
            const explicit = resumeOf(resumeDaySource(), input);
            const automatic = resumeOf(resumeDaySource(), golden);
            expect(explicit.entries).toEqual(automatic.entries);
            expect(explicit.changes["resumeReplan"]).toEqual(input);
            const left = resolveResumeReplan(resumeDaySource(), explicit.changes, KR_BUILTIN_CALENDAR);
            const right = resolveResumeReplan(resumeDaySource(), automatic.changes, KR_BUILTIN_CALENDAR);
            expect(left?.plan?.assignmentWrites).toEqual(right?.plan?.assignmentWrites);
            // A later PATCH that sends only a header carries the marker (with the id) forward.
            const header = resumeOf(resumeDaySource(), input, explicit.changes, { header: { momName: "수정" } });
            expect(header.changes["resumeReplan"]).toEqual(input);
        });

        it("uses outgoingLastServedDate on a handover chosen by the policy", () => {
            const input = { ...golden, outgoingLastServedDate: "2026-10-08" };
            const resolution = resolveResumeReplan(resumeDaySource(), resumeOf(resumeDaySource(), input).changes, KR_BUILTIN_CALENDAR);
            expect(resolution?.plan?.assignmentWrites[0]).toMatchObject({ assignmentId: A_ID, endDate: "2026-10-08" });
            expect(codeOf(() => resumeOf(resumeDaySource(), { ...golden, outgoingLastServedDate: "2026-10-14" })))
                .toBe("OUTGOING_LAST_SERVED_OUT_OF_RANGE");
        });

        it.each([
            ["the outgoing assignment itself", () => A_ID],
            ["an unknown id", () => "ffffffff-ffff-4fff-8fff-ffffffffffff"],
        ])("rejects %s as INCOMING_ASSIGNMENT_INVALID", (_label, id) => {
            expect(codeOf(() => resumeOf(resumeDaySource(), { ...golden, incomingAssignmentId: id() })))
                .toBe("INCOMING_ASSIGNMENT_INVALID");
        });

        it("rejects a replaced or a terminated assignment as INCOMING_ASSIGNMENT_INVALID", () => {
            const src = resumeDaySource();
            src.assignments = [
                ...src.assignments,
                extraAssignment(C_ID, 57, { replaced: true }),
                extraAssignment(D_ID, 58, { scheduleTerminatedAt: "2026-10-15T00:00:00.000Z" }),
            ];
            for (const incomingAssignmentId of [C_ID, D_ID]) {
                expect(codeOf(() => resumeOf(src, { ...golden, incomingAssignmentId }))).toBe("INCOMING_ASSIGNMENT_INVALID");
            }
        });

        it("asks the caller to choose when two live caregivers follow the replaced one, and works once told", () => {
            const src = resumeDaySource();
            src.assignments = [...src.assignments, extraAssignment(C_ID, 57)];
            expect(codeOf(() => resumeOf(src, golden))).toBe("INCOMING_ASSIGNMENT_REQUIRED");
            let candidates: unknown;
            try {
                resumeOf(src, golden);
            } catch (error) {
                candidates = (error as ServiceRecordResumeAssignmentError).candidates;
            }
            expect(candidates).toEqual([
                { assignmentId: B_ID, employeeName: "관리사B" },
                { assignmentId: C_ID, employeeName: "관리사57" },
            ]);
            expect(owners(resumeOf(src, { ...golden, incomingAssignmentId: C_ID }).entries)).toEqual([A_ID, ...Array<string>(14).fill(C_ID)]);
            expect(owners(resumeOf(src, { ...golden, incomingAssignmentId: B_ID }).entries)).toEqual(handedOver);
            // The rejection reaches a preview of a stored marker as a blocking reason, never as a throw.
            const stored = resumeOf(resumeDaySource(), golden).changes;
            expect(previewOf(src, stored).blockingReasons.map(({ code }) => code)).toEqual(["INCOMING_ASSIGNMENT_REQUIRED"]);
        });

        it("resolves the legacy case (no persisted vector) through the single successor", () => {
            const src = goldenSource({ plannedSessions: null, sessions: goldenSource().sessions.slice(0, 1) });
            // The date-coverage projection splits the sessions between A (up to the handover day) and B.
            const projected = resolveServiceRecordScheduleProjection(src, KR_BUILTIN_CALENDAR);
            expect(new Set(owners(projected.entries.slice(1)))).toEqual(new Set([A_ID, B_ID]));
            const normalized = resumeOf(src, golden);
            expect(dates(normalized.entries)).toEqual(NEW_DATES);
            expect(owners(normalized.entries)?.slice(1).every((owner) => owner === B_ID)).toBe(true);
            const resolution = resolveResumeReplan(src, normalized.changes, KR_BUILTIN_CALENDAR);
            expect(resolution?.plan?.assignmentWrites).toEqual([
                { assignmentId: A_ID, scheduleId: 55, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: true },
                { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-14", endDate: "2026-11-02", datesChanged: true },
            ]);
        });

        it("keeps a pause with one live caregiver a plain pause", () => {
            const resolution = resolveResumeReplan(pauseSource(), resumeOf(pauseSource(), golden).changes, KR_BUILTIN_CALENDAR);
            expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
            expect(resolution?.plan?.assignmentWrites).toEqual([
                { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-01", endDate: "2026-11-02", datesChanged: true },
            ]);
        });

        it("keeps the writer of a row that exists, and warns that the writer no longer covers the new date", () => {
            const src = resumeDaySource();
            // Session 2 was submitted by A on its old date; the handover does not rewrite who wrote it.
            src.sessions = [
                ...src.sessions,
                { ...goldenSource().sessions[1]!, scheduleId: 55, employeeId: 9, employeeNameSnapshot: "관리사A" },
            ];
            const normalized = resumeOf(src, golden);
            expect(owners(normalized.entries)).toEqual([A_ID, A_ID, ...Array<string>(13).fill(B_ID)]);
            const preview = previewOf(src, normalized.changes);
            expect(preview.blockingReasons).toEqual([]);
            expect(preview.warnings?.map(({ code, sessionIndex, assignmentId }) => [code, sessionIndex, assignmentId]))
                .toContainEqual(["ASSIGNMENT_MISMATCH", 2, A_ID]);
        });

        describe("who is incoming when the remaining owner was itself replaced", () => {
            /**
             * After a first handover the stored vector is 1 -> A and 2..15 -> B. B was then replaced by C,
             * who is active: A 10-01..10-14 (replaced), B 10-14..10-20 (replaced), C 10-20..11-02.
             */
            function chainSource(): ServiceRecordEditSource {
                const base = resumeDaySource();
                const planned = base.plannedSessions as Array<Record<string, unknown>>;
                return {
                    ...base,
                    plannedSessions: planned.map((entry) => (
                        (entry["sessionIndex"] as number) >= 2 ? { ...entry, assignmentId: B_ID, scheduleId: 56, employeeId: 10 } : entry
                    )) as never,
                    assignments: [
                        base.assignments[0]!,
                        { ...base.assignments[1]!, endDate: "2026-10-20", scheduleEndDate: "2026-10-20", replaced: true },
                        extraAssignment(C_ID, 57, {
                            startDate: "2026-10-20", scheduleStartDate: "2026-10-20", endDate: "2026-11-02", scheduleEndDate: "2026-11-02",
                        }),
                    ],
                };
            }
            // Written by hand: sessions 2..15 on consecutive business days from 10-21 (10-26 is a Monday).
            const FROM_1021 = [
                "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29",
                "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09",
            ];

            it("hands the sessions to the live successor C instead of extending B", () => {
                const input = { fromSessionIndex: 2, resumeDate: "2026-10-21" };
                const normalized = resumeOf(chainSource(), input);
                expect(dates(normalized.entries)).toEqual(["2026-10-01", ...FROM_1021]);
                expect(owners(normalized.entries)).toEqual([A_ID, ...Array<string>(14).fill(C_ID)]);
                const resolution = resolveResumeReplan(chainSource(), normalized.changes, KR_BUILTIN_CALENDAR);
                expect(resolution?.plan?.incomingAssignmentId).toBe(C_ID);
                expect(resolution?.plan?.assignmentWrites).toEqual([
                    { assignmentId: A_ID, scheduleId: 55, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: true },
                    // B is left exactly as stored: its end is never extended.
                    { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-14", endDate: "2026-10-20", datesChanged: false },
                    { assignmentId: C_ID, scheduleId: 57, startDate: "2026-10-21", endDate: "2026-11-09", datesChanged: true },
                ]);
                const preview = previewOf(chainSource(), normalized.changes);
                expect(preview.blockingReasons).toEqual([]);
                expect(preview.assignmentPeriods?.map(({ assignmentId, after }) => [assignmentId, after.startDate, after.endDate])).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01"],
                    [C_ID, "2026-10-21", "2026-11-09"],
                ]);
                expect(owners(preview.after.sessions)).toEqual([A_ID, ...Array<string>(14).fill(C_ID)]);
            });

            it("ends the outgoing B on outgoingLastServedDate when B owns the last kept session", () => {
                const input = { fromSessionIndex: 3, resumeDate: "2026-10-21", outgoingLastServedDate: "2026-10-16" };
                const normalized = resumeOf(chainSource(), input);
                expect(owners(normalized.entries)).toEqual([A_ID, B_ID, ...Array<string>(13).fill(C_ID)]);
                const resolution = resolveResumeReplan(chainSource(), normalized.changes, KR_BUILTIN_CALENDAR);
                expect(resolution?.plan?.incomingAssignmentId).toBe(C_ID);
                expect(resolution?.plan?.assignmentWrites.find((write) => write.assignmentId === B_ID))
                    .toEqual({ assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-14", endDate: "2026-10-16", datesChanged: true });
                expect(resolution?.plan?.assignmentWrites.find((write) => write.assignmentId === C_ID))
                    .toEqual({ assignmentId: C_ID, scheduleId: 57, startDate: "2026-10-21", endDate: "2026-11-06", datesChanged: true });
            });

            it("follows a longer chain and stops at the one live assignment", () => {
                const src = chainSource();
                // C was replaced by D too (10-20..10-25); D is the live end of the chain A -> B -> C -> D.
                src.assignments = [
                    src.assignments[0]!,
                    src.assignments[1]!,
                    { ...src.assignments[2]!, endDate: "2026-10-25", scheduleEndDate: "2026-10-25", replaced: true },
                    extraAssignment(D_ID, 58, {
                        startDate: "2026-10-25", scheduleStartDate: "2026-10-25", endDate: "2026-11-02", scheduleEndDate: "2026-11-02",
                    }),
                ];
                const normalized = resumeOf(src, { fromSessionIndex: 2, resumeDate: "2026-10-21" });
                expect(owners(normalized.entries)).toEqual([A_ID, ...Array<string>(14).fill(D_ID)]);
            });

            it("asks the caller to choose when the chain ends in two live assignments", () => {
                const src = chainSource();
                src.assignments = [...src.assignments, extraAssignment(D_ID, 58, { startDate: "2026-10-20", scheduleStartDate: "2026-10-20" })];
                expect(codeOf(() => resumeOf(src, { fromSessionIndex: 2, resumeDate: "2026-10-21" }))).toBe("INCOMING_ASSIGNMENT_REQUIRED");
                expect(owners(resumeOf(src, { fromSessionIndex: 2, resumeDate: "2026-10-21", incomingAssignmentId: D_ID }).entries))
                    .toEqual([A_ID, ...Array<string>(14).fill(D_ID)]);
            });

            it("does not loop when replaced assignments share a start date", () => {
                const src = chainSource();
                // A and B both start on 10-01: each is a "successor" of the other by start date alone.
                src.assignments = src.assignments.map((assignment) => (assignment.id === B_ID
                    ? { ...assignment, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" }
                    : assignment));
                expect(owners(resumeOf(src, { fromSessionIndex: 2, resumeDate: "2026-10-21" }).entries))
                    .toEqual([A_ID, ...Array<string>(14).fill(C_ID)]);
            });
        });

        describe("a superseded caregiver with no live successor", () => {
            const terminatedPause = (): ServiceRecordEditSource => {
                const src = pauseSource();
                src.assignments = [{ ...src.assignments[0]!, scheduleTerminatedAt: "2026-10-10T00:00:00.000Z" }];
                return src;
            };
            const candidatesOf = (run: () => unknown) => {
                try {
                    run();
                } catch (error) {
                    return error instanceof ServiceRecordResumeAssignmentError
                        ? { code: error.code, message: error.message, candidates: error.candidates }
                        : null;
                }
                return null;
            };

            it("does not silently extend the superseded caregiver: no live assignment means an empty candidate list", () => {
                const thrown = candidatesOf(() => resumeOf(terminatedPause(), golden));
                expect(thrown?.code).toBe("INCOMING_ASSIGNMENT_REQUIRED");
                expect(thrown?.message).toContain("No active caregiver could be found");
                expect(thrown?.candidates).toEqual([]);
            });

            it("lists every live assignment of the case as the candidates", () => {
                const src = terminatedPause();
                // The terminated caregiver is schedule 56. D is live but schedule 54 (created earlier, so it
                // did not take over from schedule 56); it is no successor, yet still a candidate.
                src.assignments = [
                    extraAssignment(D_ID, 54, { startDate: "2026-09-01", scheduleStartDate: "2026-09-01", endDate: "2026-09-30", scheduleEndDate: "2026-09-30" }),
                    ...src.assignments,
                ];
                const thrown = candidatesOf(() => resumeOf(src, golden));
                expect(thrown?.code).toBe("INCOMING_ASSIGNMENT_REQUIRED");
                expect(thrown?.message).toContain("No active caregiver could be found");
                expect(thrown?.candidates).toEqual([{ assignmentId: D_ID, employeeName: "관리사54" }]);
                const chosen = resolveResumeReplan(src, resumeOf(src, { ...golden, incomingAssignmentId: D_ID }).changes, KR_BUILTIN_CALENDAR);
                expect(chosen?.plan?.incomingAssignmentId).toBe(D_ID);
            });

            it("does not take a live assignment with a lower schedule id as the successor, however late it starts", () => {
                const src = terminatedPause();
                // Schedule 54 starts on 10-20, after the terminated schedule 56 stopped, but it is older: no successor.
                src.assignments = [
                    extraAssignment(D_ID, 54, { startDate: "2026-10-20", scheduleStartDate: "2026-10-20" }),
                    ...src.assignments,
                ];
                const thrown = candidatesOf(() => resumeOf(src, golden));
                expect(thrown?.code).toBe("INCOMING_ASSIGNMENT_REQUIRED");
                expect(thrown?.message).toContain("No active caregiver could be found");
                expect(thrown?.message).not.toContain("More than one caregiver");
                expect(thrown?.candidates).toEqual([{ assignmentId: D_ID, employeeName: "관리사54" }]);
            });

            it("surfaces candidates on the blocking reason of a stored marker", () => {
                const stored = resumeOf(pauseSource(), golden).changes;
                const none = previewOf(terminatedPause(), stored).blockingReasons;
                expect(none).toHaveLength(1);
                expect(none[0]).toMatchObject({ code: "INCOMING_ASSIGNMENT_REQUIRED", sessionIndex: 2, candidates: [] });

                const src = resumeDaySource();
                src.assignments = [...src.assignments, extraAssignment(C_ID, 57)];
                const several = previewOf(src, resumeOf(resumeDaySource(), golden).changes).blockingReasons;
                expect(several).toHaveLength(1);
                expect(several[0]).toMatchObject({
                    code: "INCOMING_ASSIGNMENT_REQUIRED",
                    candidates: [{ assignmentId: B_ID, employeeName: "관리사B" }, { assignmentId: C_ID, employeeName: "관리사57" }],
                });

                // A stored explicit choice that is no longer valid reports INCOMING_ASSIGNMENT_INVALID the same way.
                const chosen = resumeOf(resumeDaySource(), { ...golden, incomingAssignmentId: B_ID }).changes;
                const replacedB = resumeDaySource();
                replacedB.assignments = replacedB.assignments.map((assignment) => (assignment.id === B_ID ? { ...assignment, replaced: true } : assignment));
                expect(previewOf(replacedB, chosen).blockingReasons[0]).toMatchObject({ code: "INCOMING_ASSIGNMENT_INVALID", candidates: [] });
            });

            it("keeps every other blocking reason free of a candidates key", () => {
                const blocked = previewOf(goldenSource(), { resumeReplan: { fromSessionIndex: 99, resumeDate: "2026-10-14" } }).blockingReasons;
                expect(blocked.map(({ code }) => code)).toEqual(["INVALID_SESSION_INDEX"]);
                expect(blocked.every((entry) => !("candidates" in entry))).toBe(true);
            });
        });

        describe("a session kept by its writer", () => {
            /**
             * Resume day plus an A-written draft row for session 3, while session 2 has no row yet (an admin
             * future-content entry allows this sparse state). The explicit choice is B.
             */
            function sparseWriterSource(): ServiceRecordEditSource {
                const base = resumeDaySource();
                return {
                    ...base,
                    sessions: [
                        ...base.sessions,
                        {
                            ...goldenSource().sessions[2]!, scheduleId: 55, employeeId: 9, employeeNameSnapshot: "관리사A",
                            locked: false, submittedAt: null, clientSignature: null, clientSignedAt: null,
                        },
                    ],
                };
            }
            const chosenB = { ...golden, incomingAssignmentId: B_ID };
            const interleaved = [A_ID, B_ID, A_ID, ...Array<string>(12).fill(B_ID)];

            /** The case as it stands after the confirm of the scenario above, written down by hand. */
            function afterConfirmSource(): ServiceRecordEditSource {
                const base = sparseWriterSource();
                const owner = (index: number) => (interleaved[index - 1] === A_ID
                    ? { id: A_ID, scheduleId: 55, employeeId: 9 }
                    : { id: B_ID, scheduleId: 56, employeeId: 10 });
                return {
                    ...base,
                    endDate: "2026-11-02",
                    caseLifecycle: { ...base.caseLifecycle, finalizationDueAt: "2026-11-02T11:00:00.000Z" },
                    client: { ...base.client, endDate: "2026-11-02" },
                    sessions: base.sessions.map((session) => ({ ...session, serviceDate: NEW_DATES[session.sessionIndex - 1]! })),
                    assignments: base.assignments.map((assignment) => (assignment.id === A_ID
                        ? { ...assignment, endDate: "2026-10-01", scheduleEndDate: "2026-10-01" }
                        : { ...assignment, endDate: "2026-11-02", scheduleEndDate: "2026-11-02" })),
                    plannedSessions: NEW_DATES.map((serviceDate, offset) => ({
                        sessionIndex: offset + 1,
                        serviceDate,
                        originalDate: OLD_DATES[offset]!,
                        assignmentId: owner(offset + 1).id,
                        scheduleId: owner(offset + 1).scheduleId,
                        employeeId: owner(offset + 1).employeeId,
                        provenanceVersion: "case-7",
                    })),
                };
            }

            it("plans A, B, A, B x12 and writes A 10-01..10-01 and B 10-14..11-02", () => {
                const normalized = resumeOf(sparseWriterSource(), chosenB);
                expect(dates(normalized.entries)).toEqual(NEW_DATES);
                expect(owners(normalized.entries)).toEqual(interleaved);
                const resolution = resolveResumeReplan(sparseWriterSource(), normalized.changes, KR_BUILTIN_CALENDAR);
                expect(resolution?.reasons).toEqual([]);
                expect(resolution?.plan?.assignmentWrites).toEqual([
                    { assignmentId: A_ID, scheduleId: 55, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: true },
                    { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-14", endDate: "2026-11-02", datesChanged: true },
                ]);
            });

            it("previews the handover: the mismatch warning stays, nothing blocks", () => {
                const preview = previewOf(sparseWriterSource(), resumeOf(sparseWriterSource(), chosenB).changes);
                expect(preview.blockingReasons).toEqual([]);
                expect(owners(preview.after.sessions)).toEqual(interleaved);
                expect(dates(preview.after.sessions)).toEqual(NEW_DATES);
                expect(preview.warnings?.map(({ code, sessionIndex, assignmentId }) => [code, sessionIndex, assignmentId]))
                    .toEqual([["ASSIGNMENT_MISMATCH", 3, A_ID]]);
                expect(preview.assignmentPeriods).toEqual([
                    {
                        assignmentId: A_ID,
                        employeeName: "관리사A",
                        before: { startDate: "2026-10-01", endDate: "2026-10-14" },
                        after: { startDate: "2026-10-01", endDate: "2026-10-01" },
                    },
                    {
                        assignmentId: B_ID,
                        employeeName: "관리사B",
                        before: { startDate: "2026-10-14", endDate: "2026-10-23" },
                        after: { startDate: "2026-10-14", endDate: "2026-11-02" },
                    },
                ]);
                // The kept slot does not widen A's range in the provenance either.
                expect(preview.provenance.map(({ assignmentId, startDate, endDate }) => [assignmentId, startDate, endDate])).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01"],
                    [B_ID, "2026-10-14", "2026-11-02"],
                ]);
            });

            it("gives the same result when the policy picks B itself", () => {
                const explicit = resumeOf(sparseWriterSource(), chosenB);
                const automatic = resumeOf(sparseWriterSource(), golden);
                expect(automatic.entries).toEqual(explicit.entries);
                expect(previewOf(sparseWriterSource(), automatic.changes).blockingReasons).toEqual([]);
            });

            it("does not block a later preview of the interleaved state it leaves behind", () => {
                const source = afterConfirmSource();
                const projected = resolveServiceRecordScheduleProjection(source, KR_BUILTIN_CALENDAR);
                expect(projected.blockingReasons).toEqual([]);
                expect(owners(projected.entries)).toEqual(interleaved);
                const preview = previewOf(source, { header: { momName: "수정" } });
                expect(preview.blockingReasons).toEqual([]);
                expect(preview.contentChanges.headerChanged).toBe(true);
                expect("warnings" in preview).toBe(false);
                expect(preview.provenance.map(({ assignmentId, startDate, endDate }) => [assignmentId, startDate, endDate])).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01"],
                    [B_ID, "2026-10-14", "2026-11-02"],
                ]);
            });

            it("still blocks the same interleaving once A's period covers the slot (the slot is A's own range)", () => {
                const source = afterConfirmSource();
                // A's period reaches 10-15 again, so slot 3 is no kept slot: A 10-01..10-15 overlaps B from 10-14.
                source.assignments = source.assignments.map((assignment) => (assignment.id === A_ID
                    ? { ...assignment, endDate: "2026-10-15", scheduleEndDate: "2026-10-15" }
                    : assignment));
                expect(previewOf(source, { header: { momName: "수정" } }).blockingReasons.map(({ code }) => code))
                    .toEqual(["ASSIGNMENT_RANGE_OVERLAP"]);
            });

            it("still blocks an interleaved slot the owner did not write", () => {
                const source = afterConfirmSource();
                source.sessions = source.sessions.filter((session) => session.sessionIndex !== 3);
                expect(previewOf(source, { header: { momName: "수정" } }).blockingReasons.map(({ code }) => code))
                    .toEqual(["ASSIGNMENT_RANGE_OVERLAP"]);
            });

            it("still blocks an interleaved slot of a caregiver who is not superseded", () => {
                const source = afterConfirmSource();
                source.assignments = source.assignments.map((assignment) => ({ ...assignment, replaced: false }));
                expect(previewOf(source, { header: { momName: "수정" } }).blockingReasons.map(({ code }) => code))
                    .toEqual(["ASSIGNMENT_RANGE_OVERLAP"]);
            });

            it("resumes again after the confirm: the kept slot is neither the outgoing caregiver nor a reason to hand over", () => {
                const source = afterConfirmSource();
                // Session 3 (A's kept slot, 10-15) is not the last session served: B served session 2.
                const input = { fromSessionIndex: 4, resumeDate: "2026-10-20" };
                const normalized = resumeOf(source, input);
                // Written down by hand: 12 consecutive business days from Tuesday 10-20.
                expect(dates(normalized.entries)?.slice(3)).toEqual([
                    "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27",
                    "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04",
                ]);
                expect(owners(normalized.entries)).toEqual(interleaved);
                const resolution = resolveResumeReplan(source, normalized.changes, KR_BUILTIN_CALENDAR);
                expect(resolution?.reasons).toEqual([]);
                // A plain pause of B: only its end moves, and A is not widened to the kept slot's date.
                expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
                expect(resolution?.plan?.assignmentWrites).toEqual([
                    { assignmentId: A_ID, scheduleId: 55, startDate: "2026-10-01", endDate: "2026-10-01", datesChanged: false },
                    { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-14", endDate: "2026-11-04", datesChanged: true },
                ]);
                expect(previewOf(source, normalized.changes).blockingReasons).toEqual([]);
            });
        });

        describe("re-planning from session 1", () => {
            /** A legacy case: no persisted vector and no rows; the date-coverage projection splits the sessions A x7, B x8. */
            const legacySource = () => goldenSource({ plannedSessions: null, sessions: [] });

            it("projects the legacy case as a split between A and B", () => {
                const projected = resolveServiceRecordScheduleProjection(legacySource(), KR_BUILTIN_CALENDAR);
                expect(owners(projected.entries)).toEqual([...Array<string>(7).fill(A_ID), ...Array<string>(8).fill(B_ID)]);
            });

            it.each([
                // A has no session left. On the handover day its stored end 10-14 still reaches the new first date, so
                // the outer-edge rule every confirm applies moves A's start there ([10-14, 10-14]); the resume writes that
                // already. After the handover day the new first date is beyond A's end, so A keeps its stored dates.
                ["on the handover day", "2026-10-14", "2026-11-03", "2026-10-14", true],
                ["after the handover day", "2026-10-20", "2026-11-09", "2026-10-01", false],
            ])("hands a legacy split to the one live successor %s", (_label, resumeDate, endDate, aStart, aChanged) => {
                const src = legacySource();
                const normalized = resumeOf(src, { fromSessionIndex: 1, resumeDate });
                expect(owners(normalized.entries)).toEqual(Array<string>(15).fill(B_ID));
                expect(normalized.entries?.[0]?.serviceDate).toBe(resumeDate);
                expect(normalized.entries?.at(-1)?.serviceDate).toBe(endDate);
                const resolution = resolveResumeReplan(src, normalized.changes, KR_BUILTIN_CALENDAR);
                expect(resolution?.reasons).toEqual([]);
                expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
                expect(resolution?.plan?.assignmentWrites).toEqual([
                    { assignmentId: A_ID, scheduleId: 55, startDate: aStart, endDate: "2026-10-14", datesChanged: aChanged },
                    { assignmentId: B_ID, scheduleId: 56, startDate: resumeDate, endDate, datesChanged: true },
                ]);
                expect(previewOf(src, normalized.changes).blockingReasons).toEqual([]);
            });

            it("asks the caller to choose when two live caregivers follow the replaced one of a legacy split", () => {
                const src = legacySource();
                // A ends 10-13, B covers 10-14..10-16 and C 10-19..10-23, so the projection still gives each session one owner.
                src.assignments = [
                    { ...src.assignments[0]!, endDate: "2026-10-13", scheduleEndDate: "2026-10-13" },
                    { ...src.assignments[1]!, endDate: "2026-10-16", scheduleEndDate: "2026-10-16" },
                    extraAssignment(C_ID, 57, { startDate: "2026-10-19", scheduleStartDate: "2026-10-19" }),
                ];
                expect(codeOf(() => resumeOf(src, { fromSessionIndex: 1, resumeDate: "2026-10-20" }))).toBe("INCOMING_ASSIGNMENT_REQUIRED");
                expect(owners(resumeOf(src, { fromSessionIndex: 1, resumeDate: "2026-10-20", incomingAssignmentId: C_ID }).entries))
                    .toEqual(Array<string>(15).fill(C_ID));
            });

            it("keeps the split of a persisted vector between two live caregivers", () => {
                const normalized = resumeOf(liveSplitSource(), { fromSessionIndex: 1, resumeDate: "2026-10-02" });
                expect(owners(normalized.entries)).toEqual([A_ID, ...Array<string>(14).fill(B_ID)]);
                const resolution = resolveResumeReplan(liveSplitSource(), normalized.changes, KR_BUILTIN_CALENDAR);
                expect(resolution?.plan?.incomingAssignmentId).toBeNull();
            });

            it("starts the incoming caregiver on the first session it owns, not on the first re-planned date", () => {
                // Golden fixture from session 1: session 1 keeps its writer A on 10-02, B's first session is 10-06.
                const input = { fromSessionIndex: 1, resumeDate: "2026-10-02" };
                const normalized = resumeOf(goldenSource(), input);
                // Written down by hand: Friday 10-02, then 10-06.. (10-03, 10-05 and 10-09 are holidays).
                expect(dates(normalized.entries)).toEqual([
                    "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13", "2026-10-14",
                    "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26",
                ]);
                expect(owners(normalized.entries)).toEqual([A_ID, ...Array<string>(14).fill(B_ID)]);
                const resolution = resolveResumeReplan(goldenSource(), normalized.changes, KR_BUILTIN_CALENDAR);
                expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
                expect(resolution?.plan?.assignmentWrites).toEqual([
                    // No kept session to derive an end from, so A's end stays. A's own session 1 is now on 10-02 and is
                    // A's head session: the outer-edge rule every confirm applies starts A there, so the resume writes that.
                    { assignmentId: A_ID, scheduleId: 55, startDate: "2026-10-02", endDate: "2026-10-14", datesChanged: true },
                    { assignmentId: B_ID, scheduleId: 56, startDate: "2026-10-06", endDate: "2026-10-26", datesChanged: true },
                ]);
                const preview = previewOf(goldenSource(), normalized.changes);
                expect(preview.blockingReasons).toEqual([]);
                expect(preview.warnings?.filter(({ code }) => code === "ASSIGNMENT_MISMATCH")).toEqual([]);
                // Everything the resume writes is shown: A's start follows its session 1, B starts on its first session.
                expect(preview.assignmentPeriods).toEqual([
                    {
                        assignmentId: A_ID,
                        employeeName: "관리사A",
                        before: { startDate: "2026-10-01", endDate: "2026-10-14" },
                        after: { startDate: "2026-10-02", endDate: "2026-10-14" },
                    },
                    {
                        assignmentId: B_ID,
                        employeeName: "관리사B",
                        before: { startDate: "2026-10-14", endDate: "2026-10-23" },
                        after: { startDate: "2026-10-06", endDate: "2026-10-26" },
                    },
                ]);
            });

            it("warns when A's period does not cover session 1's new date, and still does not block", () => {
                const src = goldenSource();
                src.assignments = src.assignments.map((assignment) => (assignment.id === A_ID
                    ? { ...assignment, startDate: "2026-09-25", scheduleStartDate: "2026-09-25", endDate: "2026-10-01", scheduleEndDate: "2026-10-01" }
                    : assignment));
                const normalized = resumeOf(src, { fromSessionIndex: 1, resumeDate: "2026-10-02" });
                const preview = previewOf(src, normalized.changes);
                expect(preview.blockingReasons).toEqual([]);
                expect(preview.warnings?.filter(({ code }) => code === "ASSIGNMENT_MISMATCH").map(({ sessionIndex, assignmentId }) => [sessionIndex, assignmentId]))
                    .toEqual([[1, A_ID]]);
                expect(resolveResumeReplan(src, normalized.changes, KR_BUILTIN_CALENDAR)?.plan?.assignmentWrites[0])
                    .toMatchObject({ assignmentId: A_ID, startDate: "2026-09-25", endDate: "2026-10-01", datesChanged: false });
            });

            it("hands a persisted split with a replaced owner to the live successor, keeping the writer of a row", () => {
                // Session 1 is a row written by A, so it stays with A; sessions 2..15 are B's already.
                const normalized = resumeOf(goldenSource(), { fromSessionIndex: 1, resumeDate: "2026-10-02" });
                expect(owners(normalized.entries)).toEqual([A_ID, ...Array<string>(14).fill(B_ID)]);
                const resolution = resolveResumeReplan(goldenSource(), normalized.changes, KR_BUILTIN_CALENDAR);
                expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
                const writes = resolution?.plan?.assignmentWrites;
                // A's session 1 (its row) is now on 10-02, inside A's period: A starts there, as every confirm would have it.
                expect(writes?.find((write) => write.assignmentId === A_ID)).toMatchObject({ startDate: "2026-10-02", endDate: "2026-10-14", datesChanged: true });
                expect(writes?.find((write) => write.assignmentId === B_ID)).toMatchObject({ endDate: "2026-10-26", datesChanged: true });
            });
        });
    });

    describe("a kept writer slot is provenance, not a period", () => {
        const C_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        const D_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        const owners = (entries: Array<{ assignmentId: string }> | null | undefined) => entries?.map((entry) => entry.assignmentId);
        const live = (id: string, scheduleId: number, overrides: Record<string, unknown> = {}) => assignmentRow({
            id, scheduleId, employeeId: scheduleId + 100, startDate: "2026-10-01", endDate: "2026-10-23", replaced: false,
            employeeName: `관리사${scheduleId}`, scheduleStartDate: "2026-10-01", scheduleEndDate: "2026-10-23",
            primaryEmployeeId: scheduleId + 100, primaryEmployeeName: `관리사${scheduleId}`, ...overrides,
        }) as ServiceRecordEditSource["assignments"][number];
        const writesOf = (src: ServiceRecordEditSource, input: Parameters<typeof resumeOf>[1]) =>
            resolveResumeReplan(src, resumeOf(src, input).changes, KR_BUILTIN_CALENDAR);
        const compact = (writes: Array<{ assignmentId: string | null; startDate: string; endDate: string; datesChanged?: boolean }> | undefined) =>
            writes?.map(({ assignmentId, startDate, endDate, datesChanged }) => [assignmentId, startDate, endDate, datesChanged]);

        /**
         * A (schedule 55) was replaced before her own start and is stored as the one day [10-06, 10-06];
         * B (schedule 56) is live and started on 10-01. The persisted vector still gives every session to A
         * and only session 1 is written (by A, on 10-01, outside A's stored period).
         */
        function zeroLengthSource(aOverrides: Record<string, unknown> = {}, extra: ServiceRecordEditSource["assignments"] = []): ServiceRecordEditSource {
            const base = goldenSource();
            return {
                ...base,
                sessions: base.sessions.slice(0, 1),
                plannedSessions: OLD_DATES.map((serviceDate, offset) => ({
                    sessionIndex: offset + 1,
                    serviceDate,
                    originalDate: serviceDate,
                    assignmentId: A_ID,
                    scheduleId: 55,
                    employeeId: 9,
                    provenanceVersion: "case-7",
                })),
                assignments: [
                    {
                        ...base.assignments[0]!, startDate: "2026-10-06", scheduleStartDate: "2026-10-06",
                        endDate: "2026-10-06", scheduleEndDate: "2026-10-06", ...aOverrides,
                    },
                    { ...base.assignments[1]!, startDate: "2026-10-01", scheduleStartDate: "2026-10-01" },
                    ...extra,
                ],
            };
        }
        const terminatedA = { replaced: false, scheduleTerminatedAt: "2026-10-05T00:00:00.000Z" };

        /** The case as the confirm leaves it, read from the plan the confirm would write. */
        function stateAfter(
            src: ServiceRecordEditSource,
            plan: NonNullable<ReturnType<typeof resolveResumeReplan>>["plan"],
        ): ServiceRecordEditSource {
            const writeOf = (assignmentId: string | null) => plan!.assignmentWrites.find((write) => write.assignmentId === assignmentId)!;
            const dateOf = (sessionIndex: number) => plan!.entries.find((entry) => entry.sessionIndex === sessionIndex)!.serviceDate;
            return {
                ...src,
                startDate: plan!.entries[0]!.serviceDate,
                endDate: plan!.endDate,
                sessions: src.sessions.map((session) => ({ ...session, serviceDate: dateOf(session.sessionIndex) })),
                assignments: src.assignments.map((assignment) => {
                    const write = writeOf(assignment.id);
                    return { ...assignment, startDate: write.startDate, endDate: write.endDate, scheduleStartDate: write.startDate, scheduleEndDate: write.endDate };
                }),
                plannedSessions: plan!.entries.map((entry) => ({ ...entry })) as never,
            };
        }

        describe("the successor is the live assignment that came after, by schedule order", () => {
            it.each([
                ["replaced", {}],
                ["terminated, not replaced", terminatedA],
            ])("hands over to the sole live B when A is %s and stored before B's start", (_label, aOverrides) => {
                // Resume from session 2 on 10-14. Session 1 is A's only session and is historical (10-01 is
                // outside A's [10-06, 10-06]), so A is no outgoing caregiver and sessions 2..15 are handed to B.
                const resolution = writesOf(zeroLengthSource(aOverrides), golden);
                expect(resolution?.reasons).toEqual([]);
                expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
                expect(owners(resolution?.plan?.entries)).toEqual([A_ID, ...Array<string>(14).fill(B_ID)]);
                // B's first owned re-planned session is session 2 on 10-14; the last date is 11-02 (NEW_DATES).
                // A is untouched. Sorted by stored start: B 10-01, then A 10-06.
                expect(compact(resolution?.plan?.assignmentWrites)).toEqual([
                    [B_ID, "2026-10-14", "2026-11-02", true],
                    [A_ID, "2026-10-06", "2026-10-06", false],
                ]);
            });

            it.each([
                ["replaced", {}],
                ["terminated, not replaced", terminatedA],
            ])("hands a from-session-1 correction to the sole live B when A is %s", (_label, aOverrides) => {
                const resolution = writesOf(zeroLengthSource(aOverrides), { fromSessionIndex: 1, resumeDate: "2026-10-02" });
                expect(resolution?.reasons).toEqual([]);
                expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
                // Session 1 keeps its writer A on 10-02; B starts on its first owned session, 10-06 (10-03 is a
                // Saturday, 10-05 a holiday), and the 15th session is 10-26.
                expect(dates(resolution?.plan?.entries)).toEqual([
                    "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13", "2026-10-14",
                    "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26",
                ]);
                expect(owners(resolution?.plan?.entries)).toEqual([A_ID, ...Array<string>(14).fill(B_ID)]);
                expect(compact(resolution?.plan?.assignmentWrites)).toEqual([
                    [B_ID, "2026-10-06", "2026-10-26", true],
                    [A_ID, "2026-10-06", "2026-10-06", false],
                ]);
            });

            it("previews the handover without a blocking reason and leaves the historical-only A out of the provenance", () => {
                const src = zeroLengthSource();
                const preview = previewOf(src, resumeOf(src, golden).changes);
                expect(preview.blockingReasons).toEqual([]);
                expect(preview.assignmentPeriods).toEqual([{
                    assignmentId: B_ID,
                    employeeName: "관리사B",
                    before: { startDate: "2026-10-01", endDate: "2026-10-23" },
                    after: { startDate: "2026-10-14", endDate: "2026-11-02" },
                }]);
                // A's only session is a kept writer slot: a trace of who wrote the row, not a range.
                expect(preview.provenance.map(({ assignmentId, startDate, endDate }) => [assignmentId, startDate, endDate]))
                    .toEqual([[B_ID, "2026-10-14", "2026-11-02"]]);
            });

            it("asks for a choice between two eligible live successors, and works once told", () => {
                const src = zeroLengthSource({}, [live(C_ID, 57, { startDate: "2026-10-14", scheduleStartDate: "2026-10-14" })]);
                let thrown: ServiceRecordResumeAssignmentError | null = null;
                try {
                    resumeOf(src, golden);
                } catch (error) {
                    thrown = error as ServiceRecordResumeAssignmentError;
                }
                expect(thrown?.code).toBe("INCOMING_ASSIGNMENT_REQUIRED");
                expect(thrown?.message).toContain("More than one caregiver follows");
                expect(thrown?.candidates).toEqual([
                    { assignmentId: B_ID, employeeName: "관리사B" },
                    { assignmentId: C_ID, employeeName: "관리사57" },
                ]);
                const chosen = writesOf(src, { ...golden, incomingAssignmentId: C_ID });
                expect(chosen?.reasons).toEqual([]);
                expect(chosen?.plan?.incomingAssignmentId).toBe(C_ID);
                expect(chosen?.plan?.assignmentWrites.find((write) => write.assignmentId === C_ID))
                    .toMatchObject({ startDate: "2026-10-14", endDate: "2026-11-02", datesChanged: true });
                // B owns no session and is stored [10-01, 10-23]: it is the head candidate of the outer-edge rule, whose
                // first period-bearing session is C's on 10-14, still inside B's period. Every confirm would start B there,
                // so the resume writes it (B [10-14, 10-23]); A is historical-only and keeps its dates.
                expect(chosen?.plan?.assignmentWrites.find((write) => write.assignmentId === B_ID))
                    .toMatchObject({ startDate: "2026-10-14", endDate: "2026-10-23", datesChanged: true });
                expect(chosen?.plan?.assignmentWrites.find((write) => write.assignmentId === A_ID))
                    .toMatchObject({ startDate: "2026-10-06", endDate: "2026-10-06", datesChanged: false });
            });

            it("never picks the greatest schedule id on its own, and ignores a live assignment of an older schedule", () => {
                // D is schedule 54: older than A (55), so it is no successor even though it starts on 10-20.
                const src = zeroLengthSource({}, [live(D_ID, 54, { startDate: "2026-10-20", scheduleStartDate: "2026-10-20" })]);
                const resolution = writesOf(src, golden);
                expect(resolution?.reasons).toEqual([]);
                expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
            });
        });

        describe("a correction from session 1 that leaves A's row on A", () => {
            /** Three sessions: A wrote session 1 on 10-01 (A stored [10-01, 10-01], replaced); B (live) owns 2 and 3. */
            function threeSessionSource(): ServiceRecordEditSource {
                const base = goldenSource();
                const dates3 = ["2026-10-01", "2026-10-02", "2026-10-06"];
                const ownerOf = (index: number) => (index === 1 ? { id: A_ID, scheduleId: 55, employeeId: 9 } : { id: B_ID, scheduleId: 56, employeeId: 10 });
                return {
                    ...base,
                    requiredSessionCount: 3,
                    startDate: "2026-10-01",
                    endDate: "2026-10-06",
                    client: { ...base.client, endDate: "2026-10-06" },
                    sessions: base.sessions.slice(0, 1),
                    assignments: [
                        { ...base.assignments[0]!, endDate: "2026-10-01", scheduleEndDate: "2026-10-01" },
                        { ...base.assignments[1]!, startDate: "2026-10-02", scheduleStartDate: "2026-10-02", endDate: "2026-10-06", scheduleEndDate: "2026-10-06" },
                    ],
                    plannedSessions: dates3.map((serviceDate, offset) => ({
                        sessionIndex: offset + 1,
                        serviceDate,
                        originalDate: serviceDate,
                        assignmentId: ownerOf(offset + 1).id,
                        scheduleId: ownerOf(offset + 1).scheduleId,
                        employeeId: ownerOf(offset + 1).employeeId,
                        provenanceVersion: "case-7",
                    })),
                };
            }
            const fromOne = { fromSessionIndex: 1, resumeDate: "2026-10-14" };

            it("plans A, B, B: A stays [10-01, 10-01] and B starts on its first owned session, 10-15", () => {
                const resolution = writesOf(threeSessionSource(), fromOne);
                expect(resolution?.reasons).toEqual([]);
                // Wed 10-14, Thu 10-15, Fri 10-16.
                expect(dates(resolution?.plan?.entries)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
                expect(owners(resolution?.plan?.entries)).toEqual([A_ID, B_ID, B_ID]);
                expect(compact(resolution?.plan?.assignmentWrites)).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01", false],
                    [B_ID, "2026-10-15", "2026-10-16", true],
                ]);
            });

            it("previews and confirms a header-only edit of that state without moving a boundary", () => {
                const state = stateAfter(threeSessionSource(), writesOf(threeSessionSource(), fromOne)!.plan);
                // Built from the plan: A's session 1 is on 10-14, far outside A's [10-01, 10-01].
                expect(state.assignments.map(({ id, startDate, endDate }) => [id, startDate, endDate])).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01"],
                    [B_ID, "2026-10-15", "2026-10-16"],
                ]);
                const preview = previewOf(state, { header: { momName: "수정" } });
                expect(preview.blockingReasons).toEqual([]);
                expect(preview.contentChanges.headerChanged).toBe(true);
                expect(preview.provenance.map(({ assignmentId, startDate, endDate }) => [assignmentId, startDate, endDate]))
                    .toEqual([[B_ID, "2026-10-15", "2026-10-16"]]);
                // The ordinary confirm derives its writes from the previewed vector and changes nothing.
                const writes = confirmAssignmentWrites(state, preview.after.sessions);
                expect(compact(writes)).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01", false],
                    [B_ID, "2026-10-15", "2026-10-16", false],
                ]);
            });

            describe("a second resume whose entire prefix is A's historical slot", () => {
                const second = { fromSessionIndex: 2, resumeDate: "2026-10-20" };
                const stateOne = () => stateAfter(threeSessionSource(), writesOf(threeSessionSource(), fromOne)!.plan);

                it("does not use A as the last served caregiver, and does not extend A", () => {
                    const resolution = writesOf(stateOne(), second);
                    expect(resolution?.reasons).toEqual([]);
                    expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
                    // Tue 10-20, Wed 10-21. With no outgoing caregiver the read is the one from session 1: B, the
                    // only caregiver bearing a period, starts on its first owned re-planned session.
                    expect(dates(resolution?.plan?.entries)).toEqual(["2026-10-14", "2026-10-20", "2026-10-21"]);
                    expect(owners(resolution?.plan?.entries)).toEqual([A_ID, B_ID, B_ID]);
                    expect(compact(resolution?.plan?.assignmentWrites)).toEqual([
                        [A_ID, "2026-10-01", "2026-10-01", false],
                        [B_ID, "2026-10-20", "2026-10-21", true],
                    ]);
                    const preview = previewOf(stateOne(), resumeOf(stateOne(), second).changes);
                    expect(preview.blockingReasons).toEqual([]);
                    expect(preview.assignmentPeriods?.map(({ assignmentId, after }) => [assignmentId, after.startDate, after.endDate]))
                        .toEqual([[B_ID, "2026-10-20", "2026-10-21"]]);
                });

                it("refuses an outgoingLastServedDate: there is no served session before the resumed one", () => {
                    expect(codeOf(() => resumeOf(stateOne(), { ...second, outgoingLastServedDate: "2026-10-15" })))
                        .toBe("OUTGOING_LAST_SERVED_OUT_OF_RANGE");
                });
            });
        });

        describe("no remaining session bears a period", () => {
            /**
             * B (live) owns session 1. A (replaced, stored [09-20, 09-20]) wrote sessions 2 and 3 outside its
             * period, so both are historical. C (live) is the only other caregiver.
             */
            function allHistoricalRemainingSource(): ServiceRecordEditSource {
                const base = goldenSource();
                const dates3 = ["2026-10-01", "2026-10-02", "2026-10-06"];
                const ownerOf = (index: number) => (index === 1 ? { id: B_ID, scheduleId: 56, employeeId: 10 } : { id: A_ID, scheduleId: 55, employeeId: 9 });
                return {
                    ...base,
                    requiredSessionCount: 3,
                    startDate: "2026-10-01",
                    endDate: "2026-10-06",
                    client: { ...base.client, endDate: "2026-10-06" },
                    sessions: dates3.map((serviceDate, offset) => ({
                        ...base.sessions[0]!,
                        id: `day-${offset + 1}`,
                        sourceRowId: `day-${offset + 1}`,
                        sessionIndex: offset + 1,
                        rawCaseSessionIndex: offset + 1,
                        rawSessionIndex: offset + 1,
                        serviceDate,
                        scheduleId: ownerOf(offset + 1).scheduleId,
                        employeeId: ownerOf(offset + 1).employeeId,
                    })),
                    assignments: [
                        { ...base.assignments[0]!, startDate: "2026-09-20", scheduleStartDate: "2026-09-20", endDate: "2026-09-20", scheduleEndDate: "2026-09-20" },
                        { ...base.assignments[1]!, startDate: "2026-10-01", scheduleStartDate: "2026-10-01", endDate: "2026-10-23", scheduleEndDate: "2026-10-23" },
                        live(C_ID, 57, { startDate: "2026-10-14", scheduleStartDate: "2026-10-14" }),
                    ],
                    plannedSessions: dates3.map((serviceDate, offset) => ({
                        sessionIndex: offset + 1,
                        serviceDate,
                        originalDate: serviceDate,
                        assignmentId: ownerOf(offset + 1).id,
                        scheduleId: ownerOf(offset + 1).scheduleId,
                        employeeId: ownerOf(offset + 1).employeeId,
                        provenanceVersion: "case-7",
                    })),
                };
            }

            it("asks the caller to choose among the other live assignments, never reports an empty split", () => {
                const src = allHistoricalRemainingSource();
                let thrown: ServiceRecordResumeAssignmentError | null = null;
                try {
                    resumeOf(src, { fromSessionIndex: 2, resumeDate: "2026-10-14" });
                } catch (error) {
                    thrown = error as ServiceRecordResumeAssignmentError;
                }
                expect(thrown?.code).toBe("INCOMING_ASSIGNMENT_REQUIRED");
                expect(thrown?.message).not.toContain("belong to more than one caregiver");
                // B is the outgoing caregiver and cannot be chosen as its own successor; C can.
                expect(thrown?.candidates).toEqual([{ assignmentId: C_ID, employeeName: "관리사57" }]);
                const chosen = writesOf(src, { fromSessionIndex: 2, resumeDate: "2026-10-14", incomingAssignmentId: C_ID });
                expect(chosen?.reasons).toEqual([]);
                expect(chosen?.plan?.incomingAssignmentId).toBe(C_ID);
            });
        });

        describe("an authoritative split survives an all-historical kept prefix", () => {
            /**
             * Persisted owners A, B, C on 10-14, 10-15, 10-26. A (schedule 55) is replaced, stored [10-01, 10-01],
             * and wrote session 1 (historical: 10-14 is outside her period). B (56, [10-15, 10-23]) and
             * C (57, [10-24, 10-30]) are live and have written nothing.
             */
            function splitSource(cOverrides: Record<string, unknown> = {}): ServiceRecordEditSource {
                const base = goldenSource();
                const dates3 = ["2026-10-14", "2026-10-15", "2026-10-26"];
                const owner = (index: number) => (index === 1
                    ? { id: A_ID, scheduleId: 55, employeeId: 9 }
                    : index === 2 ? { id: B_ID, scheduleId: 56, employeeId: 10 } : { id: C_ID, scheduleId: 57, employeeId: 157 });
                return {
                    ...base,
                    requiredSessionCount: 3,
                    startDate: "2026-10-14",
                    endDate: "2026-10-26",
                    client: { ...base.client, startDate: "2026-10-14", endDate: "2026-10-26" },
                    sessions: [{ ...base.sessions[0]!, serviceDate: "2026-10-14" }],
                    assignments: [
                        { ...base.assignments[0]!, endDate: "2026-10-01", scheduleEndDate: "2026-10-01" },
                        { ...base.assignments[1]!, startDate: "2026-10-15", scheduleStartDate: "2026-10-15", endDate: "2026-10-23", scheduleEndDate: "2026-10-23" },
                        live(C_ID, 57, { startDate: "2026-10-24", scheduleStartDate: "2026-10-24", endDate: "2026-10-30", scheduleEndDate: "2026-10-30", ...cOverrides }),
                    ],
                    plannedSessions: dates3.map((serviceDate, offset) => ({
                        sessionIndex: offset + 1,
                        serviceDate,
                        originalDate: serviceDate,
                        assignmentId: owner(offset + 1).id,
                        scheduleId: owner(offset + 1).scheduleId,
                        employeeId: owner(offset + 1).employeeId,
                        provenanceVersion: "case-7",
                    })),
                };
            }

            it("keeps the split on a resume from session 2 once a from-1 correction made A's row historical-only", () => {
                // From session 1 on Thu 10-22: 10-22, Fri 10-23, Mon 10-26 (no holiday). Owners stay A, B, C. A's
                // session 1 is outside [10-01, 10-01]: A is historical-only and no edge. The first and last
                // non-historical-only sessions are 2 (10-23) and 3 (10-26): B, the head, starts 10-23 (end 10-23
                // stays); C, the tail, ends 10-26 (start 10-24 stays); A keeps [10-01, 10-01].
                const first = writesOf(splitSource(), { fromSessionIndex: 1, resumeDate: "2026-10-22" });
                expect(first?.reasons).toEqual([]);
                expect(owners(first?.plan?.entries)).toEqual([A_ID, B_ID, C_ID]);
                expect(dates(first?.plan?.entries)).toEqual(["2026-10-22", "2026-10-23", "2026-10-26"]);
                expect(compact(first?.plan?.assignmentWrites)).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01", false],
                    [B_ID, "2026-10-23", "2026-10-23", true],
                    [C_ID, "2026-10-24", "2026-10-26", true],
                ]);
                // Resume session 2 on 10-23: sessions 2, 3 stay on 10-23 and 10-26 (the next business day after
                // Fri 10-23 is Mon 10-26). Kept session 1 is A's historical slot: no outgoing caregiver. B and C
                // are the remaining owners, both live, in a persisted vector: nobody takes over and nothing moves.
                const second = writesOf(stateAfter(splitSource(), first!.plan), { fromSessionIndex: 2, resumeDate: "2026-10-23" });
                expect(second?.reasons).toEqual([]);
                expect(second?.plan?.incomingAssignmentId).toBeNull();
                expect(owners(second?.plan?.entries)).toEqual([A_ID, B_ID, C_ID]);
                expect(dates(second?.plan?.entries)).toEqual(["2026-10-22", "2026-10-23", "2026-10-26"]);
                expect(compact(second?.plan?.assignmentWrites)).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01", false],
                    [B_ID, "2026-10-23", "2026-10-23", false],
                    [C_ID, "2026-10-24", "2026-10-26", false],
                ]);
            });

            it("still trusts only an authoritative split: a replaced remaining owner is not settled", () => {
                // C is replaced too, but its session 3 (10-26) lies inside its own period [10-24, 10-30], so it is
                // a real remaining owner; the split is no longer all-live and needs a choice among the live
                // successors of A (schedule order): B (56) only, since C (57) is superseded.
                const resolution = writesOf(splitSource({ replaced: true }), { fromSessionIndex: 2, resumeDate: "2026-10-23" });
                expect(resolution?.reasons).toEqual([]);
                expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
            });
        });

        describe("anchors and the incoming caregiver follow the replanned dates", () => {
            /**
             * A (55) is replaced, stored [10-15, 10-15], and wrote sessions 1 and 2 on 10-14 and 10-15. B (56, live,
             * [10-16, 10-23]) owns session 3 on 10-16. C (57, live, [10-26, 10-30]) owns nothing.
             */
            function replannedSource(): ServiceRecordEditSource {
                const base = goldenSource();
                const dates3 = ["2026-10-14", "2026-10-15", "2026-10-16"];
                const owner = (index: number) => (index < 3
                    ? { id: A_ID, scheduleId: 55, employeeId: 9 }
                    : { id: B_ID, scheduleId: 56, employeeId: 10 });
                return {
                    ...base,
                    requiredSessionCount: 3,
                    startDate: "2026-10-14",
                    endDate: "2026-10-16",
                    client: { ...base.client, startDate: "2026-10-14", endDate: "2026-10-16" },
                    sessions: dates3.slice(0, 2).map((serviceDate, offset) => ({
                        ...base.sessions[0]!,
                        id: `day-${offset + 1}`,
                        sourceRowId: `day-${offset + 1}`,
                        sessionIndex: offset + 1,
                        rawCaseSessionIndex: offset + 1,
                        rawSessionIndex: offset + 1,
                        serviceDate,
                    })),
                    assignments: [
                        { ...base.assignments[0]!, startDate: "2026-10-15", scheduleStartDate: "2026-10-15", endDate: "2026-10-15", scheduleEndDate: "2026-10-15" },
                        { ...base.assignments[1]!, startDate: "2026-10-16", scheduleStartDate: "2026-10-16", endDate: "2026-10-23", scheduleEndDate: "2026-10-23" },
                        live(C_ID, 57, { startDate: "2026-10-26", scheduleStartDate: "2026-10-26", endDate: "2026-10-30", scheduleEndDate: "2026-10-30" }),
                    ],
                    plannedSessions: dates3.map((serviceDate, offset) => ({
                        sessionIndex: offset + 1,
                        serviceDate,
                        originalDate: serviceDate,
                        assignmentId: owner(offset + 1).id,
                        scheduleId: owner(offset + 1).scheduleId,
                        employeeId: owner(offset + 1).employeeId,
                        provenanceVersion: "case-7",
                    })),
                };
            }

            it("resolves the incoming caregiver to B when the replan makes A's session 2 historical", () => {
                // Resume session 2 on Tue 10-20: session 2 moves to 10-20, session 3 to Wed 10-21. A's [10-15, 10-15]
                // no longer reaches session 2 (nor session 1 on 10-14): both are A's kept writer slots, so A
                // is historical-only, there is no outgoing caregiver, and B is the one period-bearing remaining owner.
                // Session 2's row was written by A, so it stays with A; session 3 is B's. Nothing is handed over,
                // and the edge sessions are the first and last owned by a caregiver who is not historical-only:
                // only session 3 (10-21), so B, the head, starts 10-21 (end 10-23 stays); C [10-26, 10-30] cannot
                // take the tail date 10-21 and keeps its dates; A keeps [10-15, 10-15].
                const src = replannedSource();
                const resolution = writesOf(src, { fromSessionIndex: 2, resumeDate: "2026-10-20" });
                expect(resolution?.reasons).toEqual([]);
                expect(resolution?.plan?.incomingAssignmentId).toBe(B_ID);
                expect(owners(resolution?.plan?.entries)).toEqual([A_ID, A_ID, B_ID]);
                expect(dates(resolution?.plan?.entries)).toEqual(["2026-10-14", "2026-10-20", "2026-10-21"]);
                expect(compact(resolution?.plan?.assignmentWrites)).toEqual([
                    [A_ID, "2026-10-15", "2026-10-15", false],
                    [B_ID, "2026-10-21", "2026-10-23", true],
                    [C_ID, "2026-10-26", "2026-10-30", false],
                ]);
                expect(previewOf(src, resumeOf(src, { fromSessionIndex: 2, resumeDate: "2026-10-20" }).changes).blockingReasons).toEqual([]);
            });
        });

        describe("an interleaved owner that keeps its row", () => {
            it("keeps A [10-01, 10-01], the writer and the row, warns about the mismatch and blocks nothing", () => {
                // Written by hand: A wrote sessions 1 and 3; B owns the rest. Resuming from session 2 on 10-14
                // gives session 3 the date 10-15, outside A's period.
                const base = goldenSource();
                const ownerOf = (index: number) => (index === 1 || index === 3 ? { id: A_ID, scheduleId: 55, employeeId: 9 } : { id: B_ID, scheduleId: 56, employeeId: 10 });
                const src: ServiceRecordEditSource = {
                    ...base,
                    sessions: [base.sessions[0]!, { ...base.sessions[2]!, scheduleId: 55, employeeId: 9, employeeNameSnapshot: "관리사A" }],
                    assignments: [
                        { ...base.assignments[0]!, endDate: "2026-10-01", scheduleEndDate: "2026-10-01" },
                        { ...base.assignments[1]!, startDate: "2026-10-02", scheduleStartDate: "2026-10-02" },
                    ],
                    plannedSessions: OLD_DATES.map((serviceDate, offset) => ({
                        sessionIndex: offset + 1,
                        serviceDate,
                        originalDate: serviceDate,
                        assignmentId: ownerOf(offset + 1).id,
                        scheduleId: ownerOf(offset + 1).scheduleId,
                        employeeId: ownerOf(offset + 1).employeeId,
                        provenanceVersion: "case-7",
                    })),
                };
                const resolution = writesOf(src, golden);
                expect(resolution?.reasons).toEqual([]);
                expect(owners(resolution?.plan?.entries)).toEqual([A_ID, B_ID, A_ID, ...Array<string>(12).fill(B_ID)]);
                expect(dates(resolution?.plan?.entries)?.[2]).toBe("2026-10-15");
                expect(compact(resolution?.plan?.assignmentWrites)).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01", false],
                    [B_ID, "2026-10-14", "2026-11-02", true],
                ]);
                const preview = previewOf(src, resumeOf(src, golden).changes);
                expect(preview.blockingReasons).toEqual([]);
                expect(preview.warnings?.map(({ code, sessionIndex, assignmentId }) => [code, sessionIndex, assignmentId]))
                    .toEqual([["ASSIGNMENT_MISMATCH", 3, A_ID]]);
            });
        });

        describe("a resume writes what the next confirm would compute (a follow-up confirm moves nothing)", () => {
            const Z_ID = C_ID;
            /** A session row written by `owner`, submitted on the date the session ends up on. */
            const dayOf = (
                sessionIndex: number,
                owner: { scheduleId: number; employeeId: number },
                serviceDate: string,
                submittedOn: string,
            ) => {
                const base = goldenSource().sessions[0]!;
                return {
                    ...base,
                    id: `day-${sessionIndex}`,
                    sourceRowId: `day-${sessionIndex}`,
                    sessionIndex,
                    rawCaseSessionIndex: sessionIndex,
                    rawSessionIndex: sessionIndex,
                    scheduleId: owner.scheduleId,
                    employeeId: owner.employeeId,
                    serviceDate,
                    submittedAt: `${submittedOn}T09:00:00.000Z`,
                    clientSignedAt: `${submittedOn}T08:59:00.000Z`,
                };
            };
            const A = { id: A_ID, scheduleId: 55, employeeId: 9 };
            const B = { id: B_ID, scheduleId: 56, employeeId: 10 };
            const Z = { id: Z_ID, scheduleId: 54, employeeId: 154 }; // `live` gives schedule + 100
            const period = (startDate: string, endDate: string) =>
                ({ startDate, scheduleStartDate: startDate, endDate, scheduleEndDate: endDate });
            /** Three sessions on the stored dates 10-01, 10-02, 10-06; the caller gives owners, rows and periods. */
            function threeSessions(
                owners: ReadonlyArray<{ id: string; scheduleId: number; employeeId: number }>,
                rows: ServiceRecordEditSource["sessions"],
                assignments: ServiceRecordEditSource["assignments"],
            ): ServiceRecordEditSource {
                const base = goldenSource();
                const dates3 = ["2026-10-01", "2026-10-02", "2026-10-06"];
                return {
                    ...base,
                    requiredSessionCount: 3,
                    startDate: "2026-10-01",
                    endDate: "2026-10-06",
                    client: { ...base.client, endDate: "2026-10-06" },
                    sessions: rows,
                    assignments,
                    plannedSessions: dates3.map((serviceDate, offset) => ({
                        sessionIndex: offset + 1,
                        serviceDate,
                        originalDate: serviceDate,
                        assignmentId: owners[offset]!.id,
                        scheduleId: owners[offset]!.scheduleId,
                        employeeId: owners[offset]!.employeeId,
                        provenanceVersion: "case-7",
                    })),
                };
            }
            const aRow = (overrides: Record<string, unknown>) => ({ ...goldenSource().assignments[0]!, ...overrides }) as ServiceRecordEditSource["assignments"][number];
            const bRow = (overrides: Record<string, unknown>) => ({ ...goldenSource().assignments[1]!, ...overrides }) as ServiceRecordEditSource["assignments"][number];
            const zRow = (overrides: Record<string, unknown>) => live(Z_ID, 54, { replaced: true, ...overrides });

            /**
             * Plans the resume, builds the record as the confirm leaves it and asks the ordinary confirm what it
             * would write over it: nothing may move, and a header-only edit of it previews without a boundary.
             */
            function settledPlan(src: ServiceRecordEditSource, input: Parameters<typeof resumeOf>[1]) {
                const resolution = writesOf(src, input);
                expect(resolution?.reasons).toEqual([]);
                const plan = resolution!.plan!;
                const state = stateAfter(src, plan);
                const next = confirmAssignmentWrites(state, plan.entries);
                expect(compact(next)).toEqual(compact(plan.assignmentWrites)?.map(([id, start, end]) => [id, start, end, false]));
                const preview = previewOf(state, { header: { momName: "수정" } });
                expect(preview.blockingReasons).toEqual([]);
                expect(compact(confirmAssignmentWrites(state, preview.after.sessions))).toEqual(compact(next));
                return plan;
            }

            it("ends the incoming caregiver on its own last session, not on a historical writer's kept tail slot (from 1)", () => {
                // A (replaced, [10-01, 10-14]) wrote only session 3. Resume from 1 on 10-14: 10-14, 10-15, 10-16. Sessions 1
                // and 2 go to B; session 3 stays A's and on 10-16 is outside A's period, so A is historical-only.
                // B starts on 10-14 and ends on its own last session, 10-15; the last date 10-16 is not B's.
                const src = threeSessions(
                    [A, A, A],
                    [dayOf(3, A, "2026-10-06", "2026-10-16")] as never,
                    [aRow(period("2026-10-01", "2026-10-14")), bRow(period("2026-10-14", "2026-10-23"))],
                );
                const plan = settledPlan(src, { fromSessionIndex: 1, resumeDate: "2026-10-14" });
                expect(dates(plan.entries)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16"]);
                expect(owners(plan.entries)).toEqual([B_ID, B_ID, A_ID]);
                expect(compact(plan.assignmentWrites)).toEqual([
                    [A_ID, "2026-10-01", "2026-10-14", false],
                    [B_ID, "2026-10-14", "2026-10-15", true],
                ]);
                expect(plan.assignmentPeriods.map(({ assignmentId, after }) => [assignmentId, after.startDate, after.endDate]))
                    .toEqual([[B_ID, "2026-10-14", "2026-10-15"]]);
            });

            it("ends a continuing caregiver on its own last session before a historical writer's tail (plain pause)", () => {
                // B (live, [10-01, 10-06]) owns sessions 1 and 2 and wrote session 1; A (replaced, [10-01, 10-01]) wrote
                // session 3. Resume from 2 on 10-14: session 2 -> 10-14, session 3 -> 10-15 (outside A's period: historical).
                const src = threeSessions(
                    [B, B, A],
                    [dayOf(1, B, "2026-10-01", "2026-10-01"), dayOf(3, A, "2026-10-06", "2026-10-15")] as never,
                    [aRow(period("2026-10-01", "2026-10-01")), bRow(period("2026-10-01", "2026-10-06"))],
                );
                const plan = settledPlan(src, { fromSessionIndex: 2, resumeDate: "2026-10-14" });
                expect(plan.incomingAssignmentId).toBe(B_ID);
                expect(dates(plan.entries)).toEqual(["2026-10-01", "2026-10-14", "2026-10-15"]);
                expect(owners(plan.entries)).toEqual([B_ID, B_ID, A_ID]);
                expect(compact(plan.assignmentWrites)).toEqual([
                    [A_ID, "2026-10-01", "2026-10-01", false],
                    [B_ID, "2026-10-01", "2026-10-14", true],
                ]);
            });

            it("with an outgoing, a historical-only tail writer and an incoming caregiver, the incoming one ends on its own session (from 2)", () => {
                // Z (replaced, [10-01, 10-01]) wrote session 1; A (replaced, [10-02, 10-02]) wrote session 3; B (live,
                // [10-14, 10-23]) is named. Session 2 -> 10-14 goes to B, session 3 -> 10-15 stays A's (historical).
                const src = threeSessions(
                    [Z, Z, A],
                    [dayOf(1, Z, "2026-10-01", "2026-10-01"), dayOf(3, A, "2026-10-06", "2026-10-15")] as never,
                    [zRow(period("2026-10-01", "2026-10-01")), aRow(period("2026-10-02", "2026-10-02")), bRow(period("2026-10-14", "2026-10-23"))],
                );
                const plan = settledPlan(src, { fromSessionIndex: 2, resumeDate: "2026-10-14", incomingAssignmentId: B_ID });
                expect(owners(plan.entries)).toEqual([Z_ID, B_ID, A_ID]);
                expect(dates(plan.entries)).toEqual(["2026-10-01", "2026-10-14", "2026-10-15"]);
                expect(compact(plan.assignmentWrites)).toEqual([
                    [Z_ID, "2026-10-01", "2026-10-01", false],
                    [A_ID, "2026-10-02", "2026-10-02", false],
                    [B_ID, "2026-10-14", "2026-10-14", true],
                ]);
            });

            it("writes the replaced caregiver's own period on the resume day too (from 1), and shows it", () => {
                // A (replaced, [10-01, 10-14]) wrote session 1; every session is A's. Resume from 1 on 10-14: A keeps the
                // row it wrote, now dated 10-14 inside its period, so A is the head and starts there ([10-14, 10-14]).
                // B takes 2 and 3 (10-15, 10-16). The follow-up confirm would have moved A the same way.
                const src = threeSessions(
                    [A, A, A],
                    [dayOf(1, A, "2026-10-01", "2026-10-14")] as never,
                    [aRow(period("2026-10-01", "2026-10-14")), bRow(period("2026-10-14", "2026-10-23"))],
                );
                const plan = settledPlan(src, { fromSessionIndex: 1, resumeDate: "2026-10-14" });
                expect(owners(plan.entries)).toEqual([A_ID, B_ID, B_ID]);
                expect(compact(plan.assignmentWrites)).toEqual([
                    [A_ID, "2026-10-14", "2026-10-14", true],
                    [B_ID, "2026-10-15", "2026-10-16", true],
                ]);
                expect(plan.assignmentPeriods).toEqual([
                    { assignmentId: A_ID, employeeName: "관리사A", before: { startDate: "2026-10-01", endDate: "2026-10-14" }, after: { startDate: "2026-10-14", endDate: "2026-10-14" } },
                    { assignmentId: B_ID, employeeName: "관리사B", before: { startDate: "2026-10-14", endDate: "2026-10-23" }, after: { startDate: "2026-10-15", endDate: "2026-10-16" } },
                ]);
                // The preview agrees with the plan: its provenance classifies against the periods that will be written.
                const preview = previewOf(src, resumeOf(src, { fromSessionIndex: 1, resumeDate: "2026-10-14" }).changes);
                expect(preview.blockingReasons).toEqual([]);
                expect(preview.assignmentPeriods).toEqual(plan.assignmentPeriods);
                expect(preview.provenance.map(({ assignmentId, startDate, endDate }) => [assignmentId, startDate, endDate]))
                    .toEqual([[A_ID, "2026-10-14", "2026-10-14"], [B_ID, "2026-10-15", "2026-10-16"]]);
            });
        });

        describe("a seeded property: every resume the preview accepts leaves a state the next confirm does not move", () => {
            // Deterministic: a fixed PRNG per case, so a failure prints the seed and the case that reproduces it.
            const mulberry32 = (seed: number) => {
                let state = seed >>> 0;
                return () => {
                    state = (state + 0x6d2b79f5) >>> 0;
                    let t = state;
                    t = Math.imul(t ^ (t >>> 15), t | 1);
                    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                };
            };
            // Schedule order is the succession order: Z (54) came first, then A (55), B (56), D (57) and E (58).
            const E_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
            const CAREGIVERS = [
                { id: C_ID, scheduleId: 54 },
                { id: A_ID, scheduleId: 55 },
                { id: B_ID, scheduleId: 56 },
                { id: D_ID, scheduleId: 57 },
                { id: E_ID, scheduleId: 58 },
            ] as const;
            type Caregiver = (typeof CAREGIVERS)[number];
            // Business days of October 2026 (10-03..10-05 weekend + substitute holiday, 10-09 Hangul Day).
            const STORED_DATES = ["2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-12"];
            const PERIOD_DATES = [
                "2026-09-28", "2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13",
                "2026-10-14", "2026-10-15", "2026-10-20", "2026-10-23", "2026-10-30",
            ];
            const RESUME_DATES = ["2026-10-07", "2026-10-08", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-20"];
            const SUBMITTED_ON = "2026-11-30"; // after every date a plan can reach: no submission precedes a new date

            /**
             * `mismatched` is `unconstrained` plus assignment rows whose assignment and schedule columns disagree
             * (the two tables are not always kept in step).
             */
            type CaseMode = "unconstrained" | "ordered" | "mismatched";
            type CaregiverState = "live" | "replaced" | "terminated";
            interface PropertyCase {
                src: ServiceRecordEditSource;
                input: Parameters<typeof resumeOf>[1];
                summary: unknown;
                /** How many assignments the record has: the settle needs about one pass per assignment. */
                assignmentCount: number;
            }
            interface RecordSpec {
                caregivers: readonly Caregiver[];
                states: readonly CaregiverState[];
                /** Each caregiver's assignment period; the schedule columns equal it unless `schedulePeriods` says otherwise. */
                periods: ReadonlyArray<readonly [string, string]>;
                schedulePeriods?: ReadonlyArray<readonly [string, string]>;
                storedDates: readonly string[];
                /** Who owns each stored session in the persisted vector. */
                owners: readonly Caregiver[];
                /** Whether each session has a day row, written by its owner. */
                written: readonly boolean[];
            }

            function assembleSource(spec: RecordSpec): ServiceRecordEditSource {
                const { caregivers, states, periods, storedDates, owners } = spec;
                const schedulePeriods = spec.schedulePeriods ?? periods;
                const assignments = caregivers.map((caregiver, index) => live(caregiver.id, caregiver.scheduleId, {
                    startDate: periods[index]![0],
                    scheduleStartDate: schedulePeriods[index]![0],
                    endDate: periods[index]![1],
                    scheduleEndDate: schedulePeriods[index]![1],
                    replaced: states[index] === "replaced",
                    scheduleTerminatedAt: states[index] === "terminated" ? "2026-10-05T00:00:00.000Z" : null,
                })) as ServiceRecordEditSource["assignments"];
                const base = goldenSource();
                const rows = storedDates.flatMap((serviceDate, offset) => {
                    if (!spec.written[offset]) return [];
                    const owner = owners[offset]!;
                    return [{
                        ...base.sessions[0]!,
                        id: `day-${offset + 1}`,
                        sourceRowId: `day-${offset + 1}`,
                        sessionIndex: offset + 1,
                        rawCaseSessionIndex: offset + 1,
                        rawSessionIndex: offset + 1,
                        scheduleId: owner.scheduleId,
                        employeeId: owner.scheduleId + 100,
                        serviceDate,
                        submittedAt: `${SUBMITTED_ON}T09:00:00.000Z`,
                        clientSignedAt: `${SUBMITTED_ON}T08:59:00.000Z`,
                    }];
                });
                return {
                    ...base,
                    requiredSessionCount: storedDates.length,
                    startDate: storedDates[0]!,
                    endDate: storedDates.at(-1)!,
                    client: { ...base.client, duration: storedDates.length, endDate: storedDates.at(-1)! },
                    sessions: rows as never,
                    assignments,
                    plannedSessions: storedDates.map((serviceDate, offset) => ({
                        sessionIndex: offset + 1,
                        serviceDate,
                        originalDate: serviceDate,
                        assignmentId: owners[offset]!.id,
                        scheduleId: owners[offset]!.scheduleId,
                        employeeId: owners[offset]!.scheduleId + 100,
                        provenanceVersion: "case-7",
                    })),
                };
            }

            function generateCase(seed: number, mode: CaseMode): PropertyCase {
                const rng = mulberry32(seed);
                const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
                const chance = (p: number) => rng() < p;
                const orderedPair = (): readonly [string, string] => {
                    const first = pick(PERIOD_DATES);
                    const second = pick(PERIOD_DATES);
                    return first <= second ? [first, second] : [second, first];
                };
                // 2..5 caregivers, kept in schedule order.
                const wanted = 2 + Math.floor(rng() * 4);
                const chosen = new Set<number>();
                while (chosen.size < wanted) chosen.add(Math.floor(rng() * CAREGIVERS.length));
                const caregivers = CAREGIVERS.filter((_, index) => chosen.has(index));
                const sessionCount = 1 + Math.floor(rng() * STORED_DATES.length); // 1..6
                const storedDates = STORED_DATES.slice(0, sessionCount);

                // Periods: any start <= end, or ordered by schedule with each earlier one ending where the next begins.
                const sortedPicks = Array.from({ length: caregivers.length * 2 }, () => Math.floor(rng() * PERIOD_DATES.length))
                    .sort((left, right) => left - right).map((index) => PERIOD_DATES[index]!);
                const periods = caregivers.map((_, index) => (mode === "ordered"
                    ? [sortedPicks[index * 2]!, sortedPicks[index * 2 + 1]!] as const
                    : orderedPair()));
                // A column that disagrees with its assignment twin.
                const schedulePeriods = periods.map((period) => {
                    if (mode !== "mismatched" || !chance(0.3)) return period;
                    const other = orderedPair();
                    return chance(0.5) ? [other[0], period[1]] as const : [period[0], other[1]] as const;
                }).map((period) => (period[0] <= period[1] ? period : [period[1], period[0]] as const));
                const states = caregivers.map((_, index) => (index === caregivers.length - 1 && chance(0.7)
                    ? "live"
                    : pick(["live", "replaced", "terminated"] as const)));

                const owners = storedDates.map(() => pick(caregivers));
                const rowChance = pick([0, 0.3 + rng() * 0.2, 1] as const);
                const written = storedDates.map(() => chance(rowChance));
                const src = assembleSource({ caregivers, states, periods, schedulePeriods, storedDates, owners, written });
                const input: Parameters<typeof resumeOf>[1] = {
                    fromSessionIndex: 1 + Math.floor(rng() * sessionCount),
                    resumeDate: pick(RESUME_DATES),
                    ...(chance(0.25) ? { incomingAssignmentId: pick(caregivers).id } : {}),
                    ...(chance(0.15) ? { outgoingLastServedDate: pick(PERIOD_DATES) } : {}),
                };
                return {
                    src,
                    input,
                    assignmentCount: caregivers.length,
                    summary: {
                        mode,
                        input,
                        storedDates,
                        owners: owners.map((owner) => owner.scheduleId),
                        writtenSessions: written.flatMap((flag, offset) => (flag ? [[offset + 1, owners[offset]!.scheduleId]] : [])),
                        assignments: caregivers.map((caregiver, index) => [caregiver.scheduleId, states[index], ...periods[index]!, ...schedulePeriods[index]!]),
                    },
                };
            }

            /** The record as the repository leaves it: a write with `datesChanged: false` is skipped. */
            function reloadedAfter(src: ServiceRecordEditSource, plan: NonNullable<ReturnType<typeof resolveResumeReplan>>["plan"]): ServiceRecordEditSource {
                const dateOf = (sessionIndex: number) => plan!.entries.find((entry) => entry.sessionIndex === sessionIndex)!.serviceDate;
                return {
                    ...src,
                    startDate: plan!.entries[0]!.serviceDate,
                    endDate: plan!.endDate,
                    sessions: src.sessions.map((session) => ({ ...session, serviceDate: dateOf(session.sessionIndex) })),
                    assignments: src.assignments.map((assignment) => {
                        const write = plan!.assignmentWrites.find((candidate) => candidate.assignmentId === assignment.id);
                        return write?.datesChanged
                            ? { ...assignment, startDate: write.startDate, endDate: write.endDate, scheduleStartDate: write.startDate, scheduleEndDate: write.endDate }
                            : assignment;
                    }),
                    plannedSessions: plan!.entries.map((entry) => ({ ...entry })) as never,
                };
            }

            /** The settle bound is sized to the record: a resume is never refused for "do not settle" at the default bound. */
            const refusal = (code: string, message: string): string => {
                if (message.includes("do not settle")) throw new Error(`refused for not settling at the default bound: ${message}`);
                return `rejected:${code}`;
            };

            /** "accepted" or "rejected:<code>"; throws a violation message when an accepted resume breaks the invariant. */
            function judge(testCase: PropertyCase, mode: CaseMode): string {
                let changes: ServiceRecordEditJsonValue;
                try {
                    changes = resumeOf(testCase.src, testCase.input).changes;
                } catch (error) {
                    if (error instanceof ServiceRecordScheduleValidationError || error instanceof ServiceRecordResumeAssignmentError) {
                        return refusal(error.code, error.message);
                    }
                    throw error;
                }
                const preview = previewOf(testCase.src, changes);
                if (preview.blockingReasons.length > 0) {
                    return refusal(preview.blockingReasons[0]!.code, JSON.stringify(preview.blockingReasons));
                }
                const plan = resolveResumeReplan(testCase.src, changes, KR_BUILTIN_CALENDAR)?.plan;
                if (!plan) throw new Error("the preview accepts but no plan resolves");

                // after == plan entries
                const shape = (entries: ReadonlyArray<{ sessionIndex: number; serviceDate: string; assignmentId: string | null }>) =>
                    entries.map((entry) => [entry.sessionIndex, entry.serviceDate, entry.assignmentId]);
                if (JSON.stringify(shape(preview.after.sessions as never)) !== JSON.stringify(shape(plan.entries))) {
                    throw new Error("preview.after.sessions differs from the plan entries");
                }
                // every written boundary is shown
                const written = plan.assignmentWrites.filter((write) => write.datesChanged);
                for (const write of written) {
                    const shown = plan.assignmentPeriods.find((candidate) => candidate.assignmentId === write.assignmentId);
                    if (!shown || shown.after.startDate !== write.startDate || shown.after.endDate !== write.endDate) {
                        throw new Error(`a written boundary is not in assignmentPeriods: ${write.assignmentId} ${write.startDate}..${write.endDate}`);
                    }
                }
                if (JSON.stringify(preview.assignmentPeriods) !== JSON.stringify(plan.assignmentPeriods)) {
                    throw new Error("preview.assignmentPeriods differs from the plan's");
                }

                // the next confirm moves nothing
                const state = reloadedAfter(testCase.src, plan);
                const header = previewOf(state, { header: { momName: "수정" } });
                if (header.blockingReasons.length > 0) {
                    throw new Error(`a header-only preview after the resume is blocked: ${JSON.stringify(header.blockingReasons)}`);
                }
                let next: ReturnType<typeof confirmAssignmentWrites>;
                try {
                    next = confirmAssignmentWrites(state, header.after.sessions);
                } catch (error) {
                    throw new Error(`the confirm after the resume throws: ${(error as Error).message}`);
                }
                const moved = next.filter((write) => write.datesChanged);
                if (moved.length === 0) return "accepted";
                // Where the two tables disagreed, a confirm writes the assignment table's dates into the schedule row
                // (a heal that any confirm of the record makes, with or without a resume). Anything else is a moved period.
                const heals = moved.every((write) => {
                    const row = state.assignments.find((candidate) => candidate.id === write.assignmentId)!;
                    return mode === "mismatched"
                        && (row.startDate !== row.scheduleStartDate || row.endDate !== row.scheduleEndDate)
                        && write.startDate === row.startDate && write.endDate === row.endDate;
                });
                if (!heals) throw new Error(`the confirm after the resume moves ${JSON.stringify(compact(moved))}`);
                return "accepted:heals";
            }

            it("refuses a resume the single-pass settle accepted and whose written periods made the next confirm throw", () => {
                // Seed 1005689 of the unconstrained run. Two sessions stored 10-01 (B's) and 10-02 (Z's, written by Z).
                // Z (live) is stored [10-06, 10-06], so its row is a historical slot; A (live, [10-02, 10-08]) owns no
                // session; B (live) is stored [10-07, 10-08]. Resume from 1 on Wed 10-07 naming B, the owner of session 1:
                // the plan dates are 10-07 (B's session 1) and 10-08 (Z's kept row, a historical slot).
                const base = goldenSource();
                const days = ["2026-10-01", "2026-10-02"];
                const periodOf = (startDate: string, endDate: string) =>
                    ({ startDate, scheduleStartDate: startDate, endDate, scheduleEndDate: endDate });
                const src: ServiceRecordEditSource = {
                    ...base,
                    requiredSessionCount: 2,
                    startDate: days[0]!,
                    endDate: days[1]!,
                    client: { ...base.client, duration: 2, endDate: days[1]! },
                    sessions: [{
                        ...base.sessions[0]!,
                        id: "day-2", sourceRowId: "day-2", sessionIndex: 2, rawCaseSessionIndex: 2, rawSessionIndex: 2,
                        scheduleId: 54, employeeId: 154, serviceDate: days[1]!,
                        submittedAt: `${SUBMITTED_ON}T09:00:00.000Z`, clientSignedAt: `${SUBMITTED_ON}T08:59:00.000Z`,
                    }] as never,
                    assignments: [
                        live(C_ID, 54, periodOf("2026-10-06", "2026-10-06")),
                        live(A_ID, 55, periodOf("2026-10-02", "2026-10-08")),
                        live(B_ID, 56, periodOf("2026-10-07", "2026-10-08")),
                    ] as ServiceRecordEditSource["assignments"],
                    plannedSessions: [
                        { sessionIndex: 1, serviceDate: days[0]!, originalDate: days[0]!, assignmentId: B_ID, scheduleId: 56, employeeId: 156, provenanceVersion: "case-7" },
                        { sessionIndex: 2, serviceDate: days[1]!, originalDate: days[1]!, assignmentId: C_ID, scheduleId: 54, employeeId: 154, provenanceVersion: "case-7" },
                    ],
                };
                const input = { fromSessionIndex: 1, resumeDate: "2026-10-07", incomingAssignmentId: B_ID };

                // The single-pass plan wrote A [10-07, 10-08] (the one settle pass moved the sessionless A onto the outer
                // edge) and left Z and B as stored. On that state the ordinary confirm (B's session on 10-07, Z's
                // historical slot on 10-08) throws, a failure nobody previewed.
                const entries = [
                    { sessionIndex: 1, serviceDate: "2026-10-07", originalDate: days[0]!, assignmentId: B_ID, scheduleId: 56, employeeId: 156, provenanceVersion: "case-7" },
                    { sessionIndex: 2, serviceDate: "2026-10-08", originalDate: days[1]!, assignmentId: C_ID, scheduleId: 54, employeeId: 154, provenanceVersion: "case-7" },
                ];
                const oldResult: ServiceRecordEditSource = {
                    ...src,
                    sessions: src.sessions.map((session) => ({ ...session, serviceDate: "2026-10-08" })),
                    assignments: src.assignments.map((row) => (row.id === A_ID ? { ...row, ...periodOf("2026-10-07", "2026-10-08") } : row)),
                    plannedSessions: entries as never,
                };
                expect(() => confirmAssignmentWrites(oldResult, entries as never)).toThrow(/start after its end/);

                // Now the preview refuses it instead: the settle does not accept a plan whose next confirm fails.
                expect(codeOf(() => resumeOf(src, input))).toBe("INVALID_ASSIGNMENT_RANGE");
            });

            describe("the settle bound scales with the record's assignments", () => {
                const [Z, A, B, D, E] = CAREGIVERS;
                const NOT_SETTLED = /do not settle/;
                /** The resume as `resolveResumeReplan` plans it, with the settle bound optionally overridden (tests only). */
                const planWith = (src: ServiceRecordEditSource, input: Parameters<typeof resumeOf>[1], options?: { maxSettlePasses?: number }) => {
                    const pending = KR_BUILTIN_CALENDAR.withServiceDays(storedServiceDays(src));
                    const projection = resolveServiceRecordScheduleProjection(src, pending);
                    return planResumeReplan(src, projection.entries, input, pending, options);
                };
                const periodsOf = (plan: ReturnType<typeof planWith>) =>
                    Object.fromEntries(plan.assignmentWrites.map((write) => [write.assignmentId, `${write.startDate}..${write.endDate}`]));
                const refusal = (run: () => unknown) => {
                    try {
                        run();
                    } catch (error) {
                        if (error instanceof ServiceRecordScheduleValidationError) return { code: error.code, message: error.message };
                        throw error;
                    }
                    return null;
                };
                /** The invariant: accepted by the preview, and the confirm after the reload moves no period. */
                const judged = (src: ServiceRecordEditSource, input: Parameters<typeof resumeOf>[1], assignmentCount: number) =>
                    judge({ src, input, summary: input, assignmentCount }, "unconstrained");

                it("pins the refusal: a resume whose periods are still moving when the bound ends is blocked, not written", () => {
                    // S8e. Sessions stored 10-01, 10-02, 10-06, every one A's in the vector, none written. A (replaced) is
                    // stored [10-01, 10-14]; B (live, A's successor) is stored [10-14, 10-23]. Resume from 1 on Wed 10-07:
                    // the plan dates are 10-07, 10-08, 10-12 and B takes all three, so B is written [10-07, 10-12].
                    // The outer-edge rule then pulls A, which owns nothing now, onto the same edge: A [10-07, 10-12]. Reaching
                    // that fixed point takes three passes (the third moves nothing): a bound of 1 or 2 refuses it.
                    const src = assembleSource({
                        caregivers: [A, B],
                        states: ["replaced", "live"],
                        periods: [["2026-10-01", "2026-10-14"], ["2026-10-14", "2026-10-23"]],
                        storedDates: STORED_DATES.slice(0, 3),
                        owners: [A, A, A],
                        written: [false, false, false],
                    });
                    const input = { fromSessionIndex: 1, resumeDate: "2026-10-07" };
                    for (const maxSettlePasses of [1, 2]) {
                        expect(refusal(() => planWith(src, input, { maxSettlePasses })))
                            .toEqual({ code: "INVALID_ASSIGNMENT_RANGE", message: expect.stringMatching(NOT_SETTLED) });
                    }
                    const expected = { [A_ID]: "2026-10-07..2026-10-12", [B_ID]: "2026-10-07..2026-10-12" };
                    expect(periodsOf(planWith(src, input, { maxSettlePasses: 3 }))).toEqual(expected);
                    // The default bound (assignments + 2) accepts it, through the preview as well.
                    expect(periodsOf(planWith(src, input))).toEqual(expected);
                    expect(previewOf(src, resumeOf(src, input).changes).blockingReasons).toEqual([]);
                    expect(judged(src, input, 2)).toBe("accepted");
                });

                it("accepts four assignments, which the old fixed bound of 4 passes refused (scenario A)", () => {
                    // One session stored 10-01, given to B (schedule 56) by the vector, no day rows. Z (54) is live
                    // [10-02, 10-14]; A (55) replaced [10-02, 10-15]; B (56) replaced [09-28, 10-12]; D (57) live [10-01, 10-07].
                    // Resume from 1 on Wed 10-07: the one session moves to 10-07 and D, the live successor of its replaced
                    // owner B, takes it: D [10-07, 10-07]. Every superseded period is then collapsed onto that edge, one more
                    // per pass (the reviewer's trace: B [09-28,10-12] -> [10-07,10-12] -> [10-07,10-07], then Z and A), so the fixed point is
                    // all four at [10-07, 10-07] and the pass that confirms it is the fifth: bounds up to 4 refuse it.
                    const src = assembleSource({
                        caregivers: [Z, A, B, D],
                        states: ["live", "replaced", "replaced", "live"],
                        periods: [["2026-10-02", "2026-10-14"], ["2026-10-02", "2026-10-15"], ["2026-09-28", "2026-10-12"], ["2026-10-01", "2026-10-07"]],
                        storedDates: STORED_DATES.slice(0, 1),
                        owners: [B],
                        written: [false],
                    });
                    const input = { fromSessionIndex: 1, resumeDate: "2026-10-07" };
                    expect(refusal(() => planWith(src, input, { maxSettlePasses: 4 })))
                        .toEqual({ code: "INVALID_ASSIGNMENT_RANGE", message: expect.stringMatching(NOT_SETTLED) });
                    const settled = { [C_ID]: "2026-10-07..2026-10-07", [A_ID]: "2026-10-07..2026-10-07", [B_ID]: "2026-10-07..2026-10-07", [D_ID]: "2026-10-07..2026-10-07" };
                    expect(periodsOf(planWith(src, input, { maxSettlePasses: 5 }))).toEqual(settled);
                    const plan = planWith(src, input);
                    expect(plan.incomingAssignmentId).toBe(D_ID);
                    expect(periodsOf(plan)).toEqual(settled);
                    expect(plan.assignmentWrites.every((write) => write.datesChanged)).toBe(true);
                    // Header-only preview not blocked, and the confirm on the reloaded state moves nothing.
                    expect(judged(src, input, 4)).toBe("accepted");
                });

                it("accepts five assignments with the invariant holding, and refuses them below the passes they need (scenario B)", () => {
                    // Seed 41004288 of the reviewer's fuzz. One session stored 10-01, owned by Z (54), no day rows.
                    // Z live [10-13, 10-30]; A (55) replaced [10-07, 10-20]; B (56) live [09-28, 10-20]; D (57) live
                    // [10-13, 10-15]; E (58) live [10-02, 10-14]. Resume from 1 on Wed 10-14: Z is live and keeps the session,
                    // moving it to 10-14 (a pause, no handover), and every other period is collapsed onto
                    // [10-14, 10-14], one more per pass. Six passes are needed (the sixth moves nothing):
                    // with the refusal removed, a 4-pass loop leaves D at [10-14, 10-15] and the next header confirm moves it.
                    const src = assembleSource({
                        caregivers: [Z, A, B, D, E],
                        states: ["live", "replaced", "live", "live", "live"],
                        periods: [["2026-10-13", "2026-10-30"], ["2026-10-07", "2026-10-20"], ["2026-09-28", "2026-10-20"], ["2026-10-13", "2026-10-15"], ["2026-10-02", "2026-10-14"]],
                        storedDates: STORED_DATES.slice(0, 1),
                        owners: [Z],
                        written: [false],
                    });
                    const input = { fromSessionIndex: 1, resumeDate: "2026-10-14" };
                    for (const maxSettlePasses of [4, 5]) {
                        expect(refusal(() => planWith(src, input, { maxSettlePasses })))
                            .toEqual({ code: "INVALID_ASSIGNMENT_RANGE", message: expect.stringMatching(NOT_SETTLED) });
                    }
                    const settled = Object.fromEntries([Z, A, B, D, E].map((caregiver) => [caregiver.id, "2026-10-14..2026-10-14"]));
                    expect(periodsOf(planWith(src, input, { maxSettlePasses: 6 }))).toEqual(settled);
                    expect(periodsOf(planWith(src, input))).toEqual(settled);
                    expect(judged(src, input, 5)).toBe("accepted");
                });
            });

            const CASES_PER_MODE = 1500;
            it.each([
                ["unconstrained", 1_000_000],
                ["ordered", 2_000_000],
                ["mismatched", 3_000_000],
            ] as const)("finds no violation over %s stored periods (seeded, %i + n)", (mode, seedBase) => {
                const failures: string[] = [];
                const outcomes = new Map<string, number>();
                const acceptedByAssignments = new Map<number, number>();
                for (let offset = 0; offset < CASES_PER_MODE; offset++) {
                    const seed = seedBase + offset;
                    const testCase = generateCase(seed, mode);
                    try {
                        const outcome = judge(testCase, mode);
                        outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
                        if (outcome.startsWith("accepted")) {
                            acceptedByAssignments.set(testCase.assignmentCount, (acceptedByAssignments.get(testCase.assignmentCount) ?? 0) + 1);
                        }
                    } catch (error) {
                        failures.push(`seed ${seed}: ${(error as Error).message}\n  ${JSON.stringify(testCase.summary)}`);
                    }
                }
                if (failures.length > 0) {
                    throw new Error(`${failures.length} of ${CASES_PER_MODE} cases violate the invariant; first ones:\n${failures.slice(0, 3).join("\n")}`);
                }
                // The generator must exercise the property: plenty of accepted resumes, not only rejections.
                expect((outcomes.get("accepted") ?? 0) + (outcomes.get("accepted:heals") ?? 0)).toBeGreaterThanOrEqual(300);
                // ... and the records the old fixed bound refused: many assignments, so many settle passes.
                for (const assignments of [4, 5]) {
                    expect(acceptedByAssignments.get(assignments) ?? 0).toBeGreaterThanOrEqual(20);
                }
            });
        });
    });

    describe("PATCH rejections", () => {
        it.each([
            ["a Saturday", "2026-10-17", "RESUME_DATE_NOT_BUSINESS_DAY"],
            ["a public holiday", "2026-10-09", "RESUME_DATE_NOT_BUSINESS_DAY"],
            ["a date on the last kept session", "2026-10-01", "INVALID_DATE"],
            ["a date before the last kept session", "2026-09-30", "INVALID_DATE"],
            ["an impossible date", "2026-02-30", "INVALID_DATE"],
            ["a malformed date", "10/14/2026", "INVALID_DATE"],
        ])("rejects %s as the resume date", (_label, resumeDate, code) => {
            expect(codeOf(() => resumeOf(goldenSource(), { fromSessionIndex: 2, resumeDate }))).toBe(code);
        });

        it("does not adjust a non-business resume date silently", () => {
            expect(codeOf(() => resumeOf(goldenSource(), { fromSessionIndex: 2, resumeDate: "2026-10-17" })))
                .toBe("RESUME_DATE_NOT_BUSINESS_DAY");
        });

        it.each([0, 16, 99])("rejects session index %s as INVALID_SESSION_INDEX", (fromSessionIndex) => {
            expect(codeOf(() => resumeOf(goldenSource(), { fromSessionIndex, resumeDate: "2026-10-14" })))
                .toBe("INVALID_SESSION_INDEX");
        });

        it("accepts a resume date that is a business day only because the client takes Saturdays", () => {
            const src = goldenSource();
            src.client.allowSaturdayService = true;
            const normalized = resumeOf(src, { fromSessionIndex: 2, resumeDate: "2026-10-17" });
            expect(normalized.entries?.[1]?.serviceDate).toBe("2026-10-17");
        });

        it("surfaces a resume date in an unpopulated holiday year as the shared unsupported-year error", () => {
            expect(() => resumeOf(goldenSource(), { fromSessionIndex: 2, resumeDate: "2029-01-03" }))
                .toThrow(UnsupportedKoreanHolidayYearError);
        });
    });

    describe("combining a resume replan with other date changes", () => {
        const marker = () => resumeOf(goldenSource(), golden).changes;

        it("rejects a resume replan on a draft that already carries a manual date edit", () => {
            const moved = normalizeServiceRecordEditChanges(
                pauseSource(), {}, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 15, toDate: "2026-10-26", shiftFollowing: false },
            );
            expect(moved.changes["sessions"]).toBeDefined();
            expect(codeOf(() => resumeOf(pauseSource(), golden, moved.changes))).toBe("RESUME_REPLAN_COMBINATION");
        });

        it("rejects a resume replan on a draft that carries a schedule replacement", () => {
            const replaced = normalizeServiceRecordEditChanges(
                pauseSource(), {}, {}, KR_BUILTIN_CALENDAR, undefined,
                { serviceDays: { saturday: false, sunday: false, holiday: false }, dates: OLD_DATES },
            );
            expect(replaced.changes["serviceDays"]).toBeDefined();
            expect(codeOf(() => resumeOf(pauseSource(), golden, replaced.changes))).toBe("RESUME_REPLAN_COMBINATION");
        });

        it("rejects a resume replan that carries a dateMove or a schedule in the same request", () => {
            expect(codeOf(() => normalizeServiceRecordEditChanges(
                goldenSource(), {}, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 15, toDate: "2026-10-26" }, undefined, golden,
            ))).toBe("RESUME_REPLAN_COMBINATION");
            expect(codeOf(() => normalizeServiceRecordEditChanges(
                goldenSource(), {}, {}, KR_BUILTIN_CALENDAR, undefined,
                { serviceDays: { saturday: false, sunday: false, holiday: false }, dates: OLD_DATES }, golden,
            ))).toBe("RESUME_REPLAN_COMBINATION");
        });

        it("rejects a dateMove, a schedule or a serviceDate edit after the marker", () => {
            expect(codeOf(() => normalizeServiceRecordEditChanges(
                goldenSource(), marker(), {}, KR_BUILTIN_CALENDAR, { sessionIndex: 15, toDate: "2026-11-03" },
            ))).toBe("RESUME_REPLAN_COMBINATION");
            expect(codeOf(() => normalizeServiceRecordEditChanges(
                goldenSource(), marker(), {}, KR_BUILTIN_CALENDAR, undefined,
                { serviceDays: { saturday: false, sunday: false, holiday: false }, dates: NEW_DATES },
            ))).toBe("RESUME_REPLAN_COMBINATION");
            expect(codeOf(() => normalizeServiceRecordEditChanges(
                goldenSource(), marker(), { sessions: [{ sessionIndex: 3, serviceDate: "2026-10-20" }] }, KR_BUILTIN_CALENDAR,
            ))).toBe("RESUME_REPLAN_COMBINATION");
        });

        it("keeps the marker and the overrides through a header-only save", () => {
            const saved = marker();
            const header = normalizeServiceRecordEditChanges(
                goldenSource(), saved, { header: { momName: "수정" } }, KR_BUILTIN_CALENDAR,
            );
            expect(header.changes["resumeReplan"]).toEqual(golden);
            expect(header.changes["header"]).toEqual({ momName: "수정" });
            expect(header.changes["sessions"]).toEqual(saved["sessions"]);
            expect(dates(header.entries)).toEqual(NEW_DATES);
        });

        it("keeps the marker when the web editor echoes the sessions with their current dates", () => {
            const saved = marker();
            const echoed = normalizeServiceRecordEditChanges(
                goldenSource(), saved,
                { sessions: [{ sessionIndex: 3, serviceDate: NEW_DATES[2]!, notes: "수정 메모" }] },
                KR_BUILTIN_CALENDAR,
            );
            expect(echoed.changes["resumeReplan"]).toEqual(golden);
            expect(dates(echoed.entries)).toEqual(NEW_DATES);
            expect((echoed.changes["sessions"] as Array<Record<string, unknown>>).find((session) => session["sessionIndex"] === 3))
                .toEqual({ sessionIndex: 3, serviceDate: NEW_DATES[2], notes: "수정 메모" });
        });

        it("keeps the marker through a content save when the replan moved no date", () => {
            // Resuming exactly where the sessions already are is a no-op replan that still stores its marker.
            const same = { fromSessionIndex: 2, resumeDate: "2026-10-02" };
            const stored = resumeOf(goldenSource(), same);
            expect(dates(stored.entries)).toEqual(OLD_DATES);
            const later = normalizeServiceRecordEditChanges(goldenSource(), stored.changes, { header: { momName: "수정" } }, KR_BUILTIN_CALENDAR);
            expect(later.changes["resumeReplan"]).toEqual(same);
        });

        it("recomputes a second resume replan from the source and replaces the first", () => {
            const first = marker();
            const second = resumeOf(goldenSource(), { fromSessionIndex: 3, resumeDate: "2026-10-15" }, first);
            expect(second.changes["resumeReplan"]).toEqual({ fromSessionIndex: 3, resumeDate: "2026-10-15" });
            // Session 2 is back on its source date: the first marker's override is gone.
            expect(second.entries?.[1]?.serviceDate).toBe("2026-10-02");
            expect(second.entries?.[2]?.serviceDate).toBe("2026-10-15");
            expect((second.changes["sessions"] as Array<Record<string, unknown>>).map((session) => session["sessionIndex"]))
                .toEqual(Array.from({ length: 13 }, (_unused, offset) => offset + 3));
        });

        it("never takes the marker from the client-sent changes", () => {
            const normalized = normalizeServiceRecordEditChanges(
                goldenSource(), {},
                { header: { momName: "수정" }, resumeReplan: golden } as unknown as ServiceRecordEditJsonValue,
                KR_BUILTIN_CALENDAR,
            );
            expect(normalized.changes["resumeReplan"]).toBeUndefined();
        });

        it("keeps the existing rules for a non-marker draft", () => {
            expect(codeOf(() => normalizeServiceRecordEditChanges(
                pauseSource(), {}, { sessions: [{ sessionIndex: 3, serviceDate: "2026-10-20" }] }, KR_BUILTIN_CALENDAR,
            ))).toBe("DATE_MOVE_REQUIRED");
        });
    });

    describe("preview warnings", () => {
        it("warns, without blocking, about a submission that now precedes its new date", () => {
            const src = goldenSource();
            src.sessions = src.sessions.map((session) => (session.sessionIndex === 2
                // 2026-10-02 09:00 UTC is 18:00 KST: twelve days before session 2's new date.
                ? { ...session, submittedAt: "2026-10-02T09:00:00.000Z" }
                // 2026-10-14 14:59 UTC is 23:59 KST, one minute short of session 3's new date 10-15.
                : session.sessionIndex === 3
                    ? { ...session, submittedAt: "2026-10-14T14:59:00.000Z" }
                    : session));
            const preview = previewOf(src, resumeOf(goldenSource(), golden).changes);
            expect(preview.blockingReasons).toEqual([]);
            expect(preview.warnings?.map(({ code, sessionIndex }) => [code, sessionIndex])).toEqual([
                ["SUBMITTED_BEFORE_NEW_DATE", 2],
                ["SUBMITTED_BEFORE_NEW_DATE", 3],
            ]);
        });

        it("reads a submission after midnight KST as that KST day", () => {
            const src = goldenSource();
            // 2026-10-14 15:00 UTC = 2026-10-15 00:00 KST: the same day as session 3's new date, so no warning.
            src.sessions = src.sessions.map((session) => (session.sessionIndex === 3
                ? { ...session, submittedAt: "2026-10-14T15:00:00.000Z" }
                : session));
            expect(previewOf(src, resumeOf(goldenSource(), golden).changes).warnings).toEqual([]);
        });

        it("warns about a stored owner that does not cover the new date, without blocking", () => {
            // From session 1 only the outer edges move: B keeps owning sessions 2..6 that now precede its start 10-14.
            const changes = resumeOf(liveSplitSource(), { fromSessionIndex: 1, resumeDate: "2026-10-02" }).changes;
            const preview = previewOf(liveSplitSource(), changes);
            expect(preview.blockingReasons).toEqual([]);
            const mismatches = preview.warnings?.filter(({ code }) => code === "ASSIGNMENT_MISMATCH");
            expect(mismatches?.map(({ sessionIndex }) => sessionIndex)).toEqual([2, 3, 4, 5, 6]);
            expect(mismatches?.[0]).toMatchObject({ assignmentId: B_ID });
        });
    });

    describe("a stored draft judged again", () => {
        const stored = () => resumeOf(goldenSource(), golden).changes;
        const branchCalendar = (date: string) => createKrBusinessDayCalendar(
            [...KOREAN_HOLIDAY_CALENDAR[2026]!, date],
            { version: `kr-db-branch-${date}`, supportedYears: [2026] },
        );

        it("blocks when the resume date is no longer a business day", () => {
            const preview = previewOf(goldenSource(), stored(), branchCalendar("2026-10-14"));
            expect(preview.blockingReasons.map(({ code }) => code)).toEqual(["RESUME_DATE_NOT_BUSINESS_DAY"]);
        });

        it("blocks when the calendar change moves any re-planned date", () => {
            const preview = previewOf(goldenSource(), stored(), branchCalendar("2026-10-20"));
            expect(preview.blockingReasons.map(({ code }) => code)).toEqual(["RESUME_REPLAN_OUT_OF_DATE"]);
            expect(preview.assignmentPeriods).toEqual([]);
        });

        it("binds the boundary into the preview payload", () => {
            const withOutgoing = resumeOf(goldenSource(), { ...golden, outgoingLastServedDate: "2026-10-08" }).changes;
            const left = previewOf(goldenSource(), stored());
            const right = previewOf(goldenSource(), withOutgoing);
            expect(left.assignmentPeriods).not.toEqual(right.assignmentPeriods);
            expect(JSON.stringify(left)).not.toEqual(JSON.stringify(right));
        });
    });

    describe("previews of every other change kind", () => {
        it("omit the warnings and the assignment periods entirely", () => {
            const dateMove = normalizeServiceRecordEditChanges(
                pauseSource(), {}, {}, KR_BUILTIN_CALENDAR, { sessionIndex: 15, toDate: "2026-10-26", shiftFollowing: false },
            ).changes;
            for (const changes of [{}, { header: { momName: "수정" } }, dateMove]) {
                const preview = previewOf(pauseSource(), changes);
                expect("warnings" in preview).toBe(false);
                expect("assignmentPeriods" in preview).toBe(false);
            }
        });

        it("keeps LOCKED_SESSION_DATE_CHANGED for a schedule replacement", () => {
            // Drafted while the rows were still open, previewed after the caregiver submitted them.
            const open = pauseSource();
            open.sessions = open.sessions.map((session) => ({ ...session, locked: false, submittedAt: null }));
            const replacement = normalizeServiceRecordEditChanges(
                open, {}, {}, KR_BUILTIN_CALENDAR, undefined,
                { serviceDays: { saturday: false, sunday: false, holiday: false }, dates: NEW_DATES },
            ).changes;
            const codes = previewOf(pauseSource(), replacement).blockingReasons.map(({ code }) => code);
            expect(codes).toContain("LOCKED_SESSION_DATE_CHANGED");
            expect(codes).not.toContain("CASE_FINALIZED");
        });

        it("does not block a non-marker draft because its case is finalized", () => {
            const src = pauseSource();
            src.caseLifecycle = { ...src.caseLifecycle, status: "COMPLETED" };
            expect(previewOf(src, { header: { momName: "수정" } }).blockingReasons).toEqual([]);
        });
    });
});

describe("assignmentWrites: historical-only assignments take no part in the edges", () => {
    const H = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const L = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const row = (
        id: string,
        scheduleId: number,
        startDate: string,
        endDate: string,
        overrides: Partial<ServiceRecordEditSource["assignments"][number]> = {},
    ): ServiceRecordEditSource["assignments"][number] => ({
        id,
        branchId: null,
        serviceRecordCaseId: null,
        scheduleId,
        employeeId: scheduleId + 100,
        startDate,
        endDate,
        replaced: false,
        employeeName: null,
        scheduleStartDate: startDate,
        scheduleEndDate: endDate,
        scheduleTerminatedAt: null,
        primaryEmployeeId: null,
        secondaryEmployeeId: null,
        primaryEmployeeName: null,
        ...overrides,
    });
    const compact = (writes: ReturnType<typeof assignmentWrites>) =>
        writes.map(({ assignmentId, startDate, endDate, datesChanged }) => [assignmentId, startDate, endDate, datesChanged]);
    const owners = new Set([H, L]);
    const historical = new Set([H]);

    describe.each([
        ["replaced, not terminated", { replaced: true, scheduleTerminatedAt: null }],
        ["terminated, not replaced", { replaced: false, scheduleTerminatedAt: "2026-10-02T00:00:00.000Z" }],
    ])("a historical-only assignment that is %s", (_label, flags) => {
        it("is never the head edge: the live owner takes the new first date, the historical one keeps its dates", () => {
            const assignments = [row(H, 55, "2026-10-01", "2026-10-01", flags), row(L, 56, "2026-10-05", "2026-10-20")];
            expect(compact(assignmentWrites({ assignments }, "2026-10-03", "2026-10-20", owners, historical))).toEqual([
                [H, "2026-10-01", "2026-10-01", false],
                [L, "2026-10-03", "2026-10-20", true],
            ]);
        });

        it("is never the tail edge: the live owner takes the new last date, the historical one keeps its dates", () => {
            const assignments = [row(L, 56, "2026-10-05", "2026-10-20"), row(H, 55, "2026-10-25", "2026-10-25", flags)];
            expect(compact(assignmentWrites({ assignments }, "2026-10-05", "2026-10-27", owners, historical))).toEqual([
                [L, "2026-10-05", "2026-10-27", true],
                [H, "2026-10-25", "2026-10-25", false],
            ]);
        });

        it("is never moved as a placeholder on the head edge's own date", () => {
            // Same stored date as the live owner's start and directly before it: a one-day neighbour.
            const assignments = [row(H, 55, "2026-10-05", "2026-10-05", flags), row(L, 56, "2026-10-05", "2026-10-20")];
            expect(compact(assignmentWrites({ assignments }, "2026-10-02", "2026-10-20", owners, historical))).toEqual([
                [H, "2026-10-05", "2026-10-05", false],
                [L, "2026-10-02", "2026-10-20", true],
            ]);
        });

        it("is never moved as a placeholder on the tail edge's own date", () => {
            const assignments = [row(L, 56, "2026-10-05", "2026-10-20"), row(H, 55, "2026-10-20", "2026-10-20", flags)];
            expect(compact(assignmentWrites({ assignments }, "2026-10-05", "2026-10-27", owners, historical))).toEqual([
                [L, "2026-10-05", "2026-10-27", true],
                [H, "2026-10-20", "2026-10-20", false],
            ]);
        });

        it("nested inside the live owner's period does not stop the tail following the last date", () => {
            // B [10-01, 10-23] runs over A's one day 10-06; the last date moves to 10-27.
            const assignments = [row(L, 56, "2026-10-01", "2026-10-23"), row(H, 55, "2026-10-06", "2026-10-06", flags)];
            expect(compact(assignmentWrites({ assignments }, "2026-10-01", "2026-10-27", owners, historical))).toEqual([
                [L, "2026-10-01", "2026-10-27", true],
                [H, "2026-10-06", "2026-10-06", false],
            ]);
            // Without the argument the function is what it was: the later-sorting A is the tail and is extended.
            expect(compact(assignmentWrites({ assignments }, "2026-10-01", "2026-10-27", owners))).toEqual([
                [L, "2026-10-01", "2026-10-23", false],
                [H, "2026-10-06", "2026-10-27", true],
            ]);
        });
    });

    it("keeps a live session-less assignment an edge candidate within its own period, as before", () => {
        // L owns no session (slotless, not historical-only), so it follows the edges inside its own period;
        // the historical-only H is left out of the computation and keeps its dates.
        const assignments = [row(H, 55, "2026-10-01", "2026-10-01", { replaced: true }), row(L, 56, "2026-10-05", "2026-10-20")];
        expect(compact(assignmentWrites({ assignments }, "2026-10-07", "2026-10-15", new Set([H]), historical))).toEqual([
            [H, "2026-10-01", "2026-10-01", false],
            [L, "2026-10-07", "2026-10-15", true],
        ]);
    });

    describe("confirmAssignmentWrites", () => {
        const entry = (sessionIndex: number, serviceDate: string, assignmentId: string, scheduleId: number) => ({
            sessionIndex,
            serviceDate,
            originalDate: serviceDate,
            assignmentId,
            scheduleId,
            employeeId: scheduleId + 100,
            provenanceVersion: "case-7",
        });
        const dayRow = (sessionIndex: number, scheduleId: number) => ({ sessionIndex, scheduleId, employeeId: scheduleId + 100, ambiguous: false });

        it("takes the edges from the first and last session whose owner is not historical-only", () => {
            // H wrote session 1 (now 10-14), outside its [10-01, 10-01]; L owns sessions 2 and 3.
            const state = {
                assignments: [row(H, 55, "2026-10-01", "2026-10-01", { replaced: true }), row(L, 56, "2026-10-15", "2026-10-16")],
                sessions: [dayRow(1, 55)] as never,
            };
            const entries = [entry(1, "2026-10-14", H, 55), entry(2, "2026-10-15", L, 56), entry(3, "2026-10-16", L, 56)];
            expect(compact(confirmAssignmentWrites(state, entries))).toEqual([
                [H, "2026-10-01", "2026-10-01", false],
                [L, "2026-10-15", "2026-10-16", false],
            ]);
        });

        it("still counts a mixed owner's sessions, and is the plain first/last rule without a historical-only owner", () => {
            const state = {
                assignments: [row(H, 55, "2026-10-01", "2026-10-05"), row(L, 56, "2026-10-06", "2026-10-09")],
                sessions: [] as never,
            };
            const entries = [entry(1, "2026-10-02", H, 55), entry(2, "2026-10-06", L, 56), entry(3, "2026-10-12", L, 56)];
            expect(compact(confirmAssignmentWrites(state, entries))).toEqual([
                [H, "2026-10-02", "2026-10-05", true],
                [L, "2026-10-06", "2026-10-12", true],
            ]);
        });
    });
});
