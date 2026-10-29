import { serviceDayPolicyOf } from "domain/entities/client.entity";
import type { KrBusinessDayCalendar } from "domain/utils/business-days";

type ClientServiceDayFlags = {
    allowSaturdayService?: boolean | null;
    allowSundayService?: boolean | null;
    allowHolidayService?: boolean | null;
};

/**
 * The calendar a CLIENT's service days are computed on: the branch calendar
 * under the client's own Saturday / Sunday / holiday service policy.
 *
 * A missing client or a null flag means "not allowed". A client with no
 * enabled flag keeps the branch calendar instance untouched (no
 * `withServiceDays` call), so the default path keeps its identity and version.
 * Re-wrapping an already wrapped calendar replaces the policy, never composes.
 */
export function withClientServiceDays<C extends KrBusinessDayCalendar>(
    calendar: C,
    client: ClientServiceDayFlags | null | undefined,
): C {
    const policy = serviceDayPolicyOf({
        allowSaturdayService: client?.allowSaturdayService ?? false,
        allowSundayService: client?.allowSundayService ?? false,
        allowHolidayService: client?.allowHolidayService ?? false,
    });
    if (!policy.saturday && !policy.sunday && !policy.holiday) return calendar;
    return calendar.withServiceDays(policy) as C;
}
