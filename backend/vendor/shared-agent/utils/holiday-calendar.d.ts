import { type KrBusinessDayCalendar } from "./business-days";
/**
 * One calendar year of the effective (per-branch) holiday list, as served by
 * `GET /branches/:branchId/holidays?year=` and its token-scoped variant.
 * Structurally compatible with the backend `EffectiveHolidayYear`; extra
 * fields are allowed and ignored.
 */
export interface HolidayYearPayload {
    year: number;
    revision: number;
    /** Whether the holiday list for this year is complete. Never inferred. */
    supported: boolean;
    holidays: Array<{
        date: string;
        name: string;
        excluded?: boolean;
    }>;
}
/**
 * Turns holiday-year payloads into the one calendar object every consumer
 * (desktop, mobile, backend) uses. Only `supported` years are supported by the
 * result, so an unfetched or unsupported year still fails closed.
 */
export declare function buildCalendarFromHolidayYears(years: readonly HolidayYearPayload[]): KrBusinessDayCalendar;
/** Years the apps fetch for a given day: previous, current and next year. */
export declare function holidayYearsToRequest(todayIso: string): number[];
