import {
    classifyPeriodOwnership,
    isHistoricalWriterSlot,
    scheduleFollows,
    storedAssignmentPeriod,
    type PeriodOwnershipAssignment,
    type PeriodOwnershipDay,
    type PeriodOwnershipEntry,
} from "application/policies/service-record-period-ownership.policy";

describe("service-record-period-ownership.policy", () => {
    // Everything below is written down by hand; nothing is computed with the code under test.
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    function assignment(
        id: string,
        scheduleId: number,
        startDate: string,
        endDate: string,
        overrides: Partial<PeriodOwnershipAssignment> = {},
    ): PeriodOwnershipAssignment {
        return {
            id,
            scheduleId,
            employeeId: scheduleId + 100,
            startDate,
            endDate,
            scheduleStartDate: startDate,
            scheduleEndDate: endDate,
            replaced: false,
            scheduleTerminatedAt: null,
            ...overrides,
        };
    }
    const row = (
        sessionIndex: number,
        scheduleId: number | null,
        overrides: Partial<PeriodOwnershipDay> = {},
    ): PeriodOwnershipDay => ({ sessionIndex, scheduleId, employeeId: scheduleId === null ? null : scheduleId + 100, ambiguous: false, ...overrides });
    const slot = (sessionIndex: number, serviceDate: string, assignmentId: string): PeriodOwnershipEntry => ({ sessionIndex, serviceDate, assignmentId });

    // A (schedule 55) was replaced and is stored [10-01, 10-01]; B (schedule 56) is live.
    const replacedA = () => assignment(A, 55, "2026-10-01", "2026-10-01", { replaced: true });
    const liveB = () => assignment(B, 56, "2026-10-02", "2026-10-23");

    describe("isHistoricalWriterSlot", () => {
        const source = { assignments: [replacedA(), liveB()], sessions: [row(1, 55), row(2, 55)] };

        it("is true for a superseded owner's row dated outside the owner's period", () => {
            expect(isHistoricalWriterSlot(source, slot(2, "2026-10-14", A))).toBe(true);
        });

        it("is false inside the owner's period", () => {
            expect(isHistoricalWriterSlot(source, slot(1, "2026-10-01", A))).toBe(false);
        });

        it("is false when the owner is live, however far outside its period the date is", () => {
            const live = { assignments: [liveB(), replacedA()], sessions: [row(3, 56)] };
            expect(isHistoricalWriterSlot(live, slot(3, "2026-12-01", B))).toBe(false);
        });

        it("is false when the row was written by somebody else, or there is no row", () => {
            expect(isHistoricalWriterSlot({ ...source, sessions: [row(2, 56)] }, slot(2, "2026-10-14", A))).toBe(false);
            expect(isHistoricalWriterSlot({ ...source, sessions: [] }, slot(2, "2026-10-14", A))).toBe(false);
        });

        it("is false when the row's employee contradicts the owner's", () => {
            expect(isHistoricalWriterSlot({ ...source, sessions: [row(2, 55, { employeeId: 999 })] }, slot(2, "2026-10-14", A))).toBe(false);
        });

        it("treats a terminated owner like a replaced one", () => {
            const terminated = assignment(A, 55, "2026-10-01", "2026-10-01", { scheduleTerminatedAt: "2026-10-02T00:00:00.000Z" });
            expect(isHistoricalWriterSlot({ assignments: [terminated], sessions: [row(2, 55)] }, slot(2, "2026-10-14", A))).toBe(true);
        });

        it("never reads duplicate or ambiguous rows as a writer: the slot stays period-bearing", () => {
            expect(isHistoricalWriterSlot({ ...source, sessions: [row(2, 55), row(2, 55)] }, slot(2, "2026-10-14", A))).toBe(false);
            expect(isHistoricalWriterSlot({ ...source, sessions: [row(2, 55, { ambiguous: true })] }, slot(2, "2026-10-14", A))).toBe(false);
        });

        it("judges against the supplied period instead of the stored one", () => {
            const widened = () => ({ startDate: "2026-10-01", endDate: "2026-10-20" });
            expect(isHistoricalWriterSlot(source, slot(2, "2026-10-14", A), widened)).toBe(false);
            const narrowed = () => ({ startDate: "2026-10-01", endDate: "2026-10-01" });
            expect(isHistoricalWriterSlot(source, slot(2, "2026-10-14", A), narrowed)).toBe(true);
            // A period that cannot be read leaves the slot period-bearing.
            expect(isHistoricalWriterSlot(source, slot(2, "2026-10-14", A), () => null)).toBe(false);
        });
    });

    describe("classifyPeriodOwnership", () => {
        it("separates period-bearing, historical, historical-only, slotless and mixed owners", () => {
            const source = {
                assignments: [replacedA(), liveB(), assignment(C, 57, "2026-09-01", "2026-09-02", { replaced: true })],
                // A wrote sessions 1 and 3; B owns session 2; C owns nothing.
                sessions: [row(1, 55), row(3, 55)],
            };
            const entries = [slot(1, "2026-10-01", A), slot(2, "2026-10-02", B), slot(3, "2026-10-14", A)];
            const result = classifyPeriodOwnership(source, entries);
            // Mixed: A keeps its legitimate 10-01 only, the later slot bears no period.
            expect(result.periodSlots.get(A)).toEqual({ slots: [entries[0]], startDate: "2026-10-01", endDate: "2026-10-01" });
            expect(result.periodSlots.get(B)).toEqual({ slots: [entries[1]], startDate: "2026-10-02", endDate: "2026-10-02" });
            expect([...result.historicalSlots]).toEqual([3]);
            expect([...result.historicalOnly]).toEqual([]);
            expect([...result.slotless]).toEqual([C]);
        });

        it("reports an owner whose every session is historical as historical-only, with no range", () => {
            const source = { assignments: [replacedA(), liveB()], sessions: [row(1, 55)] };
            const entries = [slot(1, "2026-10-14", A), slot(2, "2026-10-15", B), slot(3, "2026-10-16", B)];
            const result = classifyPeriodOwnership(source, entries);
            expect([...result.historicalOnly]).toEqual([A]);
            expect(result.periodSlots.has(A)).toBe(false);
            expect(result.periodSlots.get(B)).toMatchObject({ startDate: "2026-10-15", endDate: "2026-10-16" });
            expect([...result.historicalSlots]).toEqual([1]);
            expect([...result.slotless]).toEqual([]);
        });

        it("reports an assignment that owns no session as slotless, never as historical-only", () => {
            const result = classifyPeriodOwnership({ assignments: [replacedA(), liveB()], sessions: [] }, [slot(1, "2026-10-02", B)]);
            expect([...result.slotless]).toEqual([A]);
            expect([...result.historicalOnly]).toEqual([]);
        });

        it("keeps duplicate and ambiguous rows period-bearing, so the ambiguity checks still see the slot", () => {
            const entries = [slot(1, "2026-10-14", A), slot(2, "2026-10-15", A)];
            const duplicate = classifyPeriodOwnership(
                { assignments: [replacedA()], sessions: [row(1, 55), row(1, 55), row(2, 55, { ambiguous: true })] },
                entries,
            );
            expect([...duplicate.historicalSlots]).toEqual([]);
            expect([...duplicate.historicalOnly]).toEqual([]);
            expect(duplicate.periodSlots.get(A)).toMatchObject({ startDate: "2026-10-14", endDate: "2026-10-15" });
        });

        it("reads the range as the min and max date of the period-bearing slots, in the order given", () => {
            const live = assignment(B, 56, "2026-10-01", "2026-10-30");
            const entries = [slot(1, "2026-10-20", B), slot(2, "2026-10-05", B), slot(3, "2026-10-12", B)];
            const result = classifyPeriodOwnership({ assignments: [live], sessions: [] }, entries);
            expect(result.periodSlots.get(B)).toEqual({ slots: entries, startDate: "2026-10-05", endDate: "2026-10-20" });
        });

        it("overrides the stored period with periodOf: a slot is historical against the new period only", () => {
            const source = { assignments: [replacedA()], sessions: [row(1, 55)] };
            const entries = [slot(1, "2026-10-14", A)];
            const stored = classifyPeriodOwnership(source, entries);
            expect([...stored.historicalOnly]).toEqual([A]);
            const reaching = classifyPeriodOwnership(source, entries, () => ({ startDate: "2026-10-01", endDate: "2026-10-14" }));
            expect([...reaching.historicalOnly]).toEqual([]);
            expect(reaching.periodSlots.get(A)).toMatchObject({ startDate: "2026-10-14", endDate: "2026-10-14" });
        });

        it("keeps an owner that is not among the assignments period-bearing", () => {
            const result = classifyPeriodOwnership({ assignments: [liveB()], sessions: [row(1, 55)] }, [slot(1, "2026-10-01", A)]);
            expect(result.periodSlots.get(A)).toMatchObject({ startDate: "2026-10-01" });
            expect([...result.historicalOnly]).toEqual([]);
        });
    });

    describe("storedAssignmentPeriod and scheduleFollows", () => {
        it("reads the stored dates, falling back to the schedule's", () => {
            expect(storedAssignmentPeriod(assignment(A, 55, "2026-10-01", "2026-10-02"))).toEqual({ startDate: "2026-10-01", endDate: "2026-10-02" });
            expect(storedAssignmentPeriod(assignment(A, 55, "", "", { scheduleStartDate: "2026-09-01", scheduleEndDate: "2026-09-05" })))
                .toEqual({ startDate: "2026-09-01", endDate: "2026-09-05" });
            expect(storedAssignmentPeriod(assignment(A, 55, "", "", { scheduleStartDate: "", scheduleEndDate: "" }))).toBeNull();
        });

        it("orders schedules by id only, and never when one is missing", () => {
            expect(scheduleFollows(56, 55)).toBe(true);
            expect(scheduleFollows(55, 56)).toBe(false);
            expect(scheduleFollows(55, 55)).toBe(false);
            expect(scheduleFollows(null, 55)).toBe(false);
            expect(scheduleFollows(56, null)).toBe(false);
        });
    });
});
