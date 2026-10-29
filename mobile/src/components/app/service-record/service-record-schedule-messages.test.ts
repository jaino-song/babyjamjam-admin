import { describeBlockingReasons, describeScheduleSaveError, fillText, scheduleText } from "./service-record-schedule-messages";

const failure = (status: number, data: unknown = {}) => ({ response: { status, data } });

describe("service-record schedule messages", () => {
  it("fills {placeholders} and leaves unknown ones", () => {
    expect(fillText("{a}-{b}", { a: 1 })).toBe("1-{b}");
    expect(scheduleText("ko", "success", { count: 10 })).toBe("서비스 제공일정을 변경했어요.");
  });

  it.each([
    ["SCHEDULE_COUNT_MISMATCH", "선택한 날짜 수가 회차 수와 달라요"],
    ["SCHEDULE_WITH_DATE_MOVE", "다른 날짜 이동과 함께 저장할 수 없어요. 잠시 후 다시 시도해 주세요"],
    ["UNSUPPORTED_HOLIDAY_YEAR", "공휴일 정보가 없는 연도의 날짜는 선택할 수 없어요"],
    ["INVALID_DATE", "올바르지 않은 날짜가 있어요"],
    ["DUPLICATE_SERVICE_DATE", "같은 날짜를 두 번 고를 수 없어요"],
    ["INVERTED_SERVICE_DATES", "날짜 순서가 올바르지 않아요"],
    ["REALIGNMENT_REQUIRES_MANUAL_SCHEDULE", "제공기록지 일정 변경에서 날짜를 직접 지정해 주세요"],
  ])("maps scheduleCode %s to Korean copy", (scheduleCode, message) => {
    expect(describeScheduleSaveError("ko", failure(400, { scheduleCode }))).toBe(message);
  });

  it("maps blocking reasons, naming the session when there is one", () => {
    expect(
      describeBlockingReasons("ko", [
        { code: "NON_SERVICE_DAY", sessionIndex: 4 },
        { code: "SCHEDULE_BEFORE_START" },
        { code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 3 },
      ]),
    ).toBe([
      "4회차: 서비스일이 아닌 날이 포함돼 있어요",
      "시작일보다 앞선 날짜가 포함돼 있어요",
      "3회차: 이미 작성된 회차의 날짜는 바꿀 수 없어요",
    ].join("\n"));
  });

  it("answers an unknown reason or code with generic copy, never the raw code", () => {
    expect(describeBlockingReasons("ko", [{ code: "ASSIGNMENT_RANGE_OVERLAP" }])).toBe(
      "저장할 수 없는 사유가 있어요. 선택한 날짜를 확인해 주세요",
    );
    expect(describeScheduleSaveError("ko", failure(400, { scheduleCode: "SOMETHING_NEW" }))).toBe(
      "저장하지 못했어요. 잠시 후 다시 시도해 주세요",
    );
  });

  it("explains a 409 about an earlier edit that is still running", () => {
    expect(
      describeScheduleSaveError("ko", failure(409, { blockingOperation: { operation: "receipt_refresh" } })),
    ).toBe("이전 수정의 영수증 반영이 아직 진행 중이라 저장할 수 없어요. 잠시 후 다시 시도해 주세요");
  });

  it("falls back from a schedule code to blocking reasons, then the status, then generic", () => {
    expect(describeScheduleSaveError("ko", failure(409, { blockingReasons: [{ code: "NON_SERVICE_DAY" }] }))).toBe(
      "서비스일이 아닌 날이 포함돼 있어요",
    );
    expect(describeScheduleSaveError("ko", failure(403))).toBe("일정을 변경할 권한이 없어요");
    expect(describeScheduleSaveError("ko", new Error("network"))).toBe("저장하지 못했어요. 잠시 후 다시 시도해 주세요");
  });
});
