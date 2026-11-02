import { AdminServiceRecordEditApiError } from "@/features/service-records/types";
import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";

import type { AdminServiceRecordEditorOverview } from "./ServiceRecordAdminWizard";
import {
    classifyScheduleDay,
    createScheduleModel,
    deriveScheduleSource,
    isScheduleChanged,
    revertSchedule,
    scheduleBlockingReasonsMessage,
    scheduleCalendar,
    scheduleFailureMessage,
    scheduleProgress,
    setSchedulePolicy,
    toggleScheduleDay,
    type ScheduleSource,
} from "./service-record-schedule-model";

const OFF = { saturday: false, sunday: false, holiday: false };
const FIXTURE_DATES = [
    "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18",
    "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-28",
];

function source(overrides: Partial<ScheduleSource> = {}): ScheduleSource {
    return {
        startDate: "2026-12-14",
        requiredCount: 10,
        initialDates: FIXTURE_DATES,
        writtenDates: ["2026-12-14", "2026-12-16"],
        policy: OFF,
        ...overrides,
    };
}

function overviewOf(
    dates: string[],
    options: { written?: number[]; serviceDays?: typeof OFF; blocking?: boolean; startDate?: string } = {},
): AdminServiceRecordEditorOverview {
    const written = new Set(options.written ?? []);
    return {
        record: {
            id: "case-1",
            status: "ACTIVE",
            startDate: options.startDate ?? dates[0],
            endDate: dates[dates.length - 1],
            totalSessions: dates.length,
            header: null,
            sessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                locked: written.has(index + 1),
                submittedAt: null,
                updatedAt: "2026-12-01T00:00:00.000Z",
                answers: {},
            })),
        },
        assignments: [],
        scheduleProjection: {
            entries: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
                originalDate: serviceDate,
                assignmentId: "assignment-1",
                scheduleId: 1,
                employeeId: 1,
                provenanceVersion: "p-1",
            })),
            blockingReasons: options.blocking ? [{ code: "ASSIGNMENT_RANGE_OVERLAP", message: "겹침" }] : [],
        },
        ...(options.serviceDays ? { serviceDays: options.serviceDays } : {}),
    } as unknown as AdminServiceRecordEditorOverview;
}

describe("deriveScheduleSource", () => {
    it("reads N, the dates, the written dates, the start and the toggles from the editor overview", () => {
        const result = deriveScheduleSource(overviewOf(FIXTURE_DATES, {
            written: [1, 3],
            serviceDays: { saturday: false, sunday: true, holiday: false },
        }));

        expect(result).toEqual({
            ok: true,
            source: {
                startDate: "2026-12-14",
                requiredCount: 10,
                initialDates: FIXTURE_DATES,
                writtenDates: ["2026-12-14", "2026-12-16"],
                policy: { saturday: false, sunday: true, holiday: false },
            },
        });
    });

    it("treats missing toggles as all off", () => {
        const result = deriveScheduleSource(overviewOf(FIXTURE_DATES));

        expect(result.ok && result.source.policy).toEqual(OFF);
    });

    it("never lets the start date come after the first date", () => {
        const result = deriveScheduleSource(overviewOf(FIXTURE_DATES, { startDate: "2026-12-20" }));

        expect(result.ok && result.source.startDate).toBe("2026-12-14");
    });

    it("refuses a blocked projection and an empty one", () => {
        expect(deriveScheduleSource(overviewOf(FIXTURE_DATES, { blocking: true }))).toEqual({
            ok: false,
            reason: "projection-blocked",
        });
        expect(deriveScheduleSource(overviewOf([]))).toEqual({ ok: false, reason: "no-sessions" });
    });

    it("refuses dates that are not strictly ascending", () => {
        expect(deriveScheduleSource(overviewOf(["2026-12-15", "2026-12-14"]))).toEqual({
            ok: false,
            reason: "projection-blocked",
        });
    });
});

