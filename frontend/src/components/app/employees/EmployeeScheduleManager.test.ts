import type { Client } from "@/lib/client/types";

import { buildScheduleEntries } from "./EmployeeScheduleManager";

function makeClient(overrides: Partial<Client>): Client {
    return {
        id: 1,
        name: "박서연",
        birthday: null,
        dueDate: null,
        birthDate: null,
        address: null,
        phone: null,
        primaryEmployee: { id: 7, name: "김하늘" },
        secondaryEmployee: null,
        type: null,
        duration: null,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: null,
        endDate: null,
        careCenter: null,
        voucherClient: true,
        breastPump: false,
        serviceStatus: "active",
        eDocId: null,
        hasSigned: false,
        documentStatus: null,
        ...overrides,
    };
}

describe("buildScheduleEntries", () => {
    const now = new Date("2026-09-16T09:00:00+09:00");

    it("maps live start and end dates to the upcoming horizon", () => {
        const entries = buildScheduleEntries([
            makeClient({
                startDate: "2026-09-18",
                endDate: "2026-09-30",
            }),
        ], now);

        expect(entries.map((entry) => [entry.kind, entry.dateKey, entry.meta])).toEqual([
            ["start", "2026-09-18", "김하늘 담당"],
            ["end", "2026-09-30", "김하늘 담당"],
        ]);
    });

    it("surfaces replacement requests today and keeps terminated starts out", () => {
        const entries = buildScheduleEntries([
            makeClient({
                id: 2,
                name: "이하늘",
                serviceStatus: "replacement_requested",
                startDate: null,
            }),
            makeClient({
                id: 3,
                name: "최가람",
                serviceStatus: "terminated",
                startDate: "2026-09-18",
            }),
        ], now);

        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual(expect.objectContaining({
            kind: "replacement",
            dateKey: "2026-09-16",
            title: "이하늘 교체 요청",
        }));
    });

    it("includes future events through the exact 12-month boundary", () => {
        const entries = buildScheduleEntries([
            makeClient({ id: 7, startDate: "2027-03-01" }),
            makeClient({ id: 8, startDate: "2027-09-16" }),
            makeClient({ id: 9, startDate: "2027-09-17" }),
        ], now);
        expect(entries.map((entry) => entry.dateKey)).toEqual(["2027-03-01", "2027-09-16"]);
    });

    it("includes historical dates from January 1, 2026", () => {
        const entries = buildScheduleEntries([
            makeClient({ id: 10, startDate: "2026-01-01", endDate: "2026-08-01" }),
            makeClient({ id: 11, startDate: "2025-12-31" }),
        ], now);
        expect(entries.map((entry) => entry.dateKey)).toEqual(["2026-01-01", "2026-08-01"]);
    });

    it("ignores dates outside the next 12 months and malformed dates", () => {
        const entries = buildScheduleEntries([
            makeClient({ id: 4, startDate: "2025-12-31" }),
            makeClient({ id: 5, startDate: "2027-09-17" }),
            makeClient({ id: 6, startDate: "not-a-date" }),
        ], now);

        expect(entries).toEqual([]);
    });
});
