import {
    buildServiceRecordEditPreview,
    normalizeServiceRecordEditChanges,
    resolveServiceRecordScheduleProjection,
} from "application/policies/service-record-edit-preview.policy";
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
    it("keeps nominal duration separate and shifts only the selected suffix", () => {
        const normalized = normalizeServiceRecordEditChanges(
            source(),
            {},
            { sessions: [{ sessionIndex: 3, notes: "변경" }] },
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        expect(normalized.entries?.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-11", "2026-09-14", "2026-09-15",
        ]);
        expect(source().client.duration).toBe(15);

        const preview = buildServiceRecordEditPreview({
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

    it("allows a reverse move from the normalized current draft baseline", () => {
        const first = normalizeServiceRecordEditChanges(
            source(),
            {},
            { sessions: [] },
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        const second = normalizeServiceRecordEditChanges(
            source(),
            first.changes,
            { sessions: [] },
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
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        const second = normalizeServiceRecordEditChanges(
            source(),
            first.changes,
            { sessions: [] },
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
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        const second = normalizeServiceRecordEditChanges(
            source(),
            first.changes,
            {
                header: { momName: "수정 산모" },
                sessions: first.changes["sessions"] as ServiceRecordEditJsonValue,
            },
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
            { sessionIndex: 3, toDate: "2026-09-11" },
        );
        const preview = buildServiceRecordEditPreview({
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
        const projection = resolveServiceRecordScheduleProjection(incomplete);
        expect(projection.entries).toEqual([]);
        expect(projection.blockingReasons.map(({ code }) => code)).toContain("INCOMPLETE_VECTOR");
        const preview = buildServiceRecordEditPreview({
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
        const projection = resolveServiceRecordScheduleProjection(contradictory);
        expect(projection.blockingReasons.map(({ code }) => code)).toContain("ACTUAL_DAY_CONTRADICTION");
    });

    it("rejects changed date snapshots unless a typed dateMove is supplied", () => {
        expect(() => normalizeServiceRecordEditChanges(
            source(),
            {},
            { sessions: [{ sessionIndex: 3, serviceDate: "2026-09-11" }] },
        )).toThrow(/dateMove/);
    });

    it("blocks an ambiguous legacy source instead of inventing assignment ownership", () => {
        const legacy = source({
            plannedSessions: null,
            sessions: source().sessions.map((session, index) => index === 2
                ? { ...session, ambiguous: true }
                : session),
        });
        const projection = resolveServiceRecordScheduleProjection(legacy);
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
            { sessionIndex: 3, toDate: "2026-10-01" },
        );
        const preview = buildServiceRecordEditPreview({
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
});
