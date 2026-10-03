import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useBusinessDayCalendar } from "../useBusinessDayCalendar";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { holidayCalendarApi, type BranchHolidayYear } from "@/services/holidays";
import { isoDateInKorea, KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";

jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: jest.fn() }));
jest.mock("@/services/holidays", () => ({ holidayCalendarApi: { getYear: jest.fn() } }));

const mockUseGetAuthUser = useGetAuthUser as unknown as jest.Mock;
const mockGetYear = holidayCalendarApi.getYear as jest.Mock;

const THIS_YEAR = Number(isoDateInKorea().slice(0, 4));

// A mid-year weekday that is an ordinary business day in the built-in calendar,
// so only a branch-specific change can make it a holiday.
function ordinaryWednesday(year: number): string {
    const date = new Date(Date.UTC(year, 6, 1));
    for (;;) {
        const iso = date.toISOString().slice(0, 10);
        let business = false;
        try {
            business = date.getUTCDay() === 3 && KR_BUILTIN_CALENDAR.isBusinessDay(iso);
        } catch {
            // unsupported year in the built-in list: keep scanning is pointless, fall through
            return iso;
        }
        if (business) return iso;
        date.setUTCDate(date.getUTCDate() + 1);
    }
}

function payload(year: number, extraHolidayDates: string[] = [], revision = 1): BranchHolidayYear {
    return {
        year,
        revision,
        supported: true,
        synced: true,
        lastSyncedAt: null,
        holidays: extraHolidayDates.map((date) => ({
            date,
            name: "지점 휴무",
            source: "branch_add" as const,
            excluded: false,
            overrideId: "override-1",
        })),
        inactiveOverrides: [],
    };
}

function setup(opts?: Parameters<typeof useBusinessDayCalendar>[0]) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, ...renderHook(() => useBusinessDayCalendar(opts), { wrapper }) };
}

