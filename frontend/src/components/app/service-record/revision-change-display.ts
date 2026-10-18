import {
    SERVICE_RECORD_FORM_LAYOUT,
} from "@babyjamjam/shared/constants/service-record-form-layout";
import { HEADER_FIELDS } from "@babyjamjam/shared/utils/service-record-input";
import type { ServiceRecordRevisionChangeValue } from "@/features/service-records/types";

import {
    DELIVERY_TYPE_LABEL,
    PROVIDER_EMPLOYEE_LABEL,
    SERVICE_DATE_READONLY_LABEL,
} from "./screen/ids";

/** What an empty value (null, "", or an empty list) reads as. */
export const REVISION_EMPTY_VALUE = "—";

const KST_PARTS = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

/** `YYYY-MM-DD HH:mm` in Korea time; the input itself when it is not a date. */
export function formatRevisionTimestamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const parts: Record<string, string> = {};
    for (const part of KST_PARTS.formatToParts(date)) parts[part.type] = part.value;
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

const FIELD_LABELS = new Map<string, string>();
const SUB_KEY_LABELS = new Map<string, string>();
for (const section of SERVICE_RECORD_FORM_LAYOUT) {
    for (const field of section.fields) {
        FIELD_LABELS.set(field.key, field.label);
        for (const subKey of field.subKeys ?? []) {
            SUB_KEY_LABELS.set(subKey.key, `${field.label} ${subKey.label}`);
        }
    }
}
const HEADER_LABELS = new Map<string, string>([
    ...HEADER_FIELDS.map((field) => [field.k, field.label] as const),
    ["deliveryType", DELIVERY_TYPE_LABEL],
]);

const FIXED_LABELS: Record<string, string> = {
    "period.startDate": "서비스 시작일",
    "period.endDate": "서비스 종료일",
    "session.serviceDate": SERVICE_DATE_READONLY_LABEL,
    "session.etcService": FIELD_LABELS.get("etcService") ?? "기타 서비스",
    "session.notes": FIELD_LABELS.get("notes") ?? "특이사항",
    "session.paymentConfirmed": FIELD_LABELS.get("paymentConfirmed") ?? "결제 확인",
    "session.employee": PROVIDER_EMPLOYEE_LABEL,
    "session.clientSignature": FIELD_LABELS.get("hasMomApproval") ?? "산모 서명",
};

/** The question / field name a change path is shown under; unknown keys show the key itself. */
export function revisionChangeLabel(path: string): string {
    const fixed = FIXED_LABELS[path];
    if (fixed) return fixed;
    if (path.startsWith("header.")) {
        const key = path.slice("header.".length);
        return HEADER_LABELS.get(key) ?? key;
    }
    if (path.startsWith("session.answers.")) {
        const key = path.slice("session.answers.".length);
        return FIELD_LABELS.get(key) ?? SUB_KEY_LABELS.get(key) ?? key;
    }
    return path;
}

const SIGNATURE_LABELS: Record<string, string> = {
    absent: "없음",
    present: "있음",
    replaced: "다시 서명됨",
};

export function formatRevisionChangeValue(path: string, value: ServiceRecordRevisionChangeValue): string {
    if (value === null) return REVISION_EMPTY_VALUE;
    if (Array.isArray(value)) return value.length ? value.join(", ") : REVISION_EMPTY_VALUE;
    if (typeof value === "boolean") return value ? "예" : "아니오";
    if (typeof value === "number") return String(value);
    if (value === "") return REVISION_EMPTY_VALUE;
    if (path === "session.clientSignature") return SIGNATURE_LABELS[value] ?? value;
    return value;
}
