import { countBusinessDaysKr } from "@/lib/date/business-days";

export interface ServiceDateDurationCheck {
  periodKey: string;
  businessDays: number | null;
  hasMismatch: boolean;
}

export function getServiceDateDurationPeriodKey(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  duration: number | null | undefined,
): string {
  return JSON.stringify([startDate ?? "", endDate ?? "", duration ?? null]);
}

export function getServiceDateDurationCheck(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  duration: number | null | undefined,
): ServiceDateDurationCheck {
  const periodKey = getServiceDateDurationPeriodKey(startDate, endDate, duration);
  let businessDays: number | null = null;

  if (startDate && endDate) {
    try {
      businessDays = countBusinessDaysKr(startDate, endDate);
    } catch {
      businessDays = null;
    }
  }

  const hasPositiveIntegerDuration = Number.isSafeInteger(duration) && (duration ?? 0) > 0;

  return {
    periodKey,
    businessDays,
    hasMismatch: businessDays !== null && hasPositiveIntegerDuration && duration !== businessDays,
  };
}