describe("useBusinessDayCalendar", () => {
    beforeEach(() => {
        mockGetYear.mockReset();
        mockUseGetAuthUser.mockReset();
        mockUseGetAuthUser.mockReturnValue({ data: { id: "u1", name: "n", branchId: "branch-1" } });
    });

    it("reports no-branch without fetching when the user has no branch", () => {
        mockUseGetAuthUser.mockReturnValue({ data: { id: "u1", name: "n", branchId: null } });

        const { result } = setup();

        expect(result.current.calendar).toBe(KR_BUILTIN_CALENDAR);
        expect(result.current.ready).toBe(false);
        expect(result.current.error).toBe("no-branch");
        expect(result.current.version).toBe(KR_BUILTIN_CALENDAR.version);
        expect(mockGetYear).not.toHaveBeenCalled();
    });

    it("reports no-branch while the auth user has not loaded", () => {
        mockUseGetAuthUser.mockReturnValue({ data: undefined });

        const { result } = setup();

        expect(result.current.error).toBe("no-branch");
        expect(mockGetYear).not.toHaveBeenCalled();
    });

    it("serves the built-in calendar, not ready and without error, while loading", async () => {
        mockGetYear.mockReturnValue(new Promise(() => undefined));

        const { result } = setup();

        expect(result.current.calendar).toBe(KR_BUILTIN_CALENDAR);
        expect(result.current.ready).toBe(false);
        expect(result.current.error).toBeNull();
        await waitFor(() => expect(mockGetYear).toHaveBeenCalledTimes(3));
        expect(mockGetYear.mock.calls.map(([branchId, year]) => [branchId, year])).toEqual([
            ["branch-1", THIS_YEAR - 1],
            ["branch-1", THIS_YEAR],
            ["branch-1", THIS_YEAR + 1],
        ]);
    });

    it("builds the branch calendar once every year has loaded", async () => {
        const branchHoliday = ordinaryWednesday(THIS_YEAR);
        expect(KR_BUILTIN_CALENDAR.isBusinessDay(branchHoliday)).toBe(true);
        mockGetYear.mockImplementation(async (_branchId: string, year: number) =>
            payload(year, year === THIS_YEAR ? [branchHoliday] : [], 7),
        );

        const { result } = setup();

        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.error).toBeNull();
        expect(result.current.calendar.isBusinessDay(branchHoliday)).toBe(false);
        expect(result.current.version).toBe(result.current.calendar.version);
        expect(result.current.version).not.toBe(KR_BUILTIN_CALENDAR.version);
    });

    it("also loads valid extraYears and waits for them before it is ready", async () => {
        let release: (value: BranchHolidayYear) => void = () => undefined;
        mockGetYear.mockImplementation((_branchId: string, year: number) =>
            year === 2024
                ? new Promise<BranchHolidayYear>((resolve) => {
                      release = resolve;
                  })
                : Promise.resolve(payload(year)),
        );

        const { result } = setup({ extraYears: [2024, 2024, 1999, 2101, 2024.5, THIS_YEAR] });

        await waitFor(() => expect(mockGetYear).toHaveBeenCalledTimes(4));
        expect(mockGetYear.mock.calls.map(([, year]) => year)).toEqual(
            [2024, THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1].sort((a, b) => a - b),
        );
        expect(result.current.ready).toBe(false);

        await act(async () => {
            release(payload(2024));
        });

        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(() => result.current.calendar.assertSupportedYear(2024)).not.toThrow();
    });

    it("reports load-failed when a year fails and retry refetches only the failed years", async () => {
        let failTarget = true;
        mockGetYear.mockImplementation(async (_branchId: string, year: number) => {
            if (year === THIS_YEAR && failTarget) throw new Error("boom");
            return payload(year);
        });

        const { result } = setup();

        await waitFor(() => expect(result.current.error).toBe("load-failed"));
        expect(result.current.ready).toBe(false);
        expect(result.current.calendar).toBe(KR_BUILTIN_CALENDAR);
        const callsBeforeRetry = mockGetYear.mock.calls.length;

        failTarget = false;
        act(() => result.current.retry());

        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.error).toBeNull();
        expect(mockGetYear).toHaveBeenCalledTimes(callsBeforeRetry + 1);
        expect(mockGetYear).toHaveBeenLastCalledWith("branch-1", THIS_YEAR);
    });

    it("refetches every requested year after a malformed success and becomes ready", async () => {
        const extraYear = THIS_YEAR - 2;
        mockGetYear.mockImplementation(async (_branchId: string, year: number) =>
            payload(year, year === THIS_YEAR ? [`${THIS_YEAR + 1}-03-03`] : []),
        );

        const { result, queryClient } = setup({ extraYears: [extraYear] });

        await waitFor(() => expect(result.current.error).toBe("load-failed"));
        expect(result.current.ready).toBe(false);
        expect(result.current.calendar).toBe(KR_BUILTIN_CALENDAR);
        const queries = queryClient.getQueryCache().findAll({ queryKey: ["holidays"] });
        expect(queries).toHaveLength(4);
        expect(queries.every((query) => query.state.status === "success" && !query.isStale())).toBe(true);
        const callsBeforeRetry = mockGetYear.mock.calls.length;

        mockGetYear.mockImplementation(async (_branchId: string, year: number) => payload(year));
        act(() => result.current.retry());

        await waitFor(() => expect(mockGetYear).toHaveBeenCalledTimes(callsBeforeRetry + 4));
        expect(mockGetYear.mock.calls.slice(callsBeforeRetry)).toEqual([
            ["branch-1", extraYear],
            ["branch-1", THIS_YEAR - 1],
            ["branch-1", THIS_YEAR],
            ["branch-1", THIS_YEAR + 1],
        ]);
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.error).toBeNull();
    });

    it("keeps the same calendar object when a refetch returns the same data", async () => {
        mockGetYear.mockImplementation(async (_branchId: string, year: number) => payload(year, [], 3));

        const { result, queryClient } = setup();
        await waitFor(() => expect(result.current.ready).toBe(true));
        const first = result.current.calendar;
        const callsBefore = mockGetYear.mock.calls.length;

        await act(async () => {
            await queryClient.refetchQueries({ queryKey: ["holidays"] });
        });

        expect(mockGetYear.mock.calls.length).toBe(callsBefore + 3);
        expect(result.current.ready).toBe(true);
        expect(result.current.calendar).toBe(first);
    });

    it("builds a new calendar when a refetch brings a new revision", async () => {
        const branchHoliday = ordinaryWednesday(THIS_YEAR);
        let revision = 1;
        mockGetYear.mockImplementation(async (_branchId: string, year: number) =>
            payload(year, revision > 1 && year === THIS_YEAR ? [branchHoliday] : [], revision),
        );

        const { result, queryClient } = setup();
        await waitFor(() => expect(result.current.ready).toBe(true));
        const first = result.current.calendar;
        expect(first.isBusinessDay(branchHoliday)).toBe(true);

        revision = 2;
        await act(async () => {
            await queryClient.refetchQueries({ queryKey: ["holidays"] });
        });

        await waitFor(() => expect(result.current.calendar).not.toBe(first));
        expect(result.current.calendar.isBusinessDay(branchHoliday)).toBe(false);
    });
});
