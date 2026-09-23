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
 * - Missing required fields always own the turn via deterministic recovery
 *   (AC-18); advice is never consulted for them.
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
    /** Structural missing required fields (existing draft/issue facts). */
    readonly missingFields: readonly string[];
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
 * 1. missing required fields → deterministic recovery owns the turn (AC-18)
 * 2. existing mutation block → never cleared (AC-19); advice may add a
 *    question on top of the suppressed turn
 * 3. accepted user input → retained, never suppressed
 * 4. identical clarification already asked at this revision → no repeat
 *    (AC-20)
 * 5. advice unavailable → no behavior change
 * 6. otherwise → advice may add exactly one question and nothing else
 *
 * `targetConfirmed` is part of the facts for the caller's own deterministic
 * logic; deliberately none of the rules above consume it.
 */
export function decideClarification(input: {
    readonly facts: ClarificationFacts;
    /** The façade's sanitized advice; null when not evaluated, abstained, or unavailable. */
    readonly advice: ClarificationAdvice | null;
}): ClarificationDecision {
    const { facts, advice } = input;

    // 1. Deterministic checks outrank advice: structural missing fields own
    //    the turn and forbid model mutation (AC-18).
    if (facts.missingFields.length > 0) {
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
