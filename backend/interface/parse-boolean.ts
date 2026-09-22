import { BadRequestException } from "@nestjs/common";

import { problemBody } from "application/utils/problem-bodies";

export function parseBooleanQuery(
    value: string | undefined,
    name: string,
    defaultValue: boolean,
): boolean {
    if (value === undefined || value === "") {
        return defaultValue;
    }
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }

    // Registered VALIDATION_FAILED problem (400): the HTTP mapper keys on the
    // body code, and `detail` is replaced by the locale catalog copy at the
    // boundary — it also feeds the in-process `message` compat alias.
    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
        pointer: `/${name}`,
        code: "INVALID_FORMAT",
        detail: "true 또는 false여야 해요.",
    }));
}
