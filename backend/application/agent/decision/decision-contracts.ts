/**
 * Provider-neutral decision contract for the Jev semantic decision layer.
 *
 * This contract deliberately contains no permission surface: no `approve`,
 * no `execute`, no `VerifiedTenantPrincipal`, no arbitrary tool list, no
 * database client, and no field that could be mistaken for a grant of
 * authority. Decision evidence is a bounded numeric/label summary only.
 */

export const DECISION_KINDS = {
    routeDomains: "route-domains",
    classifyClientIntent: "classify-client-intent",
    evaluateClarification: "evaluate-clarification",
    rankCandidates: "rank-candidates",
} as const;

export type DecisionKind = (typeof DECISION_KINDS)[keyof typeof DECISION_KINDS];

export const DECISION_MODES = {
    off: "off",
    shadow: "shadow",
    enforce: "enforce",
} as const;

export type DecisionMode = (typeof DECISION_MODES)[keyof typeof DECISION_MODES];

export const DECISION_STATUSES = {
    accepted: "accepted",
    abstain: "abstain",
    unavailable: "unavailable",
    notEvaluated: "not-evaluated",
} as const;

export type DecisionStatus = (typeof DECISION_STATUSES)[keyof typeof DECISION_STATUSES];

/**
 * `read` is an intent category reported by the classifier. It is never a
 * capability id and must not be emitted as one.
 */
export const CLIENT_INTENTS = {
    create: "create",
    updateRelated: "update_related",
    read: "read",
    ambiguous: "ambiguous",
    unrelated: "unrelated",
} as const;

export type ClientIntent = (typeof CLIENT_INTENTS)[keyof typeof CLIENT_INTENTS];

export const CANDIDATE_OUTCOMES = {
    match: "match",
    none: "none",
    insufficientEvidence: "insufficient_evidence",
} as const;

export type CandidateOutcome = (typeof CANDIDATE_OUTCOMES)[keyof typeof CANDIDATE_OUTCOMES];

export const DECISION_FAILURE_REASONS = {
    timeout: "timeout",
    aborted: "aborted",
    transportError: "transport-error",
    rateLimited: "rate-limited",
    authError: "auth-error",
    providerError: "provider-error",
    invalidOutput: "invalid-output",
    modelMismatch: "model-mismatch",
    questionMismatch: "question-mismatch",
    missingAnswer: "missing-answer",
    unknownLabel: "unknown-label",
    invalidScore: "invalid-score",
    lowConfidence: "low-confidence",
    narrowMargin: "narrow-margin",
    unsupportedDomainCount: "unsupported-domain-count",
    budgetExhausted: "budget-exhausted",
    concurrencySaturated: "concurrency-saturated",
    notSampled: "not-sampled",
    disabled: "disabled",
    trustedState: "trusted-state",
    ineligible: "ineligible",
} as const;

export type DecisionFailureReason = (typeof DECISION_FAILURE_REASONS)[keyof typeof DECISION_FAILURE_REASONS];

export const DECISION_PROFILE_MISMATCH_REASONS = {
    modelMismatch: "model-mismatch",
    questionMismatch: "question-mismatch",
    profileMismatch: "profile-mismatch",
    scopeMismatch: "scope-mismatch",
} as const;

export type DecisionProfileMismatchReason =
    (typeof DECISION_PROFILE_MISMATCH_REASONS)[keyof typeof DECISION_PROFILE_MISMATCH_REASONS];

export interface DecisionUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
}

export interface DecisionRequestBase {
    readonly kind: DecisionKind;
    /** Fixed catalog version, see decision-questions.ts. */
    readonly questionVersion: string;
    /** Absolute epoch ms turn deadline. */
    readonly deadlineAt: number;
    /** Caller-owned cancellation. */
    readonly signal: AbortSignal;
}

export interface DecisionEvidenceBase {
    readonly kind: DecisionKind;
    readonly status: DecisionStatus;
    readonly questionVersion: string;
    readonly requestedModel: string;
    readonly returnedModel: string | null;
    readonly latencyMs: number;
    readonly providerRequestId: string | null;
    readonly failureReason: DecisionFailureReason | null;
    readonly usage: DecisionUsage | null;
}

/**
 * Independent Noul probability for one domain, each value in 0..1.
 * These values are NOT a distribution: nothing in this module may normalize
 * them to sum to one, and no code may assume that they do.
 */
export interface DomainScore {
    readonly domain: string;
    readonly yesProbability: number;
}

export interface DomainRoutingEvidence extends DecisionEvidenceBase {
    readonly kind: "route-domains";
    readonly domains: readonly DomainScore[];
}

export interface ClientIntentEvidence extends DecisionEvidenceBase {
    readonly kind: "classify-client-intent";
    readonly intent: ClientIntent | null;
    readonly probabilities: Readonly<Partial<Record<ClientIntent, number>>>;
    readonly confidence: number | null;
}

/** Independent Noul probabilities, each in 0..1; not a normalized distribution. */
export interface ClarificationJudgments {
    readonly mutationRequested: number;
    readonly targetUnambiguous: number;
    readonly valueUnambiguous: number;
    readonly sufficientEvidence: number;
    readonly clarificationRequired: number;
}

export interface ClarificationEvidence extends DecisionEvidenceBase {
    readonly kind: "evaluate-clarification";
    readonly judgments: ClarificationJudgments | null;
}

export interface CandidateEvidence extends DecisionEvidenceBase {
    readonly kind: "rank-candidates";
    readonly outcome: CandidateOutcome | null;
    /** Opaque label from the exact supplied set. */
    readonly suggestion: string | null;
    /** Must echo the request revision. */
    readonly choiceSetRevision: string | null;
    readonly probabilities: Readonly<Record<string, number>>;
}

export type DecisionEvidence =
    | DomainRoutingEvidence
    | ClientIntentEvidence
    | ClarificationEvidence
    | CandidateEvidence;

export interface DecisionThresholds {
    readonly acceptProbability: number;
    readonly minMargin: number;
}

export interface DecisionAcceptanceProfile {
    readonly profileVersion: string;
    readonly decisionKind: DecisionKind;
    /** Pinned versioned id, e.g. "jev-1.13.0"; a moving alias is invalid. */
    readonly modelId: string;
    readonly questionVersion: string;
    readonly datasetDigest: string;
    readonly thresholds: DecisionThresholds;
    readonly approvedScope: readonly string[];
    readonly evaluationReference: string;
    readonly approvalReference: string;
}

export interface DecisionPolicyResult<TSelection> {
    readonly status: DecisionStatus;
    /** Set only when status === "accepted". */
    readonly selection: TSelection | null;
    /** Incumbent decision for shadow comparison. */
    readonly baselineSelection: TSelection | null;
    readonly reason: DecisionFailureReason | null;
    readonly profileVersion: string | null;
}

export interface DecisionTraceEventV1 {
    readonly kind: "semantic-decision-v1";
    readonly decisionKind: DecisionKind;
    readonly mode: DecisionMode;
    readonly model: string | null;
    readonly profileVersion: string | null;
    readonly questionVersion: string;
    readonly labels: readonly string[];
    readonly scores: readonly number[];
    readonly latencyMs: number;
    readonly outcome: DecisionStatus;
    readonly reason: DecisionFailureReason | null;
    readonly disagreement: boolean | null;
    readonly usage: DecisionUsage | null;
    readonly missing: boolean;
    readonly droppedReason: string | null;
}
