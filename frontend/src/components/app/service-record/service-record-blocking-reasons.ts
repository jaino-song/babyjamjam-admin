/**
 * Admin-facing copy for the reasons that block editing service dates.
 *
 * The backend emits one reason per affected session, many of them with
 * developer-English messages. The admin page shows one calm Korean line per
 * code instead, followed by the affected 회차.
 */

export interface ScheduleBlockingReasonInput {
    code: string;
    message: string;
    sessionIndex?: number;
}

export interface ScheduleBlockingReasonLine {
    /** Stable key: the code, plus the message for unknown codes that keep their own Korean text. */
    key: string;
    code: string;
    /** The sentence without the 회차 suffix. */
    text: string;
    /** Affected 회차, ascending and unique; empty when no reason named one. */
    sessionIndices: number[];
    /** The sentence followed by the affected 회차, e.g. "… (1–15회차)". */
    label: string;
}

/** Shown when a code is unknown and its message is not already Korean. */
export const GENERIC_BLOCKING_REASON = "제공일을 계산할 수 없는 회차가 있어요.";

const BLOCKING_REASON_COPY: Readonly<Record<string, string>> = {
    // Planned-session projection (backend policy)
    MISSING_ASSIGNMENT_PROVENANCE: "담당 제공인력 배정 정보를 찾을 수 없어요.",
    ASSIGNMENT_PROVENANCE_MISMATCH: "저장된 배정 정보와 회차 기록이 서로 맞지 않아요.",
    AMBIGUOUS_ACTUAL_DAY: "실제 제공 기록이 여러 건이거나 불분명한 회차가 있어요.",
    ACTUAL_DAY_CONTRADICTION: "실제 제공일이 저장된 예정일과 달라요.",
    INVALID_ASSIGNMENT_RANGE: "배정 기간이 올바르지 않아요.",
    ASSIGNMENT_RANGE_OVERLAP: "배정 기간이 서로 겹쳐요.",
    INCOMPLETE_VECTOR: "예정 회차에 날짜 또는 배정 정보가 빠져 있어요.",
    INVALID_SESSION_COUNT: "서비스 제공 회차 수가 설정되지 않았어요.",
    SESSION_OUTSIDE_CONTRACT: "계약된 회차 범위를 벗어난 회차가 있어요.",
    AMBIGUOUS_LEGACY_PROVENANCE: "이전 기록의 원본이 여러 건이라 배정을 확정할 수 없어요.",
    MISSING_START_DATE: "서비스 시작일을 확인할 수 없는 회차가 있어요.",
    MISSING_PLANNED_DATE: "예정된 제공일이 없는 회차가 있어요.",
    LOCKED_SESSION_DATE_CHANGED: "작성이 끝났거나 제출된 회차는 제공일을 바꿀 수 없어요.",
    SCHEDULE_BEFORE_START: "서비스 시작일보다 이른 날짜가 있어요.",
    NON_SERVICE_DAY: "서비스일이 아닌 날짜가 있어요.",
    SCHEDULE_COUNT_MISMATCH: "제공일 개수가 회차 수와 맞지 않아요.",
    DATE_MOVE_REQUIRED: "회차의 제공일은 날짜 이동으로 바꿔 주세요.",
    UNSUPPORTED_HOLIDAY_YEAR: "공휴일 정보를 확인할 수 없는 연도가 있어요.",
    INVALID_SCHEDULE_VECTOR: GENERIC_BLOCKING_REASON,
    // Schedule validation (shared util)
    INVALID_DATE: "날짜가 올바르지 않은 회차가 있어요.",
    NON_BUSINESS_DATE: "영업일이 아닌 날짜로 잡힌 회차가 있어요.",
    INVALID_SESSION_INDEX: "회차 번호가 올바르지 않아요.",
    DUPLICATE_SESSION_INDEX: "같은 회차가 중복되어 있어요.",
    DUPLICATE_SERVICE_DATE: "제공일이 겹치는 회차가 있어요.",
    INVERTED_SERVICE_DATES: "이전 회차보다 앞선 날짜로 잡힌 회차가 있어요.",
    MISSING_PROVENANCE_VERSION: "배정 정보의 기준 버전을 확인할 수 없는 회차가 있어요.",
    // Overview service and frontend normalisation
    EDITOR_PROJECTION_UNAVAILABLE: "서비스 예정 회차 근거를 확인할 수 없어요.",
    SERVICE_RECORD_SOURCE_UNAVAILABLE: "서비스 제공기록 원본을 확인할 수 없어요.",
    INVALID_SCHEDULE_PROJECTION: "서비스 예정 회차 근거를 확인할 수 없어요.",
};

const HANGUL = /[ㄱ-ㆎ가-힣]/;

/** "1–3, 5회차": consecutive runs collapse into a range, everything else is comma separated. */
export function formatSessionIndices(indices: readonly number[]): string {
    const sorted = [...new Set(indices)].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < sorted.length;) {
        let end = i;
        while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
        parts.push(end > i ? `${sorted[i]}–${sorted[end]}` : `${sorted[i]}`);
        i = end + 1;
    }
    return parts.length ? `${parts.join(", ")}회차` : "";
}

function textFor(reason: ScheduleBlockingReasonInput): string {
    const known = BLOCKING_REASON_COPY[reason.code];
    if (known) return known;
    return HANGUL.test(reason.message) ? reason.message : GENERIC_BLOCKING_REASON;
}

/** One line per code (per distinct text for unknown codes), in first-seen order. */
export function describeScheduleBlockingReasons(
    reasons: readonly ScheduleBlockingReasonInput[],
): ScheduleBlockingReasonLine[] {
    const lines = new Map<string, ScheduleBlockingReasonLine>();
    for (const reason of reasons) {
        const text = textFor(reason);
        const key = reason.code in BLOCKING_REASON_COPY ? reason.code : `${reason.code}:${text}`;
        let line = lines.get(key);
        if (!line) {
            line = { key, code: reason.code, text, sessionIndices: [], label: text };
            lines.set(key, line);
        }
        if (reason.sessionIndex !== undefined && !line.sessionIndices.includes(reason.sessionIndex)) {
            line.sessionIndices.push(reason.sessionIndex);
        }
    }
    const result = [...lines.values()];
    for (const line of result) {
        line.sessionIndices.sort((a, b) => a - b);
        const range = formatSessionIndices(line.sessionIndices);
        line.label = range ? `${line.text.replace(/\.$/, "")} (${range})` : line.text;
    }
    return result;
}
