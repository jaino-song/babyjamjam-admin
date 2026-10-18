import { SERVICE_STATUS_OPTIONS, type ServiceStatus } from "@/lib/client/types";

/**
 * Rule 고객-04: a client is 예약 전 until an admin presses [예약 확정]. Saving the edit form can no
 * longer move a client between 예약 전 and 대기·진행·완료, so the form only offers the statuses the
 * server will accept. The shared `SERVICE_STATUS_OPTIONS` constant stays untouched; the forms filter it.
 */

/** Helper line shown under the status select while the client is not confirmed. */
export const SERVICE_STATUS_BOOKING_HELPER = "대기·진행·완료는 고객 상세의 [예약 확정]으로 바뀝니다.";

/** Shown for a server refusal pointed at `/serviceStatus`, instead of the server's catalog text. */
export const SERVICE_STATUS_BOOKING_REFUSAL =
  "이 상태로는 저장할 수 없습니다. 예약 상태는 [예약 확정]으로만 바꿀 수 있습니다.";

export type ServiceStatusFormOption = (typeof SERVICE_STATUS_OPTIONS)[number];

export interface ServiceStatusFormOptionsInput {
  /** `true` while the form is creating a client; a new client is always 예약 전. */
  isCreate: boolean;
  /** The client's stored confirmation time; `null`/`undefined` = not confirmed. */
  bookingConfirmedAt?: string | null;
  /** The client's current effective status, so the current value always renders. */
  currentStatus?: ServiceStatus | null;
}

/** Which statuses the create / edit form offers, in the order of `SERVICE_STATUS_OPTIONS`. */
export function getServiceStatusFormOptions({
  isCreate,
  bookingConfirmedAt,
  currentStatus,
}: ServiceStatusFormOptionsInput): ServiceStatusFormOption[] {
  if (isCreate) {
    return SERVICE_STATUS_OPTIONS.filter((option) => option.value === "pre_booking");
  }

  const confirmed = bookingConfirmedAt != null;
  return SERVICE_STATUS_OPTIONS.filter((option) => {
    if (option.value === currentStatus) return true;
    if (confirmed) return option.value !== "pre_booking";
    return option.value === "pre_booking" || option.value === "terminated";
  });
}