describe("schedule model", () => {
    const calendarOf = (model: ReturnType<typeof createScheduleModel>) => scheduleCalendar(model, KR_BUILTIN_CALENDAR);

    it("fixes every date up to the last written one", () => {
        const model = createScheduleModel(source());
        const calendar = calendarOf(model);

        expect(classifyScheduleDay(model, "2026-12-14", calendar)).toBe("fixed");
        expect(classifyScheduleDay(model, "2026-12-15", calendar)).toBe("fixed");
        expect(classifyScheduleDay(model, "2026-12-16", calendar)).toBe("fixed");
        expect(classifyScheduleDay(model, "2026-12-17", calendar)).toBe("selected");
        expect(classifyScheduleDay(model, "2026-12-13", calendar)).toBe("before-start");
        for (const iso of ["2026-12-14", "2026-12-15", "2026-12-16"]) {
            expect(toggleScheduleDay(model, iso, calendar)).toEqual({ model, outcome: "fixed" });
        }
    });

    it("does not offer an unselected day at or before the last written date", () => {
        const model = createScheduleModel(source({
            requiredCount: 3,
            initialDates: ["2026-12-14", "2026-12-16", "2026-12-17"],
            writtenDates: ["2026-12-16"],
        }));
        const calendar = calendarOf(model);

        expect(classifyScheduleDay(model, "2026-12-15", calendar)).toBe("unavailable");
        expect(toggleScheduleDay(model, "2026-12-15", calendar)).toEqual({ model, outcome: "not-selectable" });
        // After the last written date a service day left out is still offered.
        expect(classifyScheduleDay(model, "2026-12-18", calendar)).toBe("available");
    });

    it("removes and adds days after the written ones, and stops when full", () => {
        const model = createScheduleModel(source());
        const calendar = calendarOf(model);

        const removed = toggleScheduleDay(model, "2026-12-17", calendar);
        expect(removed.outcome).toBe("removed");
        expect(removed.model.picker.selected).not.toContain("2026-12-17");
        expect(scheduleProgress(removed.model, calendar).complete).toBe(false);

        const added = toggleScheduleDay(removed.model, "2026-12-29", calendar);
        expect(added.outcome).toBe("added");
        expect(scheduleProgress(added.model, calendar)).toMatchObject({ selectedCount: 10, complete: true });

        expect(toggleScheduleDay(added.model, "2026-12-30", calendar).outcome).toBe("full");
    });

    it("offers a service day that the toggles opened as a left-out day", () => {
        const model = createScheduleModel(source());
        expect(classifyScheduleDay(model, "2026-12-19", calendarOf(model))).toBe("unavailable");

        const { model: opened } = setSchedulePolicy(model, { ...OFF, saturday: true }, KR_BUILTIN_CALENDAR);

        expect(classifyScheduleDay(opened, "2026-12-19", calendarOf(opened))).toBe("skipped");
    });

    it("keeps a written date on a day the toggles now exclude, and re-adds nothing else", () => {
        const model = createScheduleModel(source({
            initialDates: [
                "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18",
                "2026-12-19", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24",
            ],
            writtenDates: ["2026-12-14", "2026-12-19"],
            policy: { ...OFF, saturday: true },
        }));

        const { model: closed, dropped } = setSchedulePolicy(model, OFF, KR_BUILTIN_CALENDAR);

        expect(closed.picker.selected).toContain("2026-12-19");
        expect(dropped).toEqual([]);
        expect(scheduleProgress(closed, calendarOf(closed))).toMatchObject({ selectedCount: 10, invalid: [], complete: true });
    });

    it("drops a later date the toggles forbid and reports it", () => {
        const model = createScheduleModel(source({
            requiredCount: 3,
            initialDates: ["2026-12-14", "2026-12-19", "2026-12-21"],
            writtenDates: ["2026-12-14"],
            policy: { ...OFF, saturday: true },
        }));

        const { model: closed, dropped } = setSchedulePolicy(model, OFF, KR_BUILTIN_CALENDAR);

        expect(dropped).toEqual(["2026-12-19"]);
        expect(closed.picker.selected).toEqual(["2026-12-14", "2026-12-21"]);
        expect(scheduleProgress(closed, calendarOf(closed)).complete).toBe(false);
    });

    it("counts an invalid later date even when the count matches, but never a fixed one", () => {
        const model = createScheduleModel(source({
            requiredCount: 2,
            initialDates: ["2026-12-14", "2026-12-19"],
            writtenDates: [],
            policy: OFF,
        }));
        const closed = calendarOf(model);

        expect(scheduleProgress(model, closed)).toMatchObject({ invalid: ["2026-12-19"], complete: false });
        const fixed = createScheduleModel(source({
            requiredCount: 2,
            initialDates: ["2026-12-14", "2026-12-19"],
            writtenDates: ["2026-12-19"],
            policy: OFF,
        }));
        expect(scheduleProgress(fixed, calendarOf(fixed))).toMatchObject({ invalid: [], complete: true });
    });

    it("reverts both the dates and the toggles", () => {
        const model = createScheduleModel(source());
        const calendar = calendarOf(model);
        const edited = setSchedulePolicy(
            toggleScheduleDay(model, "2026-12-17", calendar).model,
            { ...OFF, saturday: true },
            KR_BUILTIN_CALENDAR,
        ).model;
        expect(isScheduleChanged(edited)).toBe(true);

        const reverted = revertSchedule(edited);

        expect(reverted.picker.selected).toEqual(FIXTURE_DATES);
        expect(reverted.picker.policy).toEqual(OFF);
        expect(isScheduleChanged(reverted)).toBe(false);
    });
});

describe("schedule failure copy", () => {
    it("maps a schedule code, a blocking reason and a plain conflict to Korean, never to upstream text", () => {
        expect(scheduleFailureMessage("ko", new AdminServiceRecordEditApiError(400, { scheduleCode: "SCHEDULE_COUNT_MISMATCH", message: "raw" })))
            .toBe("선택한 날짜 수가 회차 수와 달라요.");
        expect(scheduleFailureMessage("ko", new AdminServiceRecordEditApiError(409, {
            code: "REQUEST_CONFLICT",
            blockingReasons: [{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 3 }],
        }))).toContain("작성된 회차");
        expect(scheduleFailureMessage("ko", new AdminServiceRecordEditApiError(409, { code: "REQUEST_STALE" })))
            .toContain("다른 화면에서 일정이 바뀌어");
        expect(scheduleFailureMessage("ko", new AdminServiceRecordEditApiError(409, { blockingOperation: { operation: "record_snapshot" } })))
            .toContain("후속 작업");
        expect(scheduleFailureMessage("ko", new AdminServiceRecordEditApiError(403, null))).toContain("권한");
    });

    it("falls back to the generic copy for an unknown code or a non-API failure", () => {
        const generic = "일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
        expect(scheduleFailureMessage("ko", new AdminServiceRecordEditApiError(500, { scheduleCode: "NOT_KNOWN" }))).toBe(generic);
        expect(scheduleFailureMessage("ko", new Error("boom"))).toBe(generic);
        expect(scheduleBlockingReasonsMessage("ko", [{ code: "SOMETHING_NEW" }])).toBe(generic);
    });

    it("maps preview blocking reasons", () => {
        expect(scheduleBlockingReasonsMessage("ko", [{ code: "NON_SERVICE_DAY", sessionIndex: 4 }]))
            .toContain("서비스일이 아닌 날짜");
        expect(scheduleBlockingReasonsMessage("ko", [{ code: "SCHEDULE_BEFORE_START" }])).toContain("시작일보다 이른");
    });
});
