import {
    CLIENT_INTENTS,
    DECISION_PROFILE_MISMATCH_REASONS,
    DECISION_STATUSES,
    type CandidateEvidence,
    type ClarificationEvidence,
    type ClientIntent,
    type ClientIntentEvidence,
    type DecisionAcceptanceProfile,
    type DecisionEvidence,
    type DecisionFailureReason,
    type DecisionMode,
    type DecisionPolicyResult,
    type DecisionProfileMismatchReason,
    type DecisionStatus,
    type DecisionTraceEventV1,
    type DecisionUsage,
    type DomainRoutingEvidence,
} from "./decision-contracts";
import { CLARIFICATION_JUDGMENT_KEYS } from "./decision-questions";

/**
 * Policy rule: unknown or missing model output means `abstain`/`unavailable`,
 * never a default write. No policy function in this module may manufacture
 * `clients.create`, `clients.update`, or any other capability selection.
 */

export interface ClarificationAdvice {
    readonly recommendClarification: boolean;
}

export interface DomainRoutingPolicyOptions {
    readonly permittedDomains: readonly string[];
    readonly maxDomains: number;
    readonly baseline: readonly string[];
}

export interface CandidatePolicyOptions {
    readonly choiceSetRevision: string;
    readonly candidateLabels: readonly string[];
    readonly baseline: string | null;
}

const CLIENT_INTENT_VALUES: readonly string[] = Object.values(CLIENT_INTENTS);

