import {
    buildServiceRecordEditPreview,
    normalizeServiceRecordEditChanges,
    resolveServiceRecordScheduleProjection,
} from "application/policies/service-record-edit-preview.policy";
import { KOREAN_HOLIDAY_CALENDAR, KR_BUILTIN_CALENDAR, createKrBusinessDayCalendar } from "domain/utils/business-days";
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

        const preview = build({ employeeName: "임선녀", startDate: "2026-09-01", endDate: "2026-09-30" });
        expect(preview.impactedAssignments).toEqual([assignment.id]);
        expect(preview.impactedAssignmentDetails).toEqual([
            { assignmentId: assignment.id, employeeName: "임선녀", startDate: "2026-09-01", endDate: "2026-09-30" },
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
            { sessionIndex: 3, toDate: "2026-10-01" },
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
        expect(preview.provenance).toEqual([expect.objectContaining({ endDate: "2026-10-06" })]);
    });

    describe("legacy ownership follows the writer or the current assignee", () => {
        const BRANCH = assignment.branchId;
        const CASE = assignment.serviceRecordCaseId;
        const caregiverA = {
            ...assignment,
            id: "aaaaaaaa-0000-4000-8000-00000000000a",
            scheduleId: 701,
            employeeId: 31,
            employeeName: "공혜순",
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
            employeeName: "임선녀",
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
            employeeName: "공혜순",
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
            employeeName: "임선녀",
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
