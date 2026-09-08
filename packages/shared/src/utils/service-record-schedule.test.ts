import {
    getExpectedSessionDateFromRecords,
    shiftServiceRecordScheduleSuffix,
} from "./service-record-schedule";

describe("getExpectedSessionDateFromRecords", () => {
    it("falls back to the N-th business day from start when no records exist", () => {
        expect(getExpectedSessionDateFromRecords("2026-01-05", 1, [])).toBe("2026-01-05");
        expect(getExpectedSessionDateFromRecords("2026-01-02", 2, [])).toBe("2026-01-05");
    });

    it("chains an unwritten slot's expected date from the last written session's actual date", () => {
        const records = Array.from({ length: 13 }, (_, i) => {
            const sessionIndex = i + 1;
            if (sessionIndex === 12) return { sessionIndex, serviceDate: "2026-08-28" };
            if (sessionIndex === 13) return { sessionIndex, serviceDate: "2026-08-31" };
            return { sessionIndex, serviceDate: "2026-08-01" };
        });

        expect(getExpectedSessionDateFromRecords("2026-08-01", 14, records)).toBe("2026-09-01");
        expect(getExpectedSessionDateFromRecords("2026-08-01", 15, records)).toBe("2026-09-02");
        expect(getExpectedSessionDateFromRecords("2026-08-01", 18, records)).toBe("2026-09-07");
    });

    it("chains from the closest preceding written record across a gap", () => {
        const records = [
            { sessionIndex: 1, serviceDate: "2026-07-16" },
            { sessionIndex: 3, serviceDate: "2026-07-20" },
        ];

        // Slot 2 has no record at index 2, so it chains from record 1.
        expect(getExpectedSessionDateFromRecords("2026-07-16", 2, records)).toBe("2026-07-20");
        // Slot 4 chains from the closer record 3, not record 1.
        expect(getExpectedSessionDateFromRecords("2026-07-16", 4, records)).toBe("2026-07-21");
    });

    it("returns null when there is no start date and no preceding record", () => {
        expect(getExpectedSessionDateFromRecords(null, 1, [])).toBeNull();
    });
});

describe("shiftServiceRecordScheduleSuffix", () => {
    const vector = [
        "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
        "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18",
        "2026-09-21", "2026-09-22", "2026-09-23",
    ].map((serviceDate, index) => ({
        sessionIndex: index + 1,
        serviceDate,
        originalDate: serviceDate,
        assignmentId: `assignment-${index + 1}`,
        scheduleId: 10,
        employeeId: 20,
        provenanceVersion: "case-7",
    }));

    it("moves the selected and later sessions by one signed business-day delta", () => {
        const shifted = shiftServiceRecordScheduleSuffix(vector, 3, "2026-09-11");
        expect(shifted.deltaBusinessDays).toBe(2);
        expect(shifted.entries.map(({ serviceDate }) => serviceDate)).toEqual([
            "2026-09-07", "2026-09-08", "2026-09-11", "2026-09-14", "2026-09-15",
            "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22",
            "2026-09-23", "2026-09-28", "2026-09-29",
        ]);
        expect(shifted.entries.map(({ originalDate }) => originalDate)).toEqual(vector.map(({ originalDate }) => originalDate));
    });

    it("preserves irregular gaps while shifting each suffix date independently", () => {
        const entries = ["2026-09-07", "2026-09-09", "2026-09-14"].map((serviceDate, index) => ({
            ...vector[index]!,
            sessionIndex: index + 1,
            serviceDate,
            originalDate: serviceDate,
        }));
        expect(shiftServiceRecordScheduleSuffix(entries, 2, "2026-09-10").entries.map(({ serviceDate }) => serviceDate))
            .toEqual(["2026-09-07", "2026-09-10", "2026-09-15"]);
    });

    it("rejects unsupported, weekend, duplicate, and inverted vectors", () => {
        expect(() => shiftServiceRecordScheduleSuffix(vector, 3, "2028-01-04")).toThrow();
        expect(() => shiftServiceRecordScheduleSuffix(vector, 3, "2026-09-12")).toThrow();
        expect(() => shiftServiceRecordScheduleSuffix(
            vector.map((entry, index) => index === 4 ? { ...entry, serviceDate: vector[3]!.serviceDate } : entry),
            3,
            "2026-09-11",
        )).toThrow();
    });
});
