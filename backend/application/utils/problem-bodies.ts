import { PROBLEM_CATALOG } from "@babyjamjam/shared/errors/problem-details";

import type { ProblemCode, ProblemDetails, ProblemError } from "@babyjamjam/shared/errors/problem-details";

/**
 * Shape an employee rejection as a public problem contract body.
 * The HTTP boundary replaces the texts with locale catalog copies, so the
 * codes and pointers here only have to identify the cause.
 *
 * `message` is an in-process compatibility alias for callers that read
 * `HttpException.message` (Nest derives it from a string `message` member);
 * the HTTP mapper copies only contract members, so it never reaches clients.
 */
export function problemBody(
    code: ProblemCode,
    error: ProblemError,
): Pick<ProblemDetails, "code" | "params" | "outcome" | "recovery" | "errors"> & { message: string } {
    return {
        code,
        params: {},
        outcome: "NOT_APPLIED",
        recovery: { action: "NONE", retry: { mode: "NEVER" } },
        errors: [error],
        message: error.detail,
    };
}

/**
 * Shape an employee rejection that carries only its public code — no field
 * errors (resource-not-found, active-assignment conflict). Same contract
 * members as `problemBody` minus `errors`; `message` stays the in-process
 * compatibility alias and never reaches clients through the HTTP boundary.
 */
export function codeOnlyProblemBody(
    code: ProblemCode,
): Pick<ProblemDetails, "code" | "params" | "outcome" | "recovery"> & { message: string } {
    return {
        code,
        params: {},
        outcome: "NOT_APPLIED",
        recovery: { action: "NONE", retry: { mode: "NEVER" } },
        message: PROBLEM_CATALOG[code].detail["ko-KR"],
    };
}
