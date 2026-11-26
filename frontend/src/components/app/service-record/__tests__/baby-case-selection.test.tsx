import { render, screen } from "@testing-library/react";

import ServiceRecordAdminPage from "@/app/(service-record-admin)/service-record-admin/[clientId]/page";
import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";

jest.mock("@/hooks/useBusinessDayCalendar", () => ({
    useBusinessDayCalendar: () => ({
        calendar: KR_BUILTIN_CALENDAR, ready: true, refreshForSave: jest.fn(),
    }),
}));
jest.mock("@/features/service-records/case-events", () => ({
    subscribeServiceRecordCaseChanges: () => () => undefined,
}));

test("second case deep link survives refresh", async () => {
    const caseIds = ["b4817ff5-219d-434a-93d1-6d735b856f44", "c4817ff5-219d-434a-93d1-6d735b856f44"];
    const second = caseIds[1]!;
    const family = caseIds.map((caseId, index) => ({
        caseId, babyId: caseId, rank: index + 1, babyCount: 2, legacyName: null,
        retired: false, status: "IN_PROGRESS", assignees: [], totalSessions: 1, submittedSessions: 1,
    }));
    const originalFetch = global.fetch;
    const fetch = jest.fn(async (path: string) => {
        const url = new URL(path, "http://localhost");
        expect(url.searchParams.getAll("caseId")).toEqual([second]);
        const payload = url.pathname.endsWith("/editor") ? {
            cases: family, assignments: [],
            record: { id: second, status: "IN_PROGRESS", header: null, sessions: [], totalSessions: 1, signatureDocs: [] },
        } : { draft: null, sourceChanged: false, sourceCaseVersion: 1, sourceFingerprint: "selected-second" };
        return { ok: true, status: 200, json: async () => payload };
    });
    global.fetch = fetch as unknown as typeof global.fetch;
    const loadDeepLink = async () => render(await ServiceRecordAdminPage({
        params: Promise.resolve({ clientId: "42" }), searchParams: Promise.resolve({ caseId: second }),
    }));
    try {
        const mounted = await loadDeepLink();
        expect(await screen.findByText("둘째", { exact: true })).toBeVisible();
        expect(screen.queryByText("첫째", { exact: true })).toBeNull();
        mounted.unmount();

        await loadDeepLink();
        expect(await screen.findByText("둘째", { exact: true })).toBeVisible();
        const calls = fetch.mock.calls.map(([path]) => path);
        expect(calls.filter((path) => path.includes("/editor?"))).toHaveLength(2);
        expect(calls.filter((path) => path.includes("/draft?"))).toHaveLength(4);
        expect(calls.every((path) => path.endsWith(`?caseId=${second}`))).toBe(true);
    } finally {
        global.fetch = originalFetch;
    }
});
