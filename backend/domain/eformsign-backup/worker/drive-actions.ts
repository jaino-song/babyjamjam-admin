import { nextRetryAt } from "./export-actions";
import type { WorkerReasonCode } from "./worker-error";

/**
 * What a failed Drive call tells the worker, and nothing else: no body, URL or header (BJJ-456 contract). The Drive
 * client builds structurally identical objects. `token-rejected` is the OAuth token endpoint refusing the refresh token
 * (`invalid_grant`, `invalid_client`, `unauthorized_client`), which a Drive API status cannot express.
 */
export interface DriveFailureFacts {
    kind: "network" | "timeout" | "http" | "token-rejected";
    httpStatus: number | null;
    /** Google `error.errors[0].reason` (`/^[A-Za-z]{1,64}$/`), or the OAuth `error` string for `token-rejected`; else null. */
    reason: string | null;
    retryAfterSeconds: number | null;
}

export type DriveFailureAction =
    | { kind: "retry_wait"; reasonCode: WorkerReasonCode; nextRetryAt: string }
    | { kind: "blocked"; reasonCode: WorkerReasonCode }
    /** 404: the caller decides whether the object is missing or the id is wrong. */
    | { kind: "absent" }
    /** 409: the id is taken; the caller looks it up and compares. */
    | { kind: "compare" };

const REASON_PATTERN = /^[A-Za-z]{1,64}$/;
const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set(["userRateLimitExceeded", "rateLimitExceeded", "sharingRateLimitExceeded"]);

/**
 * Contract table. `attempts` is the number of this attempt (1 for the first failure) and drives the shared export backoff
 * `min(60 * 2^(attempts-1), 21600)` seconds, with `retryAfterSeconds` as a lower bound.
 */
export function classifyDriveFailure(facts: DriveFailureFacts, attempts: number, now: Date | string): DriveFailureAction {
    const wait = (reasonCode: WorkerReasonCode): DriveFailureAction => ({
        kind: "retry_wait", reasonCode, nextRetryAt: nextRetryAt(now, attempts, facts.retryAfterSeconds),
    });
    if (facts.kind === "token-rejected") return { kind: "blocked", reasonCode: "drive-token-invalid" };
    if (facts.kind === "network" || facts.kind === "timeout") return wait("network-timeout");

    const status = facts.httpStatus;
    const reason = facts.reason !== null && REASON_PATTERN.test(facts.reason) ? facts.reason : null;
    if (status === null || !Number.isInteger(status) || status < 400 || status > 599) return wait("drive-unavailable");
    if (status >= 500) return wait("drive-unavailable");
    if (status === 429) return wait("rate-limited");
    if (status === 403) {
        if (reason !== null && RATE_LIMIT_REASONS.has(reason)) return wait("rate-limited");
        if (reason === "storageQuotaExceeded") return { kind: "blocked", reasonCode: "drive-quota" };
        return { kind: "blocked", reasonCode: "drive-permission" };
    }
    if (status === 401) return { kind: "blocked", reasonCode: "drive-permission" };
    if (status === 404) return { kind: "absent" };
    if (status === 409) return { kind: "compare" };
    return { kind: "blocked", reasonCode: "drive-conflict" };
}
