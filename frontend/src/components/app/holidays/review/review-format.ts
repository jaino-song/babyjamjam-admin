import { PROBLEM_CATALOG } from "@babyjamjam/shared";

import type { HolidayReviewEvent, HolidayReviewReason } from "@/services/holiday-review";
import { REQUEST_FAILED_CODE } from "@/services/holiday-review";

/** "10/5" from YYYY-MM-DD. */
export function formatMonthDay(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** "10/5 대체공휴일(개천절) 추가" (public data) or "10/20 이 지점 공휴일로 지정" (a branch override). */
export function describeReviewEvent(event: HolidayReviewEvent): string {
  const date = formatMonthDay(event.date);
  // Anything that is not public data is a branch's own setting.
  if (event.source !== "kasi") {
    return `${date} ${event.change === "added" ? "이 지점 공휴일로 지정" : "이 지점 공휴일에서 빠짐"}`;
  }
  return `${date} ${event.name ?? "공휴일"} ${event.change === "added" ? "추가" : "삭제"}`;
}

export function reviewSourceLabel(event: HolidayReviewEvent): string {
  return event.source === "kasi" ? "공공데이터" : "지점 설정";
}

export const REVIEW_REASON_LABEL: Record<HolidayReviewReason, string> = {
  no_sessions_after_date: "바뀐 날짜 이후 서비스 기록 없음",
  session_on_or_after_date: "바뀐 날짜에 이미 근무 기록 있음",
  finalized: "서비스 기록 확정됨",
  locked_session_after_new_end: "새 종료일 뒤에 잠긴 근무 기록 있음",
};

const GENERIC_SKIP_REASON = "수정하지 못했어요";

const SKIP_REASON_LABEL: Record<string, string> = {
  ITEM_RISK: "직접 확인이 필요한 고객이에요",
  ITEM_NOT_OPEN: "이미 처리된 항목이에요",
  ITEM_NOT_FOUND: "항목을 찾지 못했어요",
  CLIENT_CHANGED: "그 사이 고객 정보나 종료일이 바뀌었어요",
  CLIENT_FINISHED: "서비스가 끝난 고객이라 수정하지 않았어요",
  ALREADY_MATCHES: "이미 새 종료일과 같아요",
  NO_LONGER_SAFE: "이제는 바로 수정할 수 없는 상태예요",
  UPDATE_FAILED: "저장하지 못했어요",
  RECALCULATED_CHANGED: "새 종료일이 다시 계산됐어요. 목록에서 확인해 주세요.",
  [REQUEST_FAILED_CODE]: "응답이 늦어 결과를 확인하지 못했어요. 목록을 새로고침해 확인해 주세요",
};

/** A short Korean reason for a skip code: the local map first, then the backend problem catalog. */
export function describeSkipCode(code: string): string {
  if (Object.hasOwn(SKIP_REASON_LABEL, code)) return SKIP_REASON_LABEL[code];
  const catalog = PROBLEM_CATALOG as unknown as Record<string, { title?: Record<string, string> } | undefined>;
  const title = Object.hasOwn(catalog, code) ? catalog[code]?.title?.["ko-KR"] : undefined;
  return title ?? GENERIC_SKIP_REASON;
}
