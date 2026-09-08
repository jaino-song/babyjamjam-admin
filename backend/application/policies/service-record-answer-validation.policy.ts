import { BadRequestException } from "@nestjs/common";

import {
    SERVICE_RECORD_FORM_LAYOUT,
    type ServiceRecordFieldDescriptor,
} from "@babyjamjam/shared/constants/service-record-form-layout";
import { SERVICE_RECORD_TEXT_LIMITS } from "domain/constants/service-record-text-limits";

const MAX_ANSWERS_BYTES = 16 * 1024;
const MAX_ANSWER_STRING_LENGTH = 500;
const MAX_MULTI_VALUE_COUNT = 8;
const MAX_MULTI_VALUE_LENGTH = 80;

type AnswerDefinition = {
    key: string;
    kind: ServiceRecordFieldDescriptor["kind"] | "countSubKey" | "radioSubKey";
    options: readonly string[];
    numeric?: {
        min: number;
        step: number;
    };
};

function deriveAnswerDefinitions(): Map<string, AnswerDefinition> {
    const definitions = new Map<string, AnswerDefinition>();
    for (const section of SERVICE_RECORD_FORM_LAYOUT) {
        for (const field of section.fields) {
            if (field.source === "session") continue;

            if (field.kind === "counts") {
                for (const subKey of field.subKeys ?? []) {
                    definitions.set(subKey.key, {
                        key: subKey.key,
                        kind: "countSubKey",
                        options: [],
                        numeric: { min: subKey.min ?? 0, step: subKey.step ?? 1 },
                    });
                }
                continue;
            }

            definitions.set(field.key, {
                key: field.key,
                kind: field.kind,
                options: field.options ?? [],
            });
            for (const subKey of field.subKeys ?? []) {
                definitions.set(subKey.key, {
                    key: subKey.key,
                    kind: "radioSubKey",
                    options: [],
                });
            }
        }
    }
    return definitions;
}

const ANSWER_DEFINITIONS = deriveAnswerDefinitions();

/**
 * Persisted answer leaves are derived from the shared, backend-safe form
 * descriptor. Count group containers stay presentation-only; radio/multi
 * fields retain their own key and any explicitly declared subkeys.
 */
export const SERVICE_RECORD_LAYOUT_ANSWER_KEYS = new Set(ANSWER_DEFINITIONS.keys());

export class ServiceRecordAnswerValidationError extends Error {
    readonly code = "SERVICE_RECORD_ANSWER_INVALID";

    constructor(message: string) {
        super(message);
        this.name = "ServiceRecordAnswerValidationError";
    }
}

function fail(message: string): never {
    throw new ServiceRecordAnswerValidationError(message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, key: string, maxLength = MAX_ANSWER_STRING_LENGTH): string {
    if (typeof value !== "string" || value.length > maxLength) {
        fail(`Invalid service-record field: ${key}`);
    }
    return value;
}

function isNumericString(value: string): boolean {
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
}

function isStepAligned(value: number, step: number): boolean {
    if (Number.isInteger(value)) return true;
    const quotient = value / step;
    const nearest = Math.round(quotient);
    const tolerance = Number.EPSILON * Math.abs(quotient) * 10;
    return Math.abs(quotient - nearest) <= tolerance;
}

function assertNumeric(value: unknown, key: string, numeric: { min: number; step: number }): string | number {
    if (typeof value === "string") {
        if (value.length > MAX_ANSWER_STRING_LENGTH) fail(`Invalid service-record field: ${key}`);
        if (value === "") return value;
        if (!isNumericString(value)) fail(`Invalid service-record field: ${key}`);
    }

    const parsed = typeof value === "number"
        ? value
        : typeof value === "string"
            ? Number(value)
            : Number.NaN;
    if (!Number.isFinite(parsed) || parsed < numeric.min || !isStepAligned(parsed - numeric.min, numeric.step)) {
        fail(`Invalid service-record field: ${key}`);
    }
    if (numeric.step === 1 && !Number.isSafeInteger(parsed)) {
        fail(`Invalid service-record field: ${key}`);
    }
    if (typeof value === "number" || typeof value === "string") return value;
    return fail(`Invalid service-record field: ${key}`);
}

function assertScalar(value: unknown, key: string): string | number {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) fail(`Invalid service-record field: ${key}`);
        return value;
    }
    return assertString(value, key);
}

function assertAllowedOption(value: unknown, key: string, options: readonly string[]): string {
    const normalized = assertString(value, key);
    if (!options.includes(normalized)) {
        fail(`Invalid service-record field: ${key}`);
    }
    return normalized;
}

function validateAnswerValue(key: string, value: unknown): unknown {
    const definition = ANSWER_DEFINITIONS.get(key);
    if (!definition) fail(`Invalid service-record field: ${key}`);

    if (definition.kind === "multi") {
        if (!Array.isArray(value) || value.length > MAX_MULTI_VALUE_COUNT) {
            fail(`Invalid service-record field: ${key}`);
        }
        const values = value.map((item) => assertAllowedOption(item, key, definition.options));
        if (new Set(values).size !== values.length) {
            fail(`Invalid service-record field: ${key}`);
        }
        return values;
    }

    if (definition.kind === "radio") return assertAllowedOption(value, key, definition.options);

    if (definition.kind === "radioSubKey") return assertString(value, key, MAX_MULTI_VALUE_LENGTH);

    if (definition.kind === "countSubKey") {
        return assertNumeric(value, key, definition.numeric ?? { min: 0, step: 1 });
    }

    if (definition.kind === "check") {
        if (typeof value !== "boolean") fail(`Invalid service-record field: ${key}`);
        return value;
    }

    if (definition.kind === "text") return assertString(value, key);
    return assertScalar(value, key);
}

/**
 * Validate and clone the structured daily answers accepted by both public
 * provider submission and administrator draft saves.
 */
export function validateServiceRecordAnswers(raw: unknown): Record<string, unknown> {
    if (!isPlainRecord(raw)) {
        throw new BadRequestException({ code: "SERVICE_RECORD_ANSWER_INVALID" });
    }

    let serialized: string;
    try {
        serialized = JSON.stringify(raw);
    } catch {
        throw new BadRequestException({ code: "SERVICE_RECORD_ANSWER_INVALID" });
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_ANSWERS_BYTES) {
        throw new BadRequestException("제공기록 입력값이 너무 큽니다.");
    }

    const answers: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!SERVICE_RECORD_LAYOUT_ANSWER_KEYS.has(key)) {
            throw new BadRequestException(`Unknown service-record field: ${key}`);
        }
        if (Array.isArray(value) && value.some((item) => typeof item !== "string" || item.length > MAX_MULTI_VALUE_LENGTH)) {
            throw new BadRequestException(`Invalid service-record field: ${key}`);
        }
        try {
            answers[key] = validateAnswerValue(key, value);
        } catch (error) {
            if (error instanceof ServiceRecordAnswerValidationError) {
                throw new BadRequestException(error.message);
            }
            throw error;
        }
    }
    return answers;
}

/** Validate the editable free-form fields that live beside structured answers. */
export function validateServiceRecordEditText(
    value: unknown,
    key: "etcService" | "notes",
): string {
    const maxLength = SERVICE_RECORD_TEXT_LIMITS[key];
    if (typeof value !== "string" || value.length > maxLength) {
        throw new BadRequestException(`입력값은 ${maxLength}자를 넘을 수 없습니다.`);
    }
    return value.trim();
}