/** Valid independent Noul probability: finite and within 0..1. */
function isFiniteProbability(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteOrZero(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function finiteUsage(usage: DecisionUsage | null): DecisionUsage | null {
    if (usage === null) return null;
    if (!Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens)) return null;
    return usage;
}

export function isProfileCompatible(
    profile: DecisionAcceptanceProfile,
    evidence: DecisionEvidence,
): DecisionProfileMismatchReason | null {
    if (profile.decisionKind !== evidence.kind) {
        return DECISION_PROFILE_MISMATCH_REASONS.profileMismatch;
    }
    if (profile.modelId !== evidence.returnedModel || profile.modelId !== evidence.requestedModel) {
        return DECISION_PROFILE_MISMATCH_REASONS.modelMismatch;
    }
    if (profile.questionVersion !== evidence.questionVersion) {
        return DECISION_PROFILE_MISMATCH_REASONS.questionMismatch;
    }
    if (profile.approvedScope.length === 0) {
        return DECISION_PROFILE_MISMATCH_REASONS.scopeMismatch;
    }
    return null;
}

/**
 * Shared evidence-status gate. Every policy consults the evidence record's
 * own status before evaluating any payload:
 *
 * - `accepted` → the helper returns null and the policy proceeds to its
 *   threshold/membership evaluation.
 * - `not-evaluated` (the decision never ran, e.g. off mode or unsampled turn)
 *   → echoed back as-is instead of being manufactured into an abstain or a
 *   selection.
 * - `unavailable` (provider call failed) → `unavailable` with the evidence's
 *   own failure reason; the payload is never evaluated in this state.
 * - `abstain` (output could not be trusted) → `abstain` with the evidence's
 *   own failure reason.
 *
 * A self-contradictory record (e.g. `status: "unavailable"` but populated
 * domains) must surface the status, never an `accepted`/`abstain` verdict
 * derived from the payload.
 */
function evidenceStatusGate<TSelection>(
    evidence: DecisionEvidence,
    baseline: TSelection | null,
    profileVersion: string | null,
): DecisionPolicyResult<TSelection> | null {
    if (evidence.status === DECISION_STATUSES.accepted) return null;
    if (evidence.status === DECISION_STATUSES.unavailable) {
        return {
            status: DECISION_STATUSES.unavailable,
            selection: null,
            baselineSelection: baseline,
            reason: evidence.failureReason ?? "provider-error",
            profileVersion,
        };
    }
    if (evidence.status === DECISION_STATUSES.abstain) {
        return {
            status: DECISION_STATUSES.abstain,
            selection: null,
            baselineSelection: baseline,
            reason: evidence.failureReason ?? "invalid-output",
            profileVersion,
        };
    }
    return {
        status: DECISION_STATUSES.notEvaluated,
        selection: null,
        baselineSelection: baseline,
        reason: evidence.failureReason ?? "not-sampled",
        profileVersion,
    };
}

export function applyDomainRoutingPolicy(
    evidence: DomainRoutingEvidence,
    profile: DecisionAcceptanceProfile,
    options: DomainRoutingPolicyOptions,
): DecisionPolicyResult<readonly string[]> {
    const gated = evidenceStatusGate<readonly string[]>(evidence, options.baseline, profile.profileVersion);
    if (gated !== null) return gated;
    const permitted = new Set(options.permittedDomains);
    const validScores = evidence.domains
        .filter((score) => permitted.has(score.domain) && isFiniteProbability(score.yesProbability))
        .slice()
        .sort((left, right) =>
            right.yesProbability - left.yesProbability || left.domain.localeCompare(right.domain));
    const accepted = validScores
        .filter((score) => score.yesProbability >= profile.thresholds.acceptProbability)
        .map((score) => score.domain);

    if (accepted.length > options.maxDomains) {
        return {
            status: DECISION_STATUSES.abstain,
            selection: null,
            baselineSelection: options.baseline,
            reason: "unsupported-domain-count",
            profileVersion: profile.profileVersion,
        };
    }
    if (accepted.length === 0) {
        return {
            status: DECISION_STATUSES.abstain,
            selection: null,
            baselineSelection: options.baseline,
            reason: "low-confidence",
            profileVersion: profile.profileVersion,
        };
    }
    return {
        status: DECISION_STATUSES.accepted,
        selection: accepted,
        baselineSelection: options.baseline,
        reason: null,
        profileVersion: profile.profileVersion,
    };
}

export function applyClientIntentPolicy(
    evidence: ClientIntentEvidence,
    profile: DecisionAcceptanceProfile,
    baseline: ClientIntent | null,
): DecisionPolicyResult<ClientIntent> {
    const abstain = (reason: DecisionFailureReason): DecisionPolicyResult<ClientIntent> => ({
        status: DECISION_STATUSES.abstain,
        selection: null,
        baselineSelection: baseline,
        reason,
        profileVersion: profile.profileVersion,
    });

    const gated = evidenceStatusGate<ClientIntent>(evidence, baseline, profile.profileVersion);
    if (gated !== null) return gated;
    if (evidence.intent === null) {
        return abstain("missing-answer");
    }
    if (!CLIENT_INTENT_VALUES.includes(evidence.intent)) {
        return abstain("unknown-label");
    }
    const probability = evidence.probabilities[evidence.intent];
    if (!isFiniteProbability(probability)) {
        return abstain("invalid-score");
    }
    if (probability < profile.thresholds.acceptProbability) {
        return abstain("low-confidence");
    }
    // Margin is selected-label vs the best *other* finite label, never the
    // gap between the distribution's two largest values: a selected label
    // that is not the argmax yields a non-positive margin and can never be
    // accepted.
    let bestOther = 0;
    for (const [label, score] of Object.entries(evidence.probabilities)) {
        if (label !== evidence.intent && isFiniteProbability(score)) {
            bestOther = Math.max(bestOther, score);
        }
    }
    const margin = probability - bestOther;
    if (margin < profile.thresholds.minMargin) {
        return abstain("narrow-margin");
    }
    return {
        status: DECISION_STATUSES.accepted,
        selection: evidence.intent,
        baselineSelection: baseline,
        reason: null,
        profileVersion: profile.profileVersion,
    };
}

/**
 * Advice only: a recommendation to ask is advisory and a "no" never asserts
 * that a deterministic check may be skipped. Unavailable evidence yields
 * `unavailable`, never a "continue" signal.
 */
export function applyClarificationPolicy(
    evidence: ClarificationEvidence,
    profile: DecisionAcceptanceProfile,
): DecisionPolicyResult<ClarificationAdvice> {
    const gated = evidenceStatusGate<ClarificationAdvice>(evidence, null, profile.profileVersion);
    if (gated !== null) return gated;
    if (evidence.judgments === null) {
        return {
            status: DECISION_STATUSES.unavailable,
            selection: null,
            baselineSelection: null,
            reason: "missing-answer",
            profileVersion: profile.profileVersion,
        };
    }
    const clarificationRequired = evidence.judgments.clarificationRequired;
    if (!isFiniteProbability(clarificationRequired)) {
        return {
            status: DECISION_STATUSES.unavailable,
            selection: null,
            baselineSelection: null,
            reason: "invalid-score",
            profileVersion: profile.profileVersion,
        };
    }
    return {
        status: DECISION_STATUSES.accepted,
        selection: {
            recommendClarification: clarificationRequired >= profile.thresholds.acceptProbability,
        },
        baselineSelection: null,
        reason: null,
        profileVersion: profile.profileVersion,
    };
}

export function applyCandidatePolicy(
    evidence: CandidateEvidence,
    profile: DecisionAcceptanceProfile,
    options: CandidatePolicyOptions,
): DecisionPolicyResult<string> {
    const abstain = (reason: DecisionFailureReason): DecisionPolicyResult<string> => ({
        status: DECISION_STATUSES.abstain,
        selection: null,
        baselineSelection: options.baseline,
        reason,
        profileVersion: profile.profileVersion,
    });

    const gated = evidenceStatusGate<string>(evidence, options.baseline, profile.profileVersion);
    if (gated !== null) return gated;
    if (evidence.outcome === null) {
        return abstain("missing-answer");
    }
    if (evidence.choiceSetRevision !== options.choiceSetRevision) {
        return abstain("invalid-output");
    }
    if (evidence.outcome !== "match") {
        return abstain("low-confidence");
    }
    if (evidence.suggestion === null) {
        return abstain("missing-answer");
    }
    if (!options.candidateLabels.includes(evidence.suggestion)) {
        return abstain("unknown-label");
    }
    return {
        status: DECISION_STATUSES.accepted,
        selection: evidence.suggestion,
        baselineSelection: options.baseline,
        reason: null,
        profileVersion: profile.profileVersion,
    };
}

export interface DecisionTraceInput {
    readonly evidence: DecisionEvidence;
    readonly mode: DecisionMode;
    readonly baselineEvidence: DecisionEvidence | null;
    readonly profileVersion: string | null;
    readonly missing: boolean;
    readonly droppedReason: string | null;
}

/** Primary label of an evidence record, used only for disagreement bookkeeping. */
function primaryLabel(evidence: DecisionEvidence): string | null {
    if (evidence.kind === "route-domains") {
        const top = evidence.domains
            .filter((score) => isFiniteProbability(score.yesProbability))
            .slice()
            .sort((left, right) => right.yesProbability - left.yesProbability)[0];
        return top?.domain ?? null;
    }
    if (evidence.kind === "classify-client-intent") return evidence.intent;
    if (evidence.kind === "rank-candidates") return evidence.suggestion;
    return null;
}

function evidenceLabelScorePairs(evidence: DecisionEvidence): Array<[string, number]> {
    if (evidence.kind === "route-domains") {
        return evidence.domains.map((score) => [score.domain, score.yesProbability] as [string, number]);
    }
    if (evidence.kind === "evaluate-clarification") {
        if (evidence.judgments === null) return [];
        return CLARIFICATION_JUDGMENT_KEYS
            .map((key) => [key, evidence.judgments?.[key]] as [string, unknown])
            .filter((entry): entry is [string, number] => isFiniteProbability(entry[1]));
    }
    return Object.entries(evidence.probabilities)
        .filter((entry): entry is [string, number] => isFiniteProbability(entry[1]));
}

/**
 * Policy rule: unknown or missing model output means `abstain`/`unavailable`,
 * never a default write. This conversion only records what the evidence
 * already carries (status, reason, labels, scores); it never manufactures a
 * selection or promotes an unavailable/abstain record into a write decision.
 */
export function toDecisionTraceEvent(input: DecisionTraceInput): DecisionTraceEventV1 {
    const pairs = evidenceLabelScorePairs(input.evidence)
        .filter(([label, score]) => typeof label === "string" && isFiniteProbability(score));
    const baseline = input.baselineEvidence;
    const disagreement = baseline === null
        ? null
        : primaryLabel(input.evidence) !== primaryLabel(baseline);

    return {
        kind: "semantic-decision-v1",
        decisionKind: input.evidence.kind,
        mode: input.mode,
        model: input.evidence.returnedModel,
        profileVersion: input.profileVersion,
        questionVersion: input.evidence.questionVersion,
        labels: pairs.map(([label]) => label),
        scores: pairs.map(([, score]) => finiteOrZero(score)),
        latencyMs: finiteOrZero(input.evidence.latencyMs),
        outcome: input.evidence.status,
        reason: input.evidence.failureReason,
        disagreement,
        usage: finiteUsage(input.evidence.usage),
        missing: input.missing,
        droppedReason: input.droppedReason,
    };
}

/** Exhaustiveness helper for status handling at call sites. */
export function isDecisionStatusAccepted(status: DecisionStatus): status is "accepted" {
    return status === DECISION_STATUSES.accepted;
}
