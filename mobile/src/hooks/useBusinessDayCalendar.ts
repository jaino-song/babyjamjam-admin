import { useCallback, useMemo, useRef } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { isoDateInKorea, KR_BUILTIN_CALENDAR, type KrBusinessDayCalendar } from "@/lib/date/business-days";
import {
    buildCalendarFromHolidayYears,
    holidayYearsToRequest,
} from "@babyjamjam/shared/utils/holiday-calendar";
import { holidayCalendarApi, type BranchHolidayYear } from "@/services/holidays";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";

const HOLIDAY_STALE_TIME_MS = 5 * 60 * 1000;
const MIN_EXTRA_YEAR = 2000;
const MAX_EXTRA_YEAR = 2100;

export type BusinessDayCalendarError = null | "no-branch" | "load-failed";
export type RefreshForSaveResult =
    | { ok: true; calendar: KrBusinessDayCalendar; changed: boolean }
    | { ok: false };

export interface UseBusinessDayCalendarOptions {
    /** Years beyond previous/current/next (e.g. a contract end-date year). Out-of-range or non-integer values are ignored. */
    extraYears?: number[];
}

export interface UseBusinessDayCalendarResult {
    /** Last successfully built branch calendar, even on refresh failure; built-in only before a build. Display-only unless ready. */
    calendar: KrBusinessDayCalendar;
    /** True only when all requested years loaded validly with no query errors. */
    ready: boolean;
    error: BusinessDayCalendarError;
    /** Refetches failed years, or all requested years when the calendar payload is invalid. */
    retry: () => void;
    /** Fetch fresh years before saved computations; never save on failure. */
    refreshForSave: () => Promise<RefreshForSaveResult>;
    /** `calendar.version` — a cheap dependency for memoised consumers. */
    version: string;
}

export const holidayYearQueryKey = (branchId: string, year: number) => ["holidays", branchId, year] as const;

function resolveYears(extraYears: readonly number[] | undefined): number[] {
    const years = new Set<number>(holidayYearsToRequest(isoDateInKorea()));
    for (const year of extraYears ?? []) {
        if (Number.isInteger(year) && year >= MIN_EXTRA_YEAR && year <= MAX_EXTRA_YEAR) years.add(year);
    }
    return [...years].sort((a, b) => a - b);
}

function buildBranchCalendar(loaded: BranchHolidayYear[]): KrBusinessDayCalendar {
    const calendar = buildCalendarFromHolidayYears(loaded);
    const revisions = [...loaded].sort((a, b) => a.year - b.year)
        .map(({ year, revision }) => `${year}:${revision}`).join(",");
    return { ...calendar, version: `${calendar.version}-revisions-${revisions}` };
}

/**
 * The calendar business-day computations must use: the signed-in user's branch
 * calendar (public holidays plus the branch's own adds/excludes), loaded per
 * year and combined into one object.
 *
 * Display-only callers may use `calendar` straight away. Callers whose result
 * is saved or sent to the server must wait for `ready`, then refreshForSave
 * and compute using its returned calendar. Cached calendars remain display-only on error.
 */
export function useBusinessDayCalendar(opts?: UseBusinessDayCalendarOptions): UseBusinessDayCalendarResult {
    const { data: user } = useGetAuthUser();
    const queryClient = useQueryClient();
    const branchId = user?.branchId || null;
    const years = resolveYears(opts?.extraYears);
    const yearsKey = years.join(",");
    const requestRef = useRef({ branchId, years });
    requestRef.current = { branchId, years };

    const results = useQueries({
        queries: years.map((year) => ({
            queryKey: holidayYearQueryKey(branchId ?? "", year),
            queryFn: () => holidayCalendarApi.getYear(branchId as string, year),
            enabled: branchId !== null,
            staleTime: HOLIDAY_STALE_TIME_MS,
        })),
    });

    const resultsRef = useRef(results);
    resultsRef.current = results;
    const lastBuilt = useRef<{ branchId: string; calendar: KrBusinessDayCalendar } | null>(null);

    const loaded: BranchHolidayYear[] | null =
        branchId !== null && results.every((result) => result.data !== undefined)
            ? results.map((result) => result.data as BranchHolidayYear)
            : null;
    const dataStamp = results.map((result) => result.dataUpdatedAt).join(",");
    const failed = branchId !== null && results.some((result) => result.isError);

    // Rebuilt when any year's data arrives (dataUpdatedAt), but the previous
    // calendar object is reused whenever the built version is unchanged, so
    // consumers memoising on `calendar` do not re-run for a no-op refetch.
    // A malformed payload fails closed to "load-failed" instead of throwing in render.
    const built = useMemo<{ calendar: KrBusinessDayCalendar | null; invalid: boolean }>(() => {
        if (branchId === null || loaded === null) return { calendar: null, invalid: false };
        try {
            const next = buildBranchCalendar(loaded);
            const previous = lastBuilt.current;
            if (previous && previous.branchId === branchId && previous.calendar.version === next.version) {
                return { calendar: previous.calendar, invalid: false };
            }
            lastBuilt.current = { branchId, calendar: next };
            return { calendar: next, invalid: false };
        } catch {
            return { calendar: null, invalid: true };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `loaded` is rebuilt every render; branch, year set and data timestamps are its real inputs.
    }, [branchId, yearsKey, dataStamp]);

    const retry = useCallback(() => {
        for (const result of resultsRef.current) {
            if (built.invalid || result.isError) void result.refetch();
        }
    }, [built.invalid]);

    const calendar = built.calendar
        ?? (lastBuilt.current?.branchId === branchId ? lastBuilt.current.calendar : null)
        ?? KR_BUILTIN_CALENDAR;
    const versionRef = useRef(calendar.version);
    versionRef.current = calendar.version;
    const refreshForSave = useCallback(async (): Promise<RefreshForSaveResult> => {
        const { branchId: requestedBranch, years: requestedYears } = requestRef.current;
        const previousVersion = versionRef.current;
        if (requestedBranch === null) return { ok: false };
        try {
            const fresh = await Promise.all(requestedYears.map((year) => queryClient.fetchQuery({
                queryKey: holidayYearQueryKey(requestedBranch, year),
                queryFn: () => holidayCalendarApi.getYear(requestedBranch, year),
                staleTime: 0,
            })));
            if (requestRef.current.branchId !== requestedBranch
                || requestRef.current.years.join(",") !== requestedYears.join(",")) return { ok: false };
            const next = buildBranchCalendar(fresh);
            return { ok: true, calendar: next, changed: next.version !== previousVersion };
        } catch {
            return { ok: false };
        }
    }, [queryClient]);
    let error: BusinessDayCalendarError = null;
    if (branchId === null) error = "no-branch";
    else if (failed || built.invalid) error = "load-failed";

    return { calendar, ready: built.calendar !== null && !failed && !built.invalid, error, retry, refreshForSave, version: calendar.version };
}
