import { WorkerError } from "./worker-error";

/** Destination states of contract §5 (design §12.3). `recovery_required` is a ledger status, not a destination state. */
export const DESTINATION_STATES = [
    "not_configured",
    "pending",
    "transferring",
    "verifying",
    "verified",
    "retry_wait",
    "blocked",
    "integrity_error",
] as const;
export type DestinationState = typeof DESTINATION_STATES[number];

export interface TransitionContext {
    /** Set when the ledger is in `recovery_required`: no step that creates, downloads or publishes is allowed. */
    recoveryRequired?: boolean;
    /** With `nextRetryAt`: `retry_wait -> pending` only once `nextRetryAt <= now` (ISO strings). Replay omits both. */
    now?: string;
    nextRetryAt?: string | null;
    /** Cumulative `integrity_error` count of this key; 3 or more may not go back to `pending`. */
    integrityErrorCount?: number;
    /** Both set and different: a verified result is never carried across destination revisions. */
    fromDestinationRevision?: string;
    destinationRevision?: string;
}

/** Cumulative integrity failures after which a key stops retrying and becomes `blocked integrity-repeated`. */
export const INTEGRITY_RETRY_LIMIT = 3;

type Origin = DestinationState | "none";

/** Contract §5 table, one row per allowed edge. Every other pair is forbidden. */
const ALLOWED: Readonly<Record<Origin, readonly DestinationState[]>> = {
    none: ["not_configured", "pending", "blocked"],
    not_configured: ["pending", "blocked"],
    pending: ["transferring", "blocked"],
    transferring: ["verifying", "retry_wait", "blocked"],
    verifying: ["verified", "integrity_error", "retry_wait", "blocked"],
    verified: ["integrity_error"],
    retry_wait: ["pending", "blocked"],
    blocked: ["pending", "blocked"],
    integrity_error: ["pending", "blocked"],
};

/** Steps that start or continue creating, downloading or publishing bytes. */
const CREATE_STEPS: ReadonlySet<DestinationState> = new Set(["pending", "transferring", "verifying", "verified"]);

function forbidden(): never {
    throw new WorkerError("forbidden-transition");
}

/** Returns `to` when `from -> to` is allowed; throws `WorkerError("forbidden-transition")` otherwise. */
export function transitionDestination(
    from: DestinationState | null, to: DestinationState, ctx: TransitionContext = {},
): DestinationState {
    if (ctx.recoveryRequired && CREATE_STEPS.has(to)) forbidden();
    if (ctx.fromDestinationRevision !== undefined && ctx.destinationRevision !== undefined
        && ctx.fromDestinationRevision !== ctx.destinationRevision) forbidden();
    if (!(ALLOWED[from ?? "none"] ?? []).includes(to)) forbidden();
    if (from === "retry_wait" && to === "pending" && ctx.now !== undefined) {
        const due = ctx.nextRetryAt == null ? NaN : Date.parse(ctx.nextRetryAt);
        const now = Date.parse(ctx.now);
        if (Number.isNaN(due) || Number.isNaN(now) || due > now) forbidden();
    }
    if (from === "integrity_error" && to === "pending"
        && ctx.integrityErrorCount !== undefined && ctx.integrityErrorCount >= INTEGRITY_RETRY_LIMIT) forbidden();
    return to;
}

/** A `verified` result only satisfies the destination revision it was produced for. */
export function assertVerifiedReusable(verifiedRevision: string, currentRevision: string): void {
    if (verifiedRevision !== currentRevision) forbidden();
}

/** What to do after an `integrity_error`: retry automatically below the limit, otherwise block (contract §5 last row). */
export function integrityRetryDecision(
    integrityErrorCount: number,
): { to: "pending"; reasonCode: null } | { to: "blocked"; reasonCode: "integrity-repeated" } {
    return integrityErrorCount < INTEGRITY_RETRY_LIMIT
        ? { to: "pending", reasonCode: null }
        : { to: "blocked", reasonCode: "integrity-repeated" };
}

export function destinationKey(
    artifactIdentity: string, destinationIdentity: string, destinationRevision: string,
): string {
    return `${artifactIdentity}|${destinationIdentity}|${destinationRevision}`;
}
