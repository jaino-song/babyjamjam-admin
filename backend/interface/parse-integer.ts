import { BadRequestException } from "@nestjs/common";

type IntegerOptions = {
    defaultValue?: number;
    min?: number;
    max?: number;
};

function rejectInteger(name: string): never {
    throw new BadRequestException(`${name} must be an integer`);
}

export function parseInteger(value: string | undefined, name: string, options: IntegerOptions = {}): number {
    const { defaultValue, min, max } = options;

    if (value === undefined || value === "") {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        rejectInteger(name);
    }

    if (!/^-?\d+$/.test(value)) {
        rejectInteger(name);
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        rejectInteger(name);
    }

    if (min !== undefined && parsed < min) {
        throw new BadRequestException(`${name} must be at least ${min}`);
    }

    if (max !== undefined && parsed > max) {
        throw new BadRequestException(`${name} must be at most ${max}`);
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
