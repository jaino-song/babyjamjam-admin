import { PROBLEM_CATALOG } from "@babyjamjam/shared";

import type { HolidayReviewEvent } from "@/services/holiday-review";

import { describeReviewEvent, describeSkipCode, formatMonthDay, reviewSourceLabel } from "../review-format";

const BASE: HolidayReviewEvent = {
  id: "evt-1",
  date: "2026-10-05",
  change: "added",
  name: "대체공휴일(개천절)",
  source: "kasi",
  safeOpen: 1,
  riskOpen: 0,
  createdAt: "2026-09-30T19:00:00.000Z",
};

describe("review-format", () => {
  it("formats M/D without leading zeros", () => {
    expect(formatMonthDay("2026-10-05")).toBe("10/5");
    expect(formatMonthDay("2026-01-02")).toBe("1/2");
  });

  it("words public events by name and change", () => {
    expect(describeReviewEvent(BASE)).toBe("10/5 대체공휴일(개천절) 추가");
    expect(describeReviewEvent({ ...BASE, change: "removed" })).toBe("10/5 대체공휴일(개천절) 삭제");
    expect(describeReviewEvent({ ...BASE, name: null })).toBe("10/5 공휴일 추가");
  });

  it("words branch-override events without the name", () => {
    const override = { ...BASE, source: "branch" as const, name: null };
    expect(describeReviewEvent(override)).toBe("10/5 이 지점 공휴일로 지정");
    expect(describeReviewEvent({ ...override, change: "removed" })).toBe("10/5 이 지점 공휴일에서 빠짐");
  });

  it("treats any non-public source as branch-sourced", () => {
    const unknown = { ...BASE, source: "something-else" as unknown as HolidayReviewEvent["source"] };
    expect(describeReviewEvent(unknown)).toBe("10/5 이 지점 공휴일로 지정");
    expect(reviewSourceLabel(unknown)).toBe("지점 설정");
    expect(reviewSourceLabel(BASE)).toBe("공공데이터");
  });

  it.each([
    "ITEM_RISK",
    "ITEM_NOT_OPEN",
    "ITEM_NOT_FOUND",
    "CLIENT_CHANGED",
    "CLIENT_FINISHED",
    "ALREADY_MATCHES",
    "NO_LONGER_SAFE",
    "UPDATE_FAILED",
    "RECALCULATED_CHANGED",
  ])("maps skip code %s to a specific Korean reason", (code) => {
    expect(describeSkipCode(code)).not.toBe("수정하지 못했어요");
  });

  it("tells the user a finished-service client was left alone", () => {
    expect(describeSkipCode("CLIENT_FINISHED")).toBe("서비스가 끝난 고객이라 수정하지 않았어요");
  });

  it("tells the user a refreshed end date needs another look", () => {
    expect(describeSkipCode("RECALCULATED_CHANGED")).toBe("새 종료일이 다시 계산됐어요. 목록에서 확인해 주세요.");
  });

  it("tells the user to check the list when a later chunk's request failed", () => {
    expect(describeSkipCode("REQUEST_FAILED")).toBe(
      "응답이 늦어 결과를 확인하지 못했어요. 목록을 새로고침해 확인해 주세요",
    );
  });

  it("uses the problem catalog title for backend problem codes and a generic line otherwise", () => {
    expect(describeSkipCode("SERVICE_RECORD_FINALIZED")).toBe(PROBLEM_CATALOG.SERVICE_RECORD_FINALIZED.title["ko-KR"]);
    expect(describeSkipCode("SOMETHING_NEW")).toBe("수정하지 못했어요");
    expect(describeSkipCode("constructor")).toBe("수정하지 못했어요");
  });
});
