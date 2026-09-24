import type { ClarificationAdvice } from "./decision-policy";

/**
 * Conservative clarification advice: combine structural task state with the
 * façade's already-sanitized semantic advice. The helper's input contains no
 * utterance text at all — redaction is upstream; when protected values cannot
 * be represented safely the caller abstains and this helper receives `null`
 * advice.
 *
 * Invariant: the returned object can only **add a question or withhold
 * mutation authority**. It can never relax a deterministic restriction,
 * erase accepted user input, or retarget a task:
 *
 * - An unconfirmed write target always owns the turn via deterministic
 *   recovery (AC-18); advice is never consulted for it. A value the user
 *   supplied in free text is never "missing" in the sense that matters here
 *   — the model can extract it, and every write still ends at the mandatory
 *   approval card, so a missing *value* never suppresses model mutation on
 *   its own (BJJ-348). Only an unknown *record* (no confirmed target) does.
 * - An existing deterministic mutation block is never cleared (AC-19);
 *   advice may at most add a question on top of the suppressed turn.
 * - Explicit accepted user input is retained — a probabilistic judgment is
 *   not authority to erase it.
 * - The same ambiguity at the same task revision is not asked twice (AC-20),
 *   derived only from caller-provided existing state; this module keeps no
 *   persistent state of its own.
 * - Unavailable advice preserves current recovery: no advice, no behavior
 *   change.
 *
 * Pure: no DI, no IO, no clock, no randomness, no logging, no state.
 */

/** Closed vocabulary; machine tokens only. */
export const CLARIFICATION_DECISION_REASONS = [
    "advice-accepted",
    "advice-unavailable",
    "deterministic-recovery",
    "mutation-blocked",
    "accepted-input-retained",
    "already-asked",
] as const;

export type ClarificationDecisionReason = (typeof CLARIFICATION_DECISION_REASONS)[number];

/**
 * Structural facts about the current task turn, derived upstream from
 * committed server state. No field carries utterance text or any protected
 * value — see the module invariant.
 */
export interface ClarificationFacts {
    readonly taskRevision: number;
    /**
     * Structural missing required fields (existing draft/issue facts). Sent
     * to the provider as state only — no rule in this helper suppresses on
     * it (BJJ-348). A missing value is never authority to hide the write
     * tool; only an unconfirmed target is (see `targetMissing`).
     */
    readonly missingFields: readonly string[];
    /**
     * True when the task's capability requires a write target (anything but
     * `clients.create`) and none is confirmed yet, or the confirmed one is
     * stale (un-scoped `task.stale`). `clients.create` never
     * has a target, so this is always false for it. This is the sole
     * deterministic-recovery trigger (AC-18, BJJ-348).
     */
    readonly targetMissing: boolean;
    /** Present for the caller's own deterministic logic; no rule in this helper consumes it. */
    readonly targetConfirmed: boolean;
    /** Explicit, server-validated user input already accepted for this task. */
    readonly hasAcceptedUserInput: boolean;
    /** An existing deterministic block already forbids model mutation this turn. */
    readonly mutationBlocked: boolean;
    /** Revision at which an identical clarification was already requested, or null. Derived by the caller from existing state. */
    readonly clarificationAskedAtRevision: number | null;
}

export interface ClarificationDecision {
    readonly recommendClarification: boolean;
    /** true → a question may be asked, but no model mutation may follow this turn. */
    readonly suppressModelMutation: boolean;
    /** true → the deterministic missing-field recovery owns the turn. */
    readonly deterministicRecovery: boolean;
    readonly reason: ClarificationDecisionReason;
}

/**
 * Decide whether this turn should ask a clarification question, from
 * structural facts plus sanitized advice only. Rules are evaluated in a
 * fixed order so deterministic checks always outrank semantic advice:
 *
 * 1. unconfirmed write target → deterministic recovery owns the turn
 *    (AC-18, BJJ-348); a missing *value* never suppresses on its own
 * 2. existing mutation block → never cleared (AC-19); advice may add a
 *    question on top of the suppressed turn
 * 3. accepted user input → retained, never suppressed
 * 4. identical clarification already asked at this revision → no repeat
 *    (AC-20)
 * 5. advice unavailable → no behavior change
 * 6. otherwise → advice may add exactly one question and nothing else
 *
 * `targetConfirmed` and `missingFields` are part of the facts for the
 * caller's own deterministic logic and for provider state; deliberately no
 * rule above consumes them directly (see `targetMissing`, which is derived
 * from the same target state but is the one signal that owns the turn).
 */
export function decideClarification(input: {
    readonly facts: ClarificationFacts;
    /** The façade's sanitized advice; null when not evaluated, abstained, or unavailable. */
    readonly advice: ClarificationAdvice | null;
}): ClarificationDecision {
    const { facts, advice } = input;

    // 1. Deterministic checks outrank advice: an unconfirmed write target
    //    owns the turn and forbids model mutation (AC-18). A missing value
    //    never does — the model may extract it from the text, and every
    //    write still ends at the mandatory approval card (BJJ-348).
    if (facts.targetMissing) {
        return {
            recommendClarification: false,
            suppressModelMutation: true,
            deterministicRecovery: true,
            reason: "deterministic-recovery",
        };
    }
    // 2. An existing deterministic block can never be cleared (AC-19);
    //    advice may at most add a question on top of the suppressed turn.
    if (facts.mutationBlocked) {
        return {
            recommendClarification: advice?.recommendClarification === true,
            suppressModelMutation: true,
            deterministicRecovery: false,
            reason: "mutation-blocked",
        };
    }
    // 3. Explicit accepted user input is retained; a probabilistic judgment
    //    is not authority to erase or suppress it.
    if (facts.hasAcceptedUserInput) {
        return {
            recommendClarification: advice?.recommendClarification === true,
            suppressModelMutation: false,
            deterministicRecovery: false,
            reason: "accepted-input-retained",
        };
    }
    // 4. The same ambiguity at the same task revision is never asked again
    //    (AC-20); this reads caller-derived existing state only.
    if (facts.clarificationAskedAtRevision === facts.taskRevision) {
        return {
            recommendClarification: false,
            suppressModelMutation: false,
            deterministicRecovery: false,
            reason: "already-asked",
        };
    }
    // 5. Unavailable advice preserves current recovery: no advice, no change.
    if (advice === null) {
        return {
            recommendClarification: false,
            suppressModelMutation: false,
            deterministicRecovery: false,
            reason: "advice-unavailable",
        };
    }
    // 6. Accepted advice may add exactly one question and nothing else.
    return {
        recommendClarification: advice.recommendClarification,
        suppressModelMutation: false,
        deterministicRecovery: false,
        reason: "advice-accepted",
    };
}
