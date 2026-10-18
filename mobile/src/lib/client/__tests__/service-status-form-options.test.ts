import {
  getServiceStatusFormOptions,
  SERVICE_STATUS_BOOKING_HELPER,
  SERVICE_STATUS_BOOKING_REFUSAL,
} from "../service-status-form-options";

const values = (input: Parameters<typeof getServiceStatusFormOptions>[0]) =>
  getServiceStatusFormOptions(input).map((option) => option.value);

describe("getServiceStatusFormOptions", () => {
  it("offers only 예약 전 when creating, whatever status is passed along", () => {
    expect(values({ isCreate: true })).toEqual(["pre_booking"]);
    expect(values({ isCreate: true, currentStatus: "active", bookingConfirmedAt: "2026-10-01T00:00:00.000Z" })).toEqual([
      "pre_booking",
    ]);
  });

  it("offers 예약 전 and 중단 for an unconfirmed client", () => {
    expect(values({ isCreate: false, bookingConfirmedAt: null, currentStatus: "pre_booking" })).toEqual([
      "pre_booking",
      "terminated",
    ]);
    expect(values({ isCreate: false, currentStatus: "pre_booking" })).toEqual(["pre_booking", "terminated"]);
  });

  it("adds the current status of an unconfirmed client when it is something else", () => {
    expect(values({ isCreate: false, bookingConfirmedAt: null, currentStatus: "replacement_requested" })).toEqual([
      "pre_booking",
      "replacement_requested",
      "terminated",
    ]);
    expect(values({ isCreate: false, bookingConfirmedAt: null, currentStatus: "terminated" })).toEqual([
      "pre_booking",
      "terminated",
    ]);
  });

  it("never offers 예약 전 to a confirmed client", () => {
    const confirmed = values({ isCreate: false, bookingConfirmedAt: "2026-10-01T00:00:00.000Z", currentStatus: "active" });
    expect(confirmed).not.toContain("pre_booking");
    expect(confirmed).toEqual(["waiting", "replacement_requested", "active", "completed", "terminated"]);
  });

  it("still renders the current 예약 전 of a confirmed client that has no dates", () => {
    expect(values({ isCreate: false, bookingConfirmedAt: "2026-10-01T00:00:00.000Z", currentStatus: "pre_booking" }))
      .toContain("pre_booking");
  });

  it("carries the authored copy", () => {
    expect(SERVICE_STATUS_BOOKING_HELPER).toBe("대기·진행·완료는 고객 상세의 [예약 확정]으로 바뀝니다.");
    expect(SERVICE_STATUS_BOOKING_REFUSAL).toBe(
      "이 상태로는 저장할 수 없습니다. 예약 상태는 [예약 확정]으로만 바꿀 수 있습니다.",
    );
  });
});
