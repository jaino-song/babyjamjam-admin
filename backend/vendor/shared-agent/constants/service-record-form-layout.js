"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_RECORD_LAYOUT_ANSWER_KEYS = exports.SERVICE_RECORD_FORM_LAYOUT = void 0;
exports.SERVICE_RECORD_FORM_LAYOUT = [
    {
        id: "mom",
        title: "산모 기록",
        tone: "mom",
        fields: [
            {
                key: "perineum",
                label: "① 회음절개부위 (또는 수술부위)",
                kind: "multi",
                options: ["열상", "혈종", "불편감", "이상없음"],
                normalValues: ["이상없음"],
            },
            {
                key: "breast",
                label: "② 유방상태",
                kind: "multi",
                options: ["울혈", "통증", "이상없음"],
                normalValues: ["이상없음"],
            },
            {
                key: "excretion",
                label: "③ 배뇨/배변",
                kind: "multi",
                options: ["불편감", "이상없음"],
                normalValues: ["이상없음"],
            },
            {
                key: "sitzBath",
                label: "④ 좌욕",
                kind: "radio",
                options: ["실시", "미실시"],
            },
            {
                key: "meals",
                label: "⑤ 식사/간식",
                kind: "counts",
                subKeys: [
                    { key: "meals_meal", label: "식사", unit: "회", min: 0, step: 1 },
                    { key: "meals_snack", label: "간식", unit: "회", min: 0, step: 1 },
                ],
            },
        ],
    },
    {
        id: "baby",
        title: "신생아 기록",
        tone: "baby",
        fields: [
            {
                key: "temperature",
                label: "⑥ 체온",
                kind: "counts",
                subKeys: [{ key: "temperature_temp", label: "체온", unit: "℃", min: 0, step: 0.1 }],
            },
            {
                key: "sleep",
                label: "⑦ 수면 양상",
                kind: "radio",
                options: ["잘 잠", "잘 못 잠"],
                normalValues: ["잘 잠"],
            },
            {
                key: "breastFeeding",
                label: "⑧ 모유수유",
                kind: "counts",
                subKeys: [{ key: "breastFeeding_count", label: "횟수", unit: "회", min: 0, step: 1 }],
            },
            {
                key: "formulaFeeding",
                label: "⑨ 분유수유",
                kind: "counts",
                subKeys: [
                    { key: "formulaFeeding_count", label: "횟수", unit: "회", min: 0, step: 1 },
                    { key: "formulaFeeding_ml", label: "회당", unit: "ml", min: 0, step: 1 },
                ],
            },
            {
                key: "stool",
                label: "⑩ 배변양상",
                kind: "radio",
                options: ["정상변", "이상변"],
                subKeys: [{ key: "stool_color", label: "색깔 등", unit: "" }],
                normalValues: ["정상변"],
            },
            {
                key: "bath",
                label: "⑪ 목욕·제대관리",
                kind: "radio",
                options: ["실시", "미실시"],
            },
        ],
    },
    {
        id: "finish",
        title: "서비스 기록",
        tone: "finish",
        fields: [
            { key: "etcService", label: "기타 서비스", kind: "text", source: "session" },
            { key: "notes", label: "특이사항", kind: "text", source: "session" },
            { key: "paymentConfirmed", label: "결제 확인", kind: "check", source: "session" },
            { key: "hasMomApproval", label: "산모 서명", kind: "check", source: "session" },
        ],
    },
];
exports.SERVICE_RECORD_LAYOUT_ANSWER_KEYS = new Set(exports.SERVICE_RECORD_FORM_LAYOUT.flatMap((section) => section.fields
    .filter((field) => field.source !== "session")
    .flatMap((field) => [field.key, ...(field.subKeys?.map((subKey) => subKey.key) ?? [])])));
