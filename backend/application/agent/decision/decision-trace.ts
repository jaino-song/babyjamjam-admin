import {
    DECISION_KINDS,
    DECISION_MODES,
    DECISION_STATUSES,
    type DecisionTraceEventV1,
} from "./decision-contracts";

/**
 * Request-local, bounded decision-observation bookkeeping.
 *
 * This module is pure in-memory telemetry plumbing: no Prisma, no queue, no
 * timers, and no module-level mutable state. Every collector is independent
 * per request; nothing here may change runtime behavior or the legacy trace
 * shape. It only carries validated `DecisionTraceEventV1` evidence produced by
 * `toDecisionTraceEvent` into the existing agent trace metadata.
 */

export const MAX_DECISION_TRACE_EVENTS = 4;

/**
 * Machine-token discipline: labels, model ids and version strings are
 * constrained tokens, never raw text.
 */
export const DECISION_TRACE_TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** `droppedReason` is a lowercase machine reason token, never raw text. */
export const DECISION_TRACE_REASON_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

const DECISION_KIND_VALUES: readonly string[] = Object.values(DECISION_KINDS);
const DECISION_MODE_VALUES: readonly string[] = Object.values(DECISION_MODES);
const DECISION_STATUS_VALUES: readonly string[] = Object.values(DECISION_STATUSES);

export interface DecisionTraceCollectorDrain {
    readonly events: readonly DecisionTraceEventV1[];
    readonly droppedCount: number;
    /** true on the first drain, false afterwards. */
    readonly drained: boolean;
}

export interface DecisionTraceCollector {
    /** Validate + bound. Returns false when the event was rejected or the collector is full/drained. */
    record(event: DecisionTraceEventV1): boolean;
    /** Exactly-once drain: marks the collector drained and returns the validated events. */
    drain(): DecisionTraceCollectorDrain;
}

function isTokenOrNull(value: unknown): value is string | null {
    return value === null || (typeof value === "string" && DECISION_TRACE_TOKEN_PATTERN.test(value));
}

function isReasonTokenOrNull(value: unknown): value is string | null {
    return value === null || (typeof value === "string" && DECISION_TRACE_REASON_PATTERN.test(value));
}

function isUsageOrNull(usage: unknown): boolean {
    if (usage === null) return true;
    if (typeof usage !== "object" || usage === null || Array.isArray(usage)) return false;
    const candidate = usage as { inputTokens?: unknown; outputTokens?: unknown };
    return isFiniteNonNegativeNumber(candidate.inputTokens)
        && isFiniteNonNegativeNumber(candidate.outputTokens);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Strict serializer: returns null (never throws) when any field is invalid or
 * non-finite. Rejects raw text in place of machine tokens and never silently
 * coerces a field. `reason` (not enumerated in the trace-event field list) is
 * still held to the reason-token discipline: every `DecisionFailureReason`
 * value matches it, so no sanctioned `toDecisionTraceEvent` output is rejected.
 */
export function serializeDecisionTraceEvent(event: DecisionTraceEventV1): DecisionTraceEventV1 | null {
    if (typeof event !== "object" || event === null || Array.isArray(event)) return null;
    if (event.kind !== "semantic-decision-v1") return null;
    if (typeof event.decisionKind !== "string" || !DECISION_KIND_VALUES.includes(event.decisionKind)) return null;
    if (typeof event.mode !== "string" || !DECISION_MODE_VALUES.includes(event.mode)) return null;
    if (typeof event.outcome !== "string" || !DECISION_STATUS_VALUES.includes(event.outcome)) return null;
    if (!Array.isArray(event.labels) || !Array.isArray(event.scores)) return null;
    if (event.labels.length !== event.scores.length) return null;
    for (const label of event.labels) {
        if (typeof label !== "string" || !DECISION_TRACE_TOKEN_PATTERN.test(label)) return null;
    }
    for (const score of event.scores) {
        if (typeof score !== "number" || !Number.isFinite(score)) return null;
    }
    if (!isFiniteNonNegativeNumber(event.latencyMs)) return null;
    if (!isTokenOrNull(event.model)) return null;
    if (!isTokenOrNull(event.profileVersion)) return null;
    if (!isTokenOrNull(event.questionVersion)) return null;
    if (!isUsageOrNull(event.usage)) return null;
    if (event.disagreement !== null && typeof event.disagreement !== "boolean") return null;
    if (typeof event.missing !== "boolean") return null;
    if (!isReasonTokenOrNull(event.reason)) return null;
    if (!isReasonTokenOrNull(event.droppedReason)) return null;
    return event;
}

export function createDecisionTraceCollector(options?: { maxEvents?: number }): DecisionTraceCollector {
    const requested = options?.maxEvents;
    const maxEvents = typeof requested === "number" && Number.isFinite(requested) && requested >= 0
        ? Math.floor(requested)
        : MAX_DECISION_TRACE_EVENTS;
    const events: DecisionTraceEventV1[] = [];
    let droppedCount = 0;
    let drained = false;

    return {
        record(event: DecisionTraceEventV1): boolean {
            // A late result may never enter a drained collector.
            if (drained) {
                droppedCount += 1;
                return false;
            }
            if (serializeDecisionTraceEvent(event) === null) {
                droppedCount += 1;
                return false;
            }
            if (events.length >= maxEvents) {
                droppedCount += 1;
                return false;
            }
            events.push(event);
            return true;
        },
        drain(): DecisionTraceCollectorDrain {
            if (drained) {
                return { events: [], droppedCount, drained: false };
            }
            drained = true;
            return { events: events.slice(), droppedCount, drained: true };
        },
    };
}

export interface DecisionTraceMergeResult {
    /** Merged array, or the original payload when not mergeable. */
    readonly stepMetadata: unknown;
    readonly appended: number;
    readonly dropped: number;
    /** "legacy-non-array-payload" when the original is not an array. */
    readonly omittedReason: string | null;
}

/**
 * Additive merge: keeps every existing entry of the array unchanged, validates
 * each incoming event through the strict serializer and appends the valid ones
 * in order after the existing entries. A legacy non-array payload is returned
 * untouched, never rewritten.
 */
export function mergeDecisionTraceEvents(
    stepMetadata: unknown,
    events: readonly DecisionTraceEventV1[] | undefined,
): DecisionTraceMergeResult {
    if (!events || events.length === 0) {
        return { stepMetadata, appended: 0, dropped: 0, omittedReason: null };
    }
    if (!Array.isArray(stepMetadata)) {
        return {
            stepMetadata,
            appended: 0,
            dropped: events.length,
            omittedReason: "legacy-non-array-payload",
        };
    }
    const merged: unknown[] = [...stepMetadata];
    let appended = 0;
    let dropped = 0;
    for (const event of events) {
        const validated = serializeDecisionTraceEvent(event);
        if (validated === null) {
            dropped += 1;
            continue;
        }
        merged.push(validated);
        appended += 1;
    }
    return { stepMetadata: merged, appended, dropped, omittedReason: null };
}
