import type { KrBusinessDayCalendar, ServiceDayPolicy } from "@/lib/date/business-days";
import type { Client } from "@/lib/client/types";

export type ClientServiceDayFlags = Pick<
  Client,
  "allowSaturdayService" | "allowSundayService" | "allowHolidayService"
>;

/** A client's service-day policy; a missing flag (or client) means "not a service day". */
export function serviceDayPolicyOfClient(
  client?: ClientServiceDayFlags | null,
): ServiceDayPolicy {
  return {
    saturday: client?.allowSaturdayService ?? false,
    sunday: client?.allowSundayService ?? false,
    holiday: client?.allowHolidayService ?? false,
  };
}

/** Opens the calendar to the client's service days; a default policy leaves the calendar untouched. */
export function calendarWithServiceDays(
  calendar: KrBusinessDayCalendar,
  policy: ServiceDayPolicy,
): KrBusinessDayCalendar {
  return policy.saturday || policy.sunday || policy.holiday ? calendar.withServiceDays(policy) : calendar;
}
