/**
 * Ids, accessible-name helpers and copy that the service-record screen must keep
 * identical to the shared wizard. The package exposes no headless equivalent, so
 * each entry is transcribed and cites its source line in
 * `ServiceRecordWizard.tsx` of the service-record-ui package (SRW) unless noted.
 * aria-describedby / aria-labelledby / focus targets / Playwright selectors depend
 * on these exact values.
 */
import type { DailyItem, DailyItemProblem } from "@babyjamjam/service-record-ui";

/** SRW:56-59 */
export const HEADER_FIELD_COMPONENT_SUFFIX = {
    momName: "mom-name", momBirth: "mom-birth", babyName: "baby-name",
    babyBirth: "baby-birth", deliveryType: "delivery-type",
} as const;

/** SRW:61 */
export const PHONE_INPUT_ID = "service-record-phone";
/** SRW:727, :738 */
export const PHONE_HELPER_ID = "service-record-phone-helper";
/** SRW:62 */
export const SERVICE_DATE_INPUT_ID = "service-record-date";
/** SRW:63 */
export const SERVICE_DATE_PLACEHOLDER = "2026-12-01";
/** SRW:916, :922 (the message slot of the service-date field) */
export const SERVICE_DATE_HELPER_ID = "service-record-date-helper";
/** Id of the service-date label (the shared wizard's label has none; the item label needs one). */
export const SERVICE_DATE_LABEL_ID = "service-record-date-label";
/** SRW:961 */
export const SERVICE_DATE_READONLY_HELPER_ID = "service-record-date-readonly-helper";
/** Label id of the read-only service-date row (new: the item label needs one). */
export const SERVICE_DATE_READONLY_LABEL_ID = "service-record-date-readonly-label";

/** SRW:756 */
export const headerInputId = (key: string): string => `service-record-header-${key}`;
/** SRW:757 */
export const headerSlotId = (key: string): string => `${headerInputId(key)}-error`;
/** SRW:763 */
export const headerLabelId = (key: string): string => `${headerSlotId(key)}-label`;

/** SRW:157 - a count input whose label is not already part of its item's label needs the item name. */
export const countAccessibleName = (itemLabel: string, countLabel: string): string => {
    const plainItemLabel = itemLabel.replace(/^[①-⑳]\s*/u, "").trim();
    return plainItemLabel.includes(countLabel) ? countLabel : `${plainItemLabel} ${countLabel}`;
};

/** SRW:162 */
export const dailyFieldSuffix = (key: string): string => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
/** SRW:163 */
export const countInputId = (dataComponent: string, countKey: string): string => `${dataComponent}_count-options_${countKey}-input-control`;
/** SRW:164 */
export const firstOptionIdOf = (dataComponent: string): string => `${dataComponent}-first-option`;
/** SRW:165 */
export const stoolColorInputId = (dataComponent: string): string => `${dataComponent}-stool-color`;
/** SRW:166 */
export const textareaInputId = (dataComponent: string, itemKey: string): string => `${dataComponent}-${itemKey === "etcService" ? "etc-service" : "notes"}`;

/** SRW:207 - slot id of an item's message; its label is `${slotId}-label` (SRW:208). */
export const dailyItemSlotId = (dataComponent: string): string => `${dataComponent}-helper`;
export const dailyItemLabelId = (dataComponent: string): string => `${dailyItemSlotId(dataComponent)}-label`;
/** SRW:259 */
export const stoolColorSlotId = (dataComponent: string): string => `${dataComponent}-stool-color-helper`;

/** SRW:581 - data-component of one daily item, from the root data-component. */
export const dailyFieldComponent = (root: string, item: Pick<DailyItem, "key">): string => (
    `${root}_body_day-field_${dailyFieldSuffix(item.key)}`
);

/** SRW:169-181 - DOM id of the control a headless problem descriptor points at, or null when the item is fine. */
export function getDailyItemProblemId(
    item: Pick<DailyItem, "key">,
    dataComponent: string,
    problem: DailyItemProblem | null,
): string | null {
    if (!problem) return null;
    switch (problem.kind) {
        case "textarea": return textareaInputId(dataComponent, item.key);
        case "count": return countInputId(dataComponent, problem.countKey);
        case "stoolColor": return stoolColorInputId(dataComponent);
        case "option": return firstOptionIdOf(dataComponent);
    }
}

/* ---- copy (SRW lines in the comment; none of it is exported by the package) ---- */

