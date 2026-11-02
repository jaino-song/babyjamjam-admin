import { createServiceDayPicker, revertServiceDayPicker } from "@babyjamjam/shared/utils/service-day-picker";

import {
  buildMonthGrid,
  changeSchedulePolicy,
  classifyScheduleDay,
  initialScheduleMonth,
  readScheduleEditorModel,
  scheduleCalendarYears,
  scheduleProgress,
  shiftMonth,
  toggleScheduleDay,
  type ScheduleEditorModel,
} from "./service-record-schedule-model";
import {
  FIXTURE_CALENDAR,
  FIXTURE_DATES,
  FIXTURE_START,
  fixtureOverview,
} from "./service-record-schedule.fixture";

const OFF = { saturday: false, sunday: false, holiday: false };

function open(overviewOptions: Parameters<typeof fixtureOverview>[0] = {}) {
  const result = readScheduleEditorModel(fixtureOverview(overviewOptions));
  if (!result.ok) throw new Error(`fixture rejected: ${result.reason}`);
  const model = result.model;
  const picker = createServiceDayPicker({
    startDate: model.startDate,
    requiredCount: model.requiredCount,
    initialDates: model.initialDates,
    policy: model.serviceDays,
  });
  return { model, picker };
}

const calendarOf = (picker: ReturnType<typeof open>["picker"]) => FIXTURE_CALENDAR.withServiceDays(picker.policy);

describe("readScheduleEditorModel", () => {
  it("reads N, the dates, the start and the written sessions off the editor overview", () => {
    const { model } = open();

    expect(model).toEqual<ScheduleEditorModel>({
      startDate: FIXTURE_START,
      requiredCount: 10,
      initialDates: FIXTURE_DATES,
      writtenDates: ["2026-12-14", "2026-12-16"],
      lastWrittenDate: "2026-12-16",
      serviceDays: OFF,
    });
  });

  it("takes the toggles from the overview and counts a submitted-only session as written", () => {
    const overview = fixtureOverview({ writtenIndexes: [], serviceDays: { saturday: true, sunday: false, holiday: true } });
    overview.record!.sessions[1].submittedAt = "2026-12-15T01:00:00.000Z";

    const result = readScheduleEditorModel(overview);

    expect(result.ok && result.model.serviceDays).toEqual({ saturday: true, sunday: false, holiday: true });
    expect(result.ok && result.model.writtenDates).toEqual(["2026-12-15"]);
  });

  it("falls back to the first assignment's start and reads written sessions from assignments", () => {
    const overview = fixtureOverview({ writtenIndexes: [] });
    overview.record = null;
    overview.assignments = [
      {
        startDate: "2026-12-14T00:00:00.000Z",
        sessions: [{ sessionIndex: 2, serviceDate: "2026-12-15", locked: true, submittedAt: null }],
      },
    ] as never;

    const result = readScheduleEditorModel(overview);

    expect(result.ok && result.model.startDate).toBe("2026-12-14");
    expect(result.ok && result.model.writtenDates).toEqual(["2026-12-15"]);
  });

  it.each([
    ["the projection has blocking reasons", { blockingReasons: [{ code: "ASSIGNMENT_RANGE_OVERLAP", message: "x" }] }, "blocked"],
    ["the projection has no entries", { dates: [] }, "empty"],
    ["the case has no start date", { startDate: null }, "no-start"],
  ] as const)("refuses when the %s", (_name, options, reason) => {
    expect(readScheduleEditorModel(fixtureOverview(options))).toEqual({ ok: false, reason });
  });

  it("refuses a projection that is missing or out of order", () => {
    const overview = fixtureOverview();
    delete (overview as { scheduleProjection?: unknown }).scheduleProjection;
    expect(readScheduleEditorModel(overview)).toEqual({ ok: false, reason: "blocked" });

    const unordered = fixtureOverview({ dates: ["2026-12-15", "2026-12-14"] });
    expect(readScheduleEditorModel(unordered)).toEqual({ ok: false, reason: "blocked" });
  });

  it("asks for the calendar years from the start through one past the last stored date", () => {
    expect(scheduleCalendarYears(open().model)).toEqual([2026, 2027]);
  });
});

