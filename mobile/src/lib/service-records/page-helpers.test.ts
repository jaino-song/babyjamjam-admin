import { serviceRecordCalendarYears } from "./page-helpers";

it("loads the window edge years and every year between them", () => {
    const years = serviceRecordCalendarYears({ startDate: "2024-01-03", endDate: "2026-12-28" }, "2025-07-01");
    expect(years).toEqual([2023, 2024, 2025, 2026, 2027]);
});
it("handles unbounded sides and retains endpoint year bounds", () => {
    expect(serviceRecordCalendarYears({ startDate: null, endDate: "2099-12-30" }, "2100-01-02")).toEqual([2099, 2100]);
});
