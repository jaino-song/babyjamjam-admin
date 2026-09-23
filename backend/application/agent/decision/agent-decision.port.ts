import type {
    CandidateEvidence,
    ClarificationEvidence,
    ClientIntentEvidence,
    DecisionRequestBase,
    DomainRoutingEvidence,
} from "./decision-contracts";

/**
 * Port rule: implementations return evidence, never actions. No method may
 * approve, execute, select a write target, or mutate state.
 */

export interface CandidateProjection {
    readonly label: string;
    readonly facts: readonly string[];
}

export interface RouteDomainsRequest extends DecisionRequestBase {
    readonly kind: "route-domains";
    readonly redactedText: string;
    readonly permittedDomains: readonly string[];
}

export interface ClassifyClientIntentRequest extends DecisionRequestBase {
    readonly kind: "classify-client-intent";
    readonly redactedText: string;
}

export interface EvaluateClarificationRequest extends DecisionRequestBase {
    readonly kind: "evaluate-clarification";
    readonly redactedText: string;
    readonly missingFields: readonly string[];
    readonly targetConfirmed: boolean;
}

export interface RankCandidatesRequest extends DecisionRequestBase {
    readonly kind: "rank-candidates";
    readonly redactedText: string;
    readonly choiceSetRevision: string;
    readonly candidates: readonly CandidateProjection[];
}

export interface AgentDecisionPort {
    routeDomains(request: RouteDomainsRequest): Promise<DomainRoutingEvidence>;
    classifyClientIntent(request: ClassifyClientIntentRequest): Promise<ClientIntentEvidence>;
    evaluateClarification(request: EvaluateClarificationRequest): Promise<ClarificationEvidence>;
    rankCandidates(request: RankCandidatesRequest): Promise<CandidateEvidence>;
}
