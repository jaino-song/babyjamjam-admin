export type ItemType = "multi" | "radio" | "counts" | "stool" | "textarea" | "confirm";

export interface DailyItem {
    key: string;
    label: string;
    type: ItemType;
    opts?: string[];
    counts?: { k: string; label: string; unit: string }[];
    maxLength?: number;
}

export const SERVICE_RECORD_TEXT_LIMITS = {
    etcService: 40,
    notes: 80,
} as const;

export const DAILY_ITEMS: DailyItem[] = [
    { key: "perineum", label: "① 회음절개부위 (또는 수술부위)", type: "multi", opts: ["이상없음", "열상", "혈종", "불편감"] },
    { key: "breast", label: "② 유방상태", type: "multi", opts: ["이상없음", "울혈", "통증"] },
    { key: "excretion", label: "③ 배뇨/배변", type: "multi", opts: ["이상없음", "불편감"] },
    { key: "sitzBath", label: "④ 좌욕", type: "radio", opts: ["실시", "미실시"] },
    { key: "meals", label: "⑤ 식사/간식", type: "counts", counts: [{ k: "meal", label: "식사", unit: "회" }, { k: "snack", label: "간식", unit: "회" }] },
    { key: "temperature", label: "⑥ 체온", type: "counts", counts: [{ k: "temp", label: "체온", unit: "℃" }] },
    { key: "sleep", label: "⑦ 수면 양상", type: "radio", opts: ["잘 잠", "잘 못 잠"] },
    { key: "breastFeeding", label: "⑧ 모유수유", type: "counts", counts: [{ k: "count", label: "횟수", unit: "회" }] },
    { key: "formulaFeeding", label: "⑨ 분유수유", type: "counts", counts: [{ k: "count", label: "횟수", unit: "회" }, { k: "ml", label: "회당", unit: "ml" }] },
    { key: "stool", label: "⑩ 배변양상", type: "stool", opts: ["정상변", "이상변"] },
    { key: "bath", label: "⑪ 목욕·제대관리", type: "radio", opts: ["실시", "미실시"] },
    {
        key: "etcService",
        label: "기타 서비스 (필요 시 기재)",
        type: "textarea",
        maxLength: SERVICE_RECORD_TEXT_LIMITS.etcService,
    },
    {
        key: "notes",
        label: "특이사항 (필요 시 기재)",
        type: "textarea",
        maxLength: SERVICE_RECORD_TEXT_LIMITS.notes,
    },
    { key: "paymentConfirmed", label: "결제 확인", type: "confirm" },
];

export interface DayPage {
    title: string;
    items: number[];
    confirmation?: boolean;
}

export const DAY_PAGES: DayPage[] = [
    { title: "산모 기록", items: [0, 1, 2, 3, 4] },
    { title: "신생아 기록", items: [5, 6, 7, 8, 9, 10] },
    { title: "서비스 기록", items: [11, 12, 13] },
    {
        title: "기록 내용 확인",
        items: [],
        confirmation: true,
    },
];

export const DEFAULT_DAILY_ANSWERS: Record<string, unknown> = {
    perineum: ["이상없음"],
    breast: ["이상없음"],
    excretion: ["이상없음"],
    sitzBath: "실시",
    sleep: "잘 잠",
    stool: "정상변",
    bath: "실시",
};

export const HEADER_FIELDS = [
    { k: "momName", label: "산모 성명", ph: "예) 홍길동" },
    { k: "momBirth", label: "산모 생년월일 (YYMMDD)", ph: "예) 900101" },
    { k: "babyName", label: "신생아 성명", ph: "예) 홍아기" },
    { k: "babyBirth", label: "신생아 출생일자 (YYMMDD)", ph: "예) 260615" },
    { k: "babyWeight", label: "신생아 몸무게 (kg)", ph: "예) 3.2" },
] as const;

export const REVIEW_EMPTY_LABEL = "입력 없음";

export const REVIEW_SECTIONS = [
    { id: "mom", title: "산모", tone: "mom", fields: DAILY_ITEMS.slice(0, 5) },
    { id: "baby", title: "신생아", tone: "baby", fields: DAILY_ITEMS.slice(5, 11) },
    { id: "finish", title: "서비스 기록", tone: "finish", fields: DAILY_ITEMS.slice(11, 14) },
] as const;

export const hasDisplayValue = (value: unknown): boolean => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some(hasDisplayValue);
    if (typeof value === "string") return value.trim().length > 0;
    return true;
};

export function formatReviewFieldValue(
    field: DailyItem,
    draft: Record<string, unknown>,
): { value: string; ok?: boolean } {
    if (field.type === "confirm") {
        return Boolean(draft[field.key]) ? { value: "✓ 확인 완료", ok: true } : { value: "" };
    }

    if (field.type === "multi") {
        const value = draft[field.key];
        const values = Array.isArray(value) ? value.filter(hasDisplayValue).map((item) => String(item).trim()) : [];
        return { value: values.join(", ") };
    }

    if (field.type === "radio" || field.type === "stool") {
        const value = hasDisplayValue(draft[field.key]) ? String(draft[field.key]).trim() : "";
        const colorValue = field.key === "stool" && hasDisplayValue(draft.stool_color)
            ? String(draft.stool_color).trim()
            : "";
        if (value && colorValue) return { value: `${value} (${colorValue})` };
        return { value };
    }

    if (field.type === "counts") {
        const parts = (field.counts ?? [])
            .map((count) => {
                const value = draft[`${field.key}_${count.k}`];
                if (!hasDisplayValue(value)) return null;
                const prefix = count.label === "횟수" || count.label === "체온" ? "" : `${count.label} `;
                return `${prefix}${String(value).trim()}${count.unit}`;
            })
            .filter((part): part is string => Boolean(part));
        return { value: parts.join(" · ") };
    }

    const value = draft[field.key];
    return { value: hasDisplayValue(value) ? String(value).trim() : "" };
}

export function isDailyItemComplete(item: DailyItem, draft: Record<string, unknown>): boolean {
    const value = draft[item.key];
    if (item.type === "textarea") return true;
    if (item.type === "multi") return Array.isArray(value) && value.length > 0;
    if (item.type === "radio") return hasDisplayValue(value);
    if (item.type === "counts") {
        return item.counts?.every((count) => hasDisplayValue(draft[`${item.key}_${count.k}`])) ?? false;
    }
    if (item.type === "stool") {
        return hasDisplayValue(value) && (value !== "이상변" || hasDisplayValue(draft[`${item.key}_color`]));
    }
    if (item.type === "confirm") return value === true;
    return false;
}

export function formatMonthDayKo(iso: string): string {
    const [, month = "", day = ""] = iso.match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
    return iso ? `${iso.slice(0, 4)}.${month}.${day}` : "";
}

export function formatShortDate(iso: string): string {
    return iso ? iso.slice(0, 10).replaceAll("-", ".") : "";
}
