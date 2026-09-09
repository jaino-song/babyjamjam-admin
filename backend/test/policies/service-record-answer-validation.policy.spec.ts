import { BadRequestException } from "@nestjs/common";

import { SERVICE_RECORD_FORM_LAYOUT } from "@babyjamjam/shared/constants/service-record-form-layout";
import {
    SERVICE_RECORD_LAYOUT_ANSWER_KEYS,
    validateServiceRecordAnswers,
    validateServiceRecordEditText,
} from "application/policies/service-record-answer-validation.policy";

function canonicalPersistedLeafKeys(): string[] {
    return SERVICE_RECORD_FORM_LAYOUT.flatMap((section) => section.fields)
        .filter((field) => field.source !== "session")
        .flatMap((field) => field.kind === "counts"
            ? (field.subKeys ?? []).map((subKey) => subKey.key)
            : [field.key, ...(field.subKeys ?? []).map((subKey) => subKey.key)]);
}

function allAnswers(): Record<string, unknown> {
    return {
        perineum: ["이상없음"],
        breast: ["울혈"],
        excretion: ["불편감"],
        sitzBath: "실시",
        meals_meal: 3,
        meals_snack: 2,
        temperature_temp: 36.7,
        sleep: "잘 잠",
        breastFeeding_count: 5,
        formulaFeeding_count: 1,
        formulaFeeding_ml: 80,
        stool: "이상변",
        stool_color: "연한 갈색",
        bath: "미실시",
    };
}

describe("service-record answer validation policy", () => {
    it("accepts exactly the 14 canonical answer and sub-answer keys", () => {
        const result = validateServiceRecordAnswers(allAnswers());

        expect(canonicalPersistedLeafKeys()).toHaveLength(14);
        expect(Object.keys(result).sort()).toEqual(canonicalPersistedLeafKeys().sort());
        expect([...SERVICE_RECORD_LAYOUT_ANSWER_KEYS].sort()).toEqual(canonicalPersistedLeafKeys().sort());
        expect(result).toEqual(allAnswers());
    });

    it("preserves valid UI numeric strings and empty partial clears", () => {
        const answers = {
            ...allAnswers(),
            meals_meal: "3",
            meals_snack: "",
            temperature_temp: "36.7",
            breastFeeding_count: "5",
            formulaFeeding_count: "1",
            formulaFeeding_ml: "80",
        };

        expect(validateServiceRecordAnswers(answers)).toEqual(answers);
    });

    it("accepts the canonical flat submission fixture", () => {
        const answers = { sitzBath: "실시", sleep: "잘 잠", stool: "정상변" };

        expect(validateServiceRecordAnswers(answers)).toEqual(answers);
    });

    it.each([
        ["meals_meal", -1],
        ["meals_meal", "-1"],
        ["meals_meal", 1.5],
        ["meals_meal", "1.5"],
        ["meals_meal", "NaN"],
        ["meals_meal", "Infinity"],
        ["meals_meal", "0x10"],
        ["meals_meal", Number.MAX_SAFE_INTEGER + 1],
        ["temperature_temp", -0.1],
        ["temperature_temp", "-0.1"],
        ["temperature_temp", 36.75],
        ["temperature_temp", "36.75"],
        ["temperature_temp", Number.POSITIVE_INFINITY],
        ["temperature_temp", "not-a-number"],
    ])("rejects invalid numeric value %s=%s", (key, value) => {
        expect(() => validateServiceRecordAnswers({ [key]: value })).toThrow(BadRequestException);
    });

    it("uses descriptor options for every multi/radio answer", () => {
        for (const field of SERVICE_RECORD_FORM_LAYOUT.flatMap((section) => section.fields)) {
            if (field.source === "session" || !field.options?.length) continue;
            const option = field.options.at(0);
            if (!option) continue;
            if (field.kind === "multi") {
                expect(validateServiceRecordAnswers({ [field.key]: [option] })[field.key]).toEqual([option]);
            } else if (field.kind === "radio") {
                expect(validateServiceRecordAnswers({ [field.key]: option })[field.key]).toBe(option);
            }
        }
    });

    it("rejects unknown authority or lifecycle keys instead of filtering them", () => {
        expect(() => validateServiceRecordAnswers({ ...allAnswers(), branchId: "attacker" }))
            .toThrow(BadRequestException);
        expect(() => validateServiceRecordAnswers({ ...allAnswers(), clientSignature: "forged" }))
            .toThrow(BadRequestException);
        expect(() => validateServiceRecordAnswers({ ...allAnswers(), submittedAt: "2026-09-08T00:00:00Z" }))
            .toThrow(BadRequestException);
    });

    it("rejects invalid options, duplicate multi-options, and oversized payloads", () => {
        expect(() => validateServiceRecordAnswers({ sitzBath: "unknown" })).toThrow(BadRequestException);
        expect(() => validateServiceRecordAnswers({ perineum: ["열상", "열상"] })).toThrow(BadRequestException);
        expect(() => validateServiceRecordAnswers({ notes: "not an answer" })).toThrow(BadRequestException);
        expect(() => validateServiceRecordAnswers({ stool_color: "x".repeat(81) })).toThrow(BadRequestException);
    });

    it("returns a clone so callers cannot mutate the validated input", () => {
        const input = { perineum: ["이상없음"] };
        const result = validateServiceRecordAnswers(input);

        expect(result).not.toBe(input);
        expect(result["perineum"]).not.toBe(input["perineum"]);
    });

    it("enforces the existing text limits for adjacent draft fields", () => {
        expect(validateServiceRecordEditText("  안내  ", "etcService")).toBe("안내");
        expect(() => validateServiceRecordEditText("x".repeat(41), "etcService"))
            .toThrow(BadRequestException);
        expect(() => validateServiceRecordEditText("x".repeat(81), "notes"))
            .toThrow(BadRequestException);
    });
});
