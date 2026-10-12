/**
 * Ids, accessible-name helpers and copy that the admin service-record screen blocks
 * must keep identical to the shared wizard. The package exposes no headless
 * equivalent, so each entry is transcribed and cites its source line in
 * `ServiceRecordWizard.tsx` of the service-record-ui package (SRW).
 * aria-describedby / aria-labelledby / focus targets / Playwright selectors depend
 * on these exact values.
 *
 * Only what the day-page and review blocks use is here. The phone, header,
 * service-date input, overview and root ids/copy belong to the steps that render them.
 */
import type { DailyItem, DailyItemProblem } from "@babyjamjam/service-record-ui";

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

/* ---- read-only service-date row (SRW:956-967) ---- */

/** SRW:961 */
export const SERVICE_DATE_READONLY_HELPER_ID = "service-record-date-readonly-helper";
/** Id of the read-only service-date row's label (the shared wizard's label has none; the item label needs one). */
export const SERVICE_DATE_READONLY_LABEL_ID = "service-record-date-readonly-label";

/* ---- copy (SRW lines in the comment; none of it is exported by the package) ---- */

/** FIELD_COPY.serviceDateMismatch (field-messages.ts of the service-record-ui package), used at SRW:962. */
export const SERVICE_DATE_MISMATCH_COPY = "오늘과 다른 날짜예요";
/** SRW:888 */
export const BACK_LABEL = "이전";
/** SRW:1034 (admin and read-only always show "다음") */
export const NEXT_LABEL = "다음";
/** SRW:960 */
export const SERVICE_DATE_READONLY_LABEL = "서비스 제공일자";
/** SRW:978 (admin branch; the public copy "최종 기록을 확인해 주세요." is never shown here) */
export const ADMIN_HANDOVER_BANNER_COPY = "관리자 수정 내용을 확인해 주세요.";
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
