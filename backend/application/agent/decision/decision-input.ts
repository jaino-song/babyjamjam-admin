import {
    redactClassifierText,
    redactExplicitLabeledText,
    redactFreeText,
} from "application/agent/agent-model-redaction";

/**
 * Keys that must never appear inside a decision projection: they name
 * permission or execution surface, not evidence. The list is finite and
 * named so both the runtime guard and projection helpers share it.
 */
export const FORBIDDEN_DECISION_FIELDS = [
    "approve",
    "execute",
    "principal",
    "db",
    "database",
    "client",
    "tools",
] as const;

const FORBIDDEN_FIELD_SET: ReadonlySet<string> = new Set<string>(FORBIDDEN_DECISION_FIELDS);

/**
 * Bounded decision text: delegates to the shared classifier redaction
 * (explicit labels, generic free-text patterns, then server-known values)
 * instead of reimplementing redaction. The 240-char cap keeps prompts bounded.
 */
export function buildRedactedDecisionText(rawText: string, knownValues: readonly string[]): string {
    return redactClassifierText(rawText, knownValues);
}

/** Redact one candidate fact; order mirrors the shared classifier pipeline. */
function redactFact(fact: string): string {
    return redactFreeText(redactExplicitLabeledText(fact));
}

export function projectCandidateFacts(facts: readonly string[]): readonly string[] {
    return facts.map(redactFact);
}

function isPlainObjectLike(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime guard used by tests and projection callers: throws when a forbidden
 * key appears at any depth. Cycle-safe; only enumerable own properties of
 * plain objects and arrays are traversed.
 */
export function assertNoForbiddenDecisionFields(value: unknown, path = "value"): void {
    assertNoForbiddenDecisionFieldsVisited(value, path, new WeakSet<object>());
}

function assertNoForbiddenDecisionFieldsVisited(
    value: unknown,
    path: string,
    visited: WeakSet<object>,
): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) =>
            assertNoForbiddenDecisionFieldsVisited(item, `${path}[${index}]`, visited));
        return;
    }
    if (!isPlainObjectLike(value)) return;
    if (visited.has(value)) return;
    visited.add(value);

    for (const key of Object.keys(value)) {
        if (FORBIDDEN_FIELD_SET.has(key)) {
            throw new Error(`Forbidden decision field "${key}" at ${path}.${key}`);
        }
    }
    for (const key of Object.keys(value)) {
        assertNoForbiddenDecisionFieldsVisited(value[key], `${path}.${key}`, visited);
    }
}
