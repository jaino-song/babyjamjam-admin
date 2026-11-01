import { canEditServiceRecordSchedule, SERVICE_STATUS_OPTIONS } from "./index";

describe("canEditServiceRecordSchedule", () => {
  it.each([
    ["pre_booking", { serviceStatus: "pre_booking" as const }],
    ["null", { serviceStatus: null }],
  ])("is false while the client is effectively 예약 전 (%s)", (_label, client) => {
    expect(canEditServiceRecordSchedule(client)).toBe(false);
  });

  it("treats a missing status like 예약 전", () => {
    expect(canEditServiceRecordSchedule({})).toBe(false);
  });

  it.each(SERVICE_STATUS_OPTIONS.filter((option) => option.value !== "pre_booking").map((option) => option.value))(
    "is true once the client is %s",
    (serviceStatus) => {
      expect(canEditServiceRecordSchedule({ serviceStatus })).toBe(true);
    },
  );
});
