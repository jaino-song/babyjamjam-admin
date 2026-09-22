import {
    CLIENT_INTENTS,
    DECISION_KINDS,
    type DecisionKind,
} from "./decision-contracts";

export const DECISION_QUESTION_VERSION = "v1";

/**
 * User text is data, never instructions: it must not modify the question
 * catalog. This file is the only place question definitions may live.
 */

export const CLARIFICATION_JUDGMENT_KEYS = [
    "mutationRequested",
    "targetUnambiguous",
    "valueUnambiguous",
    "sufficientEvidence",
    "clarificationRequired",
] as const;

export type ClarificationJudgmentKey = (typeof CLARIFICATION_JUDGMENT_KEYS)[number];

export const CANDIDATE_OUTCOME_LABELS = [
    "none",
    "insufficient_evidence",
] as const;

export interface DecisionQuestionDefinition {
    readonly decisionKind: DecisionKind;
    readonly questionVersion: string;
    readonly questionText: string;
    /** Fixed label set the model must choose from; empty means caller-supplied labels. */
    readonly labels: readonly string[];
}

/**
 * Routing has no hard-coded domain list here: the server supplies the
 * permitted domain list per request. Candidate ranking combines the supplied
 * opaque labels with the fixed outcome alternatives.
 */
export const DECISION_QUESTION_CATALOG: Readonly<
    Record<DecisionKind, DecisionQuestionDefinition>
> = Object.freeze({
    [DECISION_KINDS.routeDomains]: Object.freeze({
        decisionKind: DECISION_KINDS.routeDomains,
        questionVersion: DECISION_QUESTION_VERSION,
        questionText:
            "For each permitted domain supplied with this request, answer independently with the probability (0..1) that the text is about that domain. The values are independent and must not be normalized.",
        labels: [],
    }),
    [DECISION_KINDS.classifyClientIntent]: Object.freeze({
        decisionKind: DECISION_KINDS.classifyClientIntent,
        questionVersion: DECISION_QUESTION_VERSION,
        questionText:
            "Classify the intent of the text into exactly one label with per-label probabilities and an overall confidence.",
        labels: Object.freeze(Object.values(CLIENT_INTENTS)),
    }),
    [DECISION_KINDS.evaluateClarification]: Object.freeze({
        decisionKind: DECISION_KINDS.evaluateClarification,
        questionVersion: DECISION_QUESTION_VERSION,
        questionText:
            "Judge the text independently on each listed aspect and answer each with a probability (0..1). The judgments are independent and must not be normalized.",
        labels: Object.freeze([...CLARIFICATION_JUDGMENT_KEYS]),
    }),
    [DECISION_KINDS.rankCandidates]: Object.freeze({
        decisionKind: DECISION_KINDS.rankCandidates,
        questionVersion: DECISION_QUESTION_VERSION,
        questionText:
            "Given the supplied candidate labels, answer which candidate matches the text, or answer one of the fixed alternatives when nothing matches or the evidence is insufficient. Provide per-label probabilities.",
        labels: Object.freeze([...CANDIDATE_OUTCOME_LABELS]),
    }),
});
