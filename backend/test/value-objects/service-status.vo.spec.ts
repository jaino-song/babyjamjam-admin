/**
 * Unit tests for ServiceStatus value object
 * Tests status computation based on dates and manual status preservation
 */

import {
    SERVICE_STATUS,
    computeServiceStatus,
    isAutomaticServiceStatusTransitionAllowed,
    shouldUpdateStatus,
    isManualStatus,
} from "domain/value-objects/service-status.vo";
import { getEffectiveClientServiceStatus } from "domain/repositories/client.repository.interface";

describe("SERVICE_STATUS constants", () => {
    it("should have all expected status values", () => {
        expect(SERVICE_STATUS.PRE_BOOKING).toBe("pre_booking");
        expect(SERVICE_STATUS.WAITING).toBe("waiting");
        expect(SERVICE_STATUS.ACTIVE).toBe("active");
        expect(SERVICE_STATUS.COMPLETED).toBe("completed");
        expect(SERVICE_STATUS.TERMINATED).toBe("terminated");
        expect(SERVICE_STATUS.REPLACEMENT_REQUESTED).toBe("replacement_requested");
    });
});

describe("computeServiceStatus", () => {
    // Fixed clock: 2026-10-07 21:00 KST. Stored service dates are @db.Date
    // columns, i.e. UTC-midnight Dates, so fixtures are built the same way.
    const NOW = new Date("2026-10-07T12:00:00.000Z");
    const KST_TODAY = "2026-10-07";

    const dateOnly = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
    // Stored date `days` calendar days away from the Korean "today" of NOW.
    const daysFromNow = (days: number): Date => {
        const base = dateOnly(KST_TODAY);
        base.setUTCDate(base.getUTCDate() + days);
        return base;
    };
    const compute = (status: string | null, start: Date | null, end: Date | null) =>
        computeServiceStatus(status, start, end, NOW);

    describe("given manual statuses", () => {
        it("should preserve pre-booking status without service dates", () => {
            const result = compute("pre_booking", null, null);

            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });

        it("should preserve terminated status", () => {
            const pastStart = daysFromNow(-30);
            const pastEnd = daysFromNow(-10);
            // Even though dates indicate completed, terminated should be preserved
            const result = compute("terminated", pastStart, pastEnd);
            expect(result).toBe(SERVICE_STATUS.TERMINATED);
        });

        it("should preserve replacement_requested status", () => {
            const pastStart = daysFromNow(-10);
            const futureEnd = daysFromNow(20);
            // Even though dates indicate active, replacement_requested should be preserved
            const result = compute("replacement_requested", pastStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.REPLACEMENT_REQUESTED);
        });
    });

    describe("given date-based computation", () => {
        it("should return waiting when start date is in the future", () => {
            const futureStart = daysFromNow(10);
            const futureEnd = daysFromNow(40);
            const result = compute(null, futureStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.WAITING);
        });

        it("should return waiting when current status is null and start date is tomorrow", () => {
            const tomorrow = daysFromNow(1);
            const futureEnd = daysFromNow(30);
            const result = compute(null, tomorrow, futureEnd);
            expect(result).toBe(SERVICE_STATUS.WAITING);
        });

        it("should return active when today is between start and end dates", () => {
            const pastStart = daysFromNow(-10);
            const futureEnd = daysFromNow(20);
            const result = compute(null, pastStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });

        it("should return active when today equals start date", () => {
            const today = daysFromNow(0);
            const futureEnd = daysFromNow(30);
            const result = compute("waiting", today, futureEnd);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });

        it("should return active when today equals end date", () => {
            const pastStart = daysFromNow(-30);
            const today = daysFromNow(0);
            const result = compute("active", pastStart, today);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });

        it("should return completed when end date has passed", () => {
            const pastStart = daysFromNow(-30);
            const pastEnd = daysFromNow(-1);
            const result = compute("active", pastStart, pastEnd);
            expect(result).toBe(SERVICE_STATUS.COMPLETED);
        });

        it("should return completed when end date was yesterday", () => {
            const pastStart = daysFromNow(-30);
            const yesterday = daysFromNow(-1);
            const result = compute(null, pastStart, yesterday);
            expect(result).toBe(SERVICE_STATUS.COMPLETED);
        });
    });

    describe("given null dates", () => {
        it("should return pre-booking when start date is null", () => {
            const result = compute(null, null, daysFromNow(30));
            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });

        it("should return pre-booking when end date is null", () => {
            const result = compute(null, daysFromNow(-10), null);
            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });

        it("should return pre-booking when both dates are null", () => {
            const result = compute(null, null, null);
            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });

        it("should return pre-booking when dates are null even with existing status", () => {
            const result = compute("active", null, null);
            expect(result).toBe(SERVICE_STATUS.PRE_BOOKING);
        });
    });

    describe("given edge cases with time zones", () => {
        it("should use date-only comparison (ignoring time of day in the stored value)", () => {
            // A stored value carrying a time of day still means its UTC calendar date.
            const startDate = new Date("2026-10-06T23:59:59.999Z");
            const endDate = new Date("2026-10-08T00:00:00.000Z");

            const result = compute(null, startDate, endDate);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });
    });

    describe("given override of waiting status", () => {
        it("should update waiting to active when dates indicate active", () => {
            const pastStart = daysFromNow(-5);
            const futureEnd = daysFromNow(25);
            const result = compute("waiting", pastStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });

        it("should update waiting to completed when dates indicate completed", () => {
            const pastStart = daysFromNow(-30);
            const pastEnd = daysFromNow(-5);
            const result = compute("waiting", pastStart, pastEnd);
            expect(result).toBe(SERVICE_STATUS.COMPLETED);
        });
    });

    describe("given override of active status", () => {
        it("should update active to completed when end date has passed", () => {
            const pastStart = daysFromNow(-30);
            const pastEnd = daysFromNow(-5);
            const result = compute("active", pastStart, pastEnd);
            expect(result).toBe(SERVICE_STATUS.COMPLETED);
        });

        it("should keep active status when still within date range", () => {
            const pastStart = daysFromNow(-10);
            const futureEnd = daysFromNow(20);
            const result = compute("active", pastStart, futureEnd);
            expect(result).toBe(SERVICE_STATUS.ACTIVE);
        });
    });

    describe("given the Korean calendar date between 00:00 and 09:00 KST", () => {
        // 2026-10-07T16:30Z is 2026-10-08 01:30 KST but still 2026-10-07 in UTC.
        const EARLY_KST = new Date("2026-10-07T16:30:00.000Z");

        afterEach(() => {
            jest.useRealTimers();
        });

        it("reads a service starting on the Korean date as active (3-argument call, system clock)", () => {
            jest.useFakeTimers().setSystemTime(EARLY_KST);
            expect(computeServiceStatus(null, dateOnly("2026-10-08"), dateOnly("2026-11-08"))).toBe(
                SERVICE_STATUS.ACTIVE,
            );
        });

        it("reads a service that ended on the previous Korean date as completed (3-argument call, system clock)", () => {
            jest.useFakeTimers().setSystemTime(EARLY_KST);
            expect(computeServiceStatus("active", dateOnly("2026-09-20"), dateOnly("2026-10-07"))).toBe(
                SERVICE_STATUS.COMPLETED,
            );
        });

        it("accepts an explicit now", () => {
            expect(computeServiceStatus(null, dateOnly("2026-10-08"), dateOnly("2026-11-08"), EARLY_KST)).toBe(
                SERVICE_STATUS.ACTIVE,
            );
            expect(computeServiceStatus("active", dateOnly("2026-09-20"), dateOnly("2026-10-07"), EARLY_KST)).toBe(
                SERVICE_STATUS.COMPLETED,
            );
        });

        it("flips the Korean date exactly at 15:00Z", () => {
            const start = dateOnly("2026-10-08");
            const end = dateOnly("2026-10-08");
            expect(computeServiceStatus(null, start, end, new Date("2026-10-07T14:59:59.999Z"))).toBe(
                SERVICE_STATUS.WAITING,
            );
            expect(computeServiceStatus(null, start, end, new Date("2026-10-07T15:00:00.000Z"))).toBe(
                SERVICE_STATUS.ACTIVE,
            );
            expect(computeServiceStatus(null, start, end, new Date("2026-10-08T14:59:59.999Z"))).toBe(
                SERVICE_STATUS.ACTIVE,
            );
            expect(computeServiceStatus(null, start, end, new Date("2026-10-08T15:00:00.000Z"))).toBe(
                SERVICE_STATUS.COMPLETED,
            );
        });
    });

    describe("parity with getEffectiveClientServiceStatus", () => {
        const instants = [
            "2026-10-07T00:00:00.000Z",
            "2026-10-07T14:59:59.999Z",
            "2026-10-07T15:00:00.000Z",
            "2026-10-07T16:30:00.000Z",
            "2026-10-07T23:59:59.999Z",
            "2026-10-08T00:00:00.000Z",
            "2026-10-08T14:59:59.999Z",
            "2026-10-08T15:00:00.000Z",
        ];
        const periods: Array<[string, string]> = [
            ["2026-10-07", "2026-10-07"],
            ["2026-10-08", "2026-10-08"],
            ["2026-10-08", "2026-11-08"],
            ["2026-09-01", "2026-10-07"],
            ["2026-09-01", "2026-10-08"],
            ["2026-10-09", "2026-11-09"],
        ];
        const nonManual = [null, "waiting", "active", "completed"];
        const manual = ["pre_booking", "terminated", "replacement_requested"];

        it("agrees for every non-manual status, instant and period", () => {
            for (const instant of instants) {
                const now = new Date(instant);
                for (const [start, end] of periods) {
                    for (const status of nonManual) {
                        expect(computeServiceStatus(status, dateOnly(start), dateOnly(end), now)).toBe(
                            getEffectiveClientServiceStatus(status, dateOnly(start), dateOnly(end), now),
                        );
                    }
                }
            }
        });

        it("keeps manual statuses unchanged at every instant", () => {
            for (const instant of instants) {
                const now = new Date(instant);
                for (const status of manual) {
                    expect(computeServiceStatus(status, dateOnly("2026-10-08"), dateOnly("2026-11-08"), now)).toBe(
                        status,
                    );
                    expect(computeServiceStatus(status, null, null, now)).toBe(status);
                }
            }
        });
    });
});

describe("shouldUpdateStatus", () => {
    it("should return false for terminated status", () => {
        expect(shouldUpdateStatus("terminated", SERVICE_STATUS.ACTIVE)).toBe(false);
        expect(shouldUpdateStatus("terminated", SERVICE_STATUS.COMPLETED)).toBe(false);
    });

    it("should return false for replacement_requested status", () => {
        expect(shouldUpdateStatus("replacement_requested", SERVICE_STATUS.ACTIVE)).toBe(false);
        expect(shouldUpdateStatus("replacement_requested", SERVICE_STATUS.COMPLETED)).toBe(false);
    });

    it("should return true when status differs", () => {
        expect(shouldUpdateStatus("waiting", SERVICE_STATUS.ACTIVE)).toBe(true);
        expect(shouldUpdateStatus("active", SERVICE_STATUS.COMPLETED)).toBe(true);
        expect(shouldUpdateStatus(null, SERVICE_STATUS.ACTIVE)).toBe(true);
    });

    it("should return false when status is the same", () => {
        expect(shouldUpdateStatus("waiting", SERVICE_STATUS.WAITING)).toBe(false);
        expect(shouldUpdateStatus("active", SERVICE_STATUS.ACTIVE)).toBe(false);
        expect(shouldUpdateStatus("completed", SERVICE_STATUS.COMPLETED)).toBe(false);
    });
});

describe("isAutomaticServiceStatusTransitionAllowed", () => {
    it("allows an observed non-terminal status to move to a date-derived status", () => {
        expect(isAutomaticServiceStatusTransitionAllowed("waiting", SERVICE_STATUS.ACTIVE)).toBe(true);
        expect(isAutomaticServiceStatusTransitionAllowed(null, SERVICE_STATUS.PRE_BOOKING)).toBe(true);
    });

    it.each(["pre_booking", "terminated", "replacement_requested"])(
        "blocks date-derived movement from manual %s",
        (currentStatus) => {
            expect(isAutomaticServiceStatusTransitionAllowed(currentStatus, SERVICE_STATUS.ACTIVE)).toBe(false);
        },
    );

    it("blocks a manual target even when the observed status is automatic", () => {
        expect(isAutomaticServiceStatusTransitionAllowed("waiting", SERVICE_STATUS.TERMINATED)).toBe(false);
    });
});

describe("isManualStatus", () => {
    it("should return true for pre-booking", () => {
        expect(isManualStatus("pre_booking")).toBe(true);
    });

    it("should return true for terminated", () => {
        expect(isManualStatus("terminated")).toBe(true);
    });

    it("should return true for replacement_requested", () => {
        expect(isManualStatus("replacement_requested")).toBe(true);
    });

    it("should return false for auto-computed statuses", () => {
        expect(isManualStatus("waiting")).toBe(false);
        expect(isManualStatus("active")).toBe(false);
        expect(isManualStatus("completed")).toBe(false);
    });

    it("should return false for null", () => {
        expect(isManualStatus(null)).toBe(false);
    });

    it("should return false for unknown statuses", () => {
        expect(isManualStatus("unknown")).toBe(false);
        expect(isManualStatus("invalid")).toBe(false);
    });
});