describe("fixed dates (on or before the last written session)", () => {
  it("keeps selected dates up to the last written one from being removed", () => {
    const { model, picker } = open();

    for (const iso of ["2026-12-14", "2026-12-15", "2026-12-16"]) {
      expect(classifyScheduleDay(model, picker, iso, calendarOf(picker))).toBe("locked");
      const toggled = toggleScheduleDay(model, picker, iso, calendarOf(picker));
      expect(toggled.outcome).toBe("locked");
      expect(toggled.state).toBe(picker);
    }
  });

  it("treats an unwritten selected date before the last written one the same way (12-15)", () => {
    const { model, picker } = open();

    expect(model.writtenDates).not.toContain("2026-12-15");
    expect(toggleScheduleDay(model, picker, "2026-12-15", calendarOf(picker)).outcome).toBe("locked");
  });

  it("does not offer an unselected date before the last written one", () => {
    const { model, picker } = open({ dates: ["2026-12-14", "2026-12-16", ...FIXTURE_DATES.slice(3, 11)] });
    const withGap = { ...picker };

    expect(model.initialDates).not.toContain("2026-12-15");
    expect(classifyScheduleDay(model, withGap, "2026-12-15", calendarOf(withGap))).toBe("fixed-unavailable");
    expect(toggleScheduleDay(model, withGap, "2026-12-15", calendarOf(withGap)).outcome).toBe("not-selectable");
  });

  it("still lets dates after the last written one move", () => {
    const { model, picker } = open();

    expect(classifyScheduleDay(model, picker, "2026-12-17", calendarOf(picker))).toBe("selected");
    expect(toggleScheduleDay(model, picker, "2026-12-17", calendarOf(picker)).outcome).toBe("removed");
  });

  it("classifies days before the start as before-start and weekend days as unavailable", () => {
    const { model, picker } = open();

    expect(classifyScheduleDay(model, picker, "2026-12-13", calendarOf(picker))).toBe("before-start");
    expect(classifyScheduleDay(model, picker, "2026-12-19", calendarOf(picker))).toBe("unavailable");
    expect(classifyScheduleDay(model, picker, "2026-12-25", calendarOf(picker))).toBe("unavailable");
  });
});

describe("picking dates", () => {
  it("shows 9/10 and no completion after deselecting 12-17, then 10/10 after selecting 12-29", () => {
    const { model, picker } = open();
    expect(scheduleProgress(model, picker, calendarOf(picker))).toMatchObject({ selectedCount: 10, complete: true });

    const removed = toggleScheduleDay(model, picker, "2026-12-17", calendarOf(picker));
    expect(removed.outcome).toBe("removed");
    expect(scheduleProgress(model, removed.state, calendarOf(removed.state))).toMatchObject({
      selectedCount: 9,
      requiredCount: 10,
      complete: false,
    });

    const added = toggleScheduleDay(model, removed.state, "2026-12-29", calendarOf(removed.state));
    expect(added.outcome).toBe("added");
    expect(scheduleProgress(model, added.state, calendarOf(added.state))).toMatchObject({ selectedCount: 10, complete: true });
  });

  it("answers full, without changing anything, when 10 dates are already selected", () => {
    const { model, picker } = open();

    const result = toggleScheduleDay(model, picker, "2026-12-29", calendarOf(picker));

    expect(result.outcome).toBe("full");
    expect(result.state).toBe(picker);
  });

  it("rejects a day before the start date or a non-service day", () => {
    const { model, picker } = open();
    const removed = toggleScheduleDay(model, picker, "2026-12-17", calendarOf(picker)).state;

    expect(toggleScheduleDay(model, removed, "2026-12-13", calendarOf(removed)).outcome).toBe("not-selectable");
    expect(toggleScheduleDay(model, removed, "2026-12-19", calendarOf(removed)).outcome).toBe("not-selectable");
  });
});

describe("toggles", () => {
  it("makes 12-19 selectable (skipped) once 토요일 is on", () => {
    const { model, picker } = open();
    expect(classifyScheduleDay(model, picker, "2026-12-19", calendarOf(picker))).toBe("unavailable");

    const { state } = changeSchedulePolicy(model, picker, { ...picker.policy, saturday: true }, FIXTURE_CALENDAR);

    expect(state.policy.saturday).toBe(true);
    expect(classifyScheduleDay(model, state, "2026-12-19", calendarOf(state))).toBe("skipped");
    expect(toggleScheduleDay(model, state, "2026-12-19", calendarOf(state)).outcome).toBe("full");
  });

  it("restores both the dates and the toggles on 되돌리기", () => {
    const { model, picker } = open();
    const withSaturday = changeSchedulePolicy(model, picker, { ...picker.policy, saturday: true }, FIXTURE_CALENDAR).state;
    const swapped = toggleScheduleDay(model, withSaturday, "2026-12-17", calendarOf(withSaturday)).state;
    const edited = toggleScheduleDay(model, swapped, "2026-12-19", calendarOf(swapped)).state;
    expect(edited.selected).toContain("2026-12-19");

    const reverted = revertServiceDayPicker(edited);

    expect(reverted.selected).toEqual(FIXTURE_DATES);
    expect(reverted.policy).toEqual(OFF);
  });

  it("drops an unwritten date a toggle excludes and says which one", () => {
    const { model, picker } = open({ dates: [...FIXTURE_DATES.slice(0, 5), "2026-12-19", ...FIXTURE_DATES.slice(5, 9)], serviceDays: { saturday: true, sunday: false, holiday: false } });
    const calendar = FIXTURE_CALENDAR.withServiceDays(picker.policy);
    expect(calendar.isBusinessDay("2026-12-19")).toBe(true);
    // The written sessions are 1 and 3, so 12-19 (session 6) is free to go.
    const { state, dropped } = changeSchedulePolicy(model, picker, OFF, FIXTURE_CALENDAR);

    expect(dropped).toEqual(["2026-12-19"]);
    expect(state.selected).not.toContain("2026-12-19");
  });
});