/** FIELD_COPY.serviceDateMismatch (field-messages.ts:15 of the service-record-ui package), used at SRW:962. */
export const SERVICE_DATE_MISMATCH_COPY = "오늘과 다른 날짜예요";
/** SRW:888 */
export const BACK_LABEL = "이전";
/** SRW:1034 ("다음" / "저장" while editing a submitted day) */
export const NEXT_LABEL = "다음";
export const SAVE_SECTION_LABEL = "저장";
/** SRW:1024 */
export const SUBMIT_LABEL = "확인";
/** SRW:913 */
export const SERVICE_DATE_LABEL = "제공일자";
/** SRW:960 */
export const SERVICE_DATE_READONLY_LABEL = "서비스 제공일자";
/** SRW:939 */
export const SCHEDULE_HELP_COPY = "제공일자를 바꾸려면 일정 변경을 요청해 주세요.";
/** SRW:949 */
export const SCHEDULE_CHANGE_LABEL = "서비스 일정 변경";
export const SCHEDULE_CHANGE_PENDING_LABEL = "일정 변경 요청 대기 중";
/** SRW:974 */
export const RESIGN_NOTICE_COPY = "이미 제출된 회차입니다.";
/** SRW:978 (non-admin branch) */
export const HANDOVER_BANNER_COPY = "최종 기록을 확인해 주세요.";
/** SRW:274, :277, :292 */
export const STOOL_ABNORMAL_OPTION = "이상변";
export const STOOL_COLOR_LABEL = "이상변의 색깔과 상태";
export const STOOL_COLOR_PLACEHOLDER = "예: 초록색, 묽은 변";
/** SRW:378 */
export const CONFIRM_OPTION_LABEL = "결제 확인 완료";
/** SRW:346 */
export const textareaPlaceholder = (itemKey: string): string => (
    itemKey === "etcService" ? "예: 신생아 옷 정리" : "예: 산모 요청으로 간식 시간을 변경함"
);
/** SRW:327 */
export const countPlaceholder = (count: { k: string; unit?: string }): string => (
    count.k === "temp" ? "36.5" : count.unit === "ml" ? "60" : "0"
);

/* ---- copy of the root, phone, service-info and overview screens ---- */

/** SRW:680 */
export const SCREEN_TITLE = "산모·신생아 건강관리 서비스 제공기록지";
/** SRW:702 */
export const LOADING_COPY = "불러오는 중…";
/** SRW:705 */
export const PLANNED_DATE_ERROR_COPY = "서버 일정 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.";
/** SRW:711-712 */
export const INVALID_TITLE = "링크를 사용할 수 없습니다";
export const INVALID_COPY = "만료되었거나 더 이상 유효하지 않은 링크입니다. 지점에 문의해 주세요.";
/** SRW:1044 */
export const DONE_TITLE = "제공기록지 제출이 완료되었습니다.";

/** SRW:718-719 */
export const PHONE_TITLE = "제공인력 본인 확인";
export const PHONE_HELP_COPY = "본인 휴대폰 번호를 입력하면 서비스 기간 동안 유효한 접근 권한이 발급됩니다.";
/** SRW:725 */
export const PHONE_LABEL = "휴대폰 번호";
/** Id of the phone label (the shared wizard's label has none; the item label needs one). */
export const PHONE_LABEL_ID = "service-record-phone-label";
/** SRW:737 */
export const PHONE_PLACEHOLDER = "010-1234-5678";
/** SRW:745 */
export const PHONE_SUBMIT_LABEL = "확인하기";
export const PHONE_SUBMIT_BUSY_LABEL = "확인 중…";

/** SRW:752-754 */
export const SERVICE_TITLE = "서비스 기본정보";
export const PROVIDER_EMPLOYEE_LABEL = "제공인력";
export const PROVIDER_ORG_LABEL = "제공기관";
export const EMPLOYEE_FALLBACK_NAME = "정보 없음";
/** SRW:763, :766 */
export const DELIVERY_TYPE_LABEL = "분만형태";
export const DELIVERY_TYPE_OPTIONS = ["자연분만", "제왕절개"] as const;
/** SRW:808 (non-admin branch) */
export const SERVICE_SAVE_BUSY_LABEL = "저장 중…";

/** SRW:815-816 (non-readonly branch) */
export const OVERVIEW_TITLE = "제공기록표";
export const OVERVIEW_HELP_COPY = "제출된 기록은 눌러서 수정할 수 있습니다.";
/** SRW:846 (non-admin, non-readonly branch) */
export const DAY_STATUS_DONE = "제출완료";
export const DAY_STATUS_OPEN = "입력 가능";
export const DAY_STATUS_WAITING = "대기";
/** SRW:865 */
export const START_RECORD_LABEL = "기록 시작";
export const NEXT_SESSION_LABEL = "다음 회차 입력";
