import { BadRequestException } from "@nestjs/common";

import { problemBody } from "application/utils/problem-bodies";

type IntegerOptions = {
    defaultValue?: number;
    min?: number;
    max?: number;
};

function rejectIntegerFormat(name: string): never {
    // Registered VALIDATION_FAILED problem (400): the HTTP mapper keys on the
    // body code, and `detail` is replaced by the locale catalog copy at the
    // boundary — it also feeds the in-process `message` compat alias.
    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
        pointer: `/${name}`,
        code: "INVALID_FORMAT",
        detail: `${name} 값이 올바르지 않아요.`,
    }));
}

function rejectIntegerRange(name: string, bound: number, side: "min" | "max"): never {
    // 모음으로 끝나는 "이하"는 "-여야", "이상"은 "-이어야" 활용을 쓴다.
    const suffix = side === "min" ? "이상이어야 해요." : "이하여야 해요.";
    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
        pointer: `/${name}`,
        code: "OUT_OF_RANGE",
        detail: `${name} 값은 ${bound} ${suffix}`,
    }));
}

export function parseInteger(value: string | undefined, name: string, options: IntegerOptions = {}): number {
    const { defaultValue, min, max } = options;

    if (value === undefined || value === "") {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        rejectIntegerFormat(name);
    }

    if (!/^-?\d+$/.test(value)) {
        rejectIntegerFormat(name);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        rejectIntegerFormat(name);
    }

    if (min !== undefined && parsed < min) {
        rejectIntegerRange(name, min, "min");
    }

    if (max !== undefined && parsed > max) {
        rejectIntegerRange(name, max, "max");
    }

    return parsed;
}

export function parseOptionalInteger(
    value: string | undefined,
    name: string,
    options: Omit<IntegerOptions, "defaultValue"> = {},
): number | undefined {
    if (value === undefined || value === "") {
        return undefined;
    }

    return parseInteger(value, name, options);
}
