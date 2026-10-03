import { useCallback, useEffect, useRef, useState } from "react";
import { KR_BUILTIN_CALENDAR, type KrBusinessDayCalendar } from "@/lib/date/business-days";
import {
    buildCalendarFromHolidayYears,
    type HolidayYearPayload,
} from "@babyjamjam/shared/utils/holiday-calendar";

export interface UseTokenBusinessDayCalendarOptions {
    /** Load only once the token context exists (the access cookie is minted by verification). */
    enabled: boolean;
    /** Calendar years to load (already limited to the endpoint's accepted range). */
    years: readonly number[];
    /** Fetches one year from the token-scoped holidays endpoint; must reject on a non-OK response. */
    fetchYear: (year: number) => Promise<HolidayYearPayload>;
}

export interface UseTokenBusinessDayCalendarResult {
    /** The branch calendar once `ready`; the built-in calendar (display-only) until then. */
    calendar: KrBusinessDayCalendar;
    /** True only when every requested year has loaded. SAVED computations must wait for this. */
    ready: boolean;
    error: null | "load-failed";
    retry: () => void;
}

/**
 * Branch calendar for the public service-record token page. Plain state, no
 * react-query: the page has no query client and the branch comes from the
 * token on the server side.
 */
export function useTokenBusinessDayCalendar({
    enabled,
    years,
    fetchYear,
}: UseTokenBusinessDayCalendarOptions): UseTokenBusinessDayCalendarResult {
    const yearsKey = [...new Set(years)].sort((a, b) => a - b).join(",");
    const [loaded, setLoaded] = useState<{ yearsKey: string; calendar: KrBusinessDayCalendar } | null>(null);
    const [failedKey, setFailedKey] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const fetchRef = useRef(fetchYear);
    // Keeps the latest fetcher without re-running the load below when only its identity changes.
    useEffect(() => {
        fetchRef.current = fetchYear;
    });

    useEffect(() => {
        if (!enabled || yearsKey === "") return;
        let alive = true;
        const requested = yearsKey.split(",").map(Number);
        Promise.all(requested.map(async (year) => {
            const payload = await fetchRef.current(year);
            if (payload?.year !== year) throw new Error(`Unexpected holiday payload for ${year}`);
            return payload;
        }))
            .then((payloads) => {
                if (!alive) return;
                // A malformed payload throws here and fails closed to "load-failed".
                setLoaded({ yearsKey, calendar: buildCalendarFromHolidayYears(payloads) });
                setFailedKey(null);
            })
            .catch(() => {
                if (alive) setFailedKey(yearsKey);
            });
        return () => {
            alive = false;
        };
    }, [enabled, yearsKey, attempt]);

    const retry = useCallback(() => {
        setFailedKey(null);
        setAttempt((current) => current + 1);
    }, []);

    const ready = enabled && loaded !== null && loaded.yearsKey === yearsKey;
    return {
        calendar: loaded?.calendar ?? KR_BUILTIN_CALENDAR,
        ready,
        error: enabled && !ready && failedKey === yearsKey ? "load-failed" : null,
        retry,
    };
}