describe("a written session on a day the toggles exclude", () => {
  const withSaturdayWritten = () => open({
    dates: ["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24"],
    writtenIndexes: [6],
    serviceDays: OFF,
  });

  it("counts as complete although the Saturday is not a service day", () => {
    const { model, picker } = withSaturdayWritten();

    expect(calendarOf(picker).isBusinessDay("2026-12-19")).toBe(false);
    expect(scheduleProgress(model, picker, calendarOf(picker))).toEqual({
      selectedCount: 10,
      requiredCount: 10,
      invalid: [],
      complete: true,
    });
  });

  it("counts an unwritten selected date on an excluded day as invalid", () => {
    const { model, picker } = withSaturdayWritten();
    const unwrittenOnSaturday = { ...picker, selected: [...picker.selected.filter((iso) => iso !== "2026-12-24"), "2026-12-26"].sort() };

    const progress = scheduleProgress(model, unwrittenOnSaturday, calendarOf(unwrittenOnSaturday));

    expect(progress.invalid).toEqual(["2026-12-26"]);
    expect(progress.complete).toBe(false);
  });

  it("keeps the written date selected when its toggle is switched off", () => {
    const { model, picker } = open({
      dates: ["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24"],
      writtenIndexes: [6],
      serviceDays: { saturday: true, sunday: false, holiday: false },
    });

    const { state, dropped } = changeSchedulePolicy(model, picker, OFF, FIXTURE_CALENDAR);

    expect(state.selected).toContain("2026-12-19");
    expect(dropped).toEqual([]);
    expect(scheduleProgress(model, state, calendarOf(state)).complete).toBe(true);
  });

  it("is not complete when a fixed unwritten date was dropped by a toggle (it cannot be refilled)", () => {
    const { model, picker } = open({
      dates: ["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24"],
      writtenIndexes: [7],
      serviceDays: { saturday: true, sunday: false, holiday: false },
    });

    const { state, dropped } = changeSchedulePolicy(model, picker, OFF, FIXTURE_CALENDAR);

    expect(dropped).toEqual(["2026-12-19"]);
    expect(scheduleProgress(model, state, calendarOf(state)).complete).toBe(false);
  });
});

describe("month helpers", () => {
  it("opens on the month of the first unwritten selected date, else of the start date", () => {
    const { model, picker } = open();
    expect(initialScheduleMonth(model, picker)).toEqual([2026, 11]);

    const lateStart = open({ dates: ["2026-12-30", "2027-01-04"], writtenIndexes: [1], startDate: "2026-12-30" });
    expect(initialScheduleMonth(lateStart.model, lateStart.picker)).toEqual([2027, 0]);

    const allWritten = open({ dates: ["2026-12-30", "2027-01-04"], writtenIndexes: [1, 2], startDate: "2026-12-30" });
    expect(initialScheduleMonth(allWritten.model, allWritten.picker)).toEqual([2026, 11]);
  });

  it("moves across year boundaries and lays out a Sunday-first grid", () => {
    expect(shiftMonth([2026, 11], 1)).toEqual([2027, 0]);
    expect(shiftMonth([2027, 0], -1)).toEqual([2026, 11]);
    const grid = buildMonthGrid(2026, 11);
    expect(grid.leadingBlanks).toBe(2); // 2026-12-01 is a Tuesday
    expect(grid.dates).toHaveLength(31);
    expect(grid.dates[0]).toBe("2026-12-01");
    expect(grid.dates[30]).toBe("2026-12-31");
  });
});
