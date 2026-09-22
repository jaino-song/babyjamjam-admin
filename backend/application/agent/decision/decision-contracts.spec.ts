import {
    CANDIDATE_OUTCOMES,
    CLIENT_INTENTS,
    DECISION_FAILURE_REASONS,
    DECISION_KINDS,
    DECISION_MODES,
    DECISION_PROFILE_MISMATCH_REASONS,
    DECISION_STATUSES,
    type CandidateEvidence,
    type ClarificationEvidence,
    type ClientIntent,
    type ClientIntentEvidence,
    type DecisionAcceptanceProfile,
    type DecisionEvidence,
    type DomainRoutingEvidence,
    type DomainScore,
} from "./decision-contracts";
import {
    applyCandidatePolicy,
    applyClarificationPolicy,
    applyClientIntentPolicy,
    applyDomainRoutingPolicy,
    isProfileCompatible,
    toDecisionTraceEvent,
} from "./decision-policy";
import {
    assertNoForbiddenDecisionFields,
    buildRedactedDecisionText,
    FORBIDDEN_DECISION_FIELDS,
    projectCandidateFacts,
} from "./decision-input";
import { DECISION_QUESTION_VERSION } from "./decision-questions";

const PINNED_MODEL = "jev-1.13.0";

function makeProfile(
    decisionKind: DecisionAcceptanceProfile["decisionKind"],
    overrides: Partial<DecisionAcceptanceProfile> = {},
): DecisionAcceptanceProfile {
    return {
        profileVersion: "profile-v1",
        decisionKind,
        modelId: PINNED_MODEL,
        questionVersion: DECISION_QUESTION_VERSION,
        datasetDigest: "digest-2026-09",
        thresholds: { acceptProbability: 0.7, minMargin: 0.1 },
        approvedScope: ["jev:route-domains"],
        evaluationReference: "eval/jev-v1",
        approvalReference: "approval/jev-v1",
        ...overrides,
    };
}

function evidenceBase(kind: DecisionEvidence["kind"]) {
    return {
        kind,
        status: DECISION_STATUSES.accepted,
        questionVersion: DECISION_QUESTION_VERSION,
        requestedModel: PINNED_MODEL,
        returnedModel: PINNED_MODEL,
        latencyMs: 42,
        providerRequestId: "req-1",
        failureReason: null,
        usage: { inputTokens: 10, outputTokens: 5 },
    };
}

function makeRoutingEvidence(
    domains: readonly DomainScore[],
    overrides: Partial<DomainRoutingEvidence> = {},
): DomainRoutingEvidence {
    return {
        ...evidenceBase("route-domains"),
        kind: "route-domains",
        domains,
        ...overrides,
    } as DomainRoutingEvidence;
}

function makeIntentEvidence(
    overrides: Partial<ClientIntentEvidence> = {},
): ClientIntentEvidence {
    return {
        ...evidenceBase("classify-client-intent"),
        kind: "classify-client-intent",
        intent: CLIENT_INTENTS.create,
        probabilities: {
            create: 0.9,
            update_related: 0.05,
            read: 0.02,
            ambiguous: 0.02,
            unrelated: 0.01,
        },
        confidence: 0.9,
        ...overrides,
    } as ClientIntentEvidence;
}

function makeClarificationEvidence(
    overrides: Partial<ClarificationEvidence> = {},
): ClarificationEvidence {
    return {
        ...evidenceBase("evaluate-clarification"),
        kind: "evaluate-clarification",
        judgments: {
            mutationRequested: 0.95,
            targetUnambiguous: 0.4,
            valueUnambiguous: 0.3,
            sufficientEvidence: 0.2,
            clarificationRequired: 0.9,
        },
        ...overrides,
    } as ClarificationEvidence;
}

function makeCandidateEvidence(
    overrides: Partial<CandidateEvidence> = {},
): CandidateEvidence {
    return {
        ...evidenceBase("rank-candidates"),
        kind: "rank-candidates",
        outcome: CANDIDATE_OUTCOMES.match,
        suggestion: "clients",
        choiceSetRevision: "rev-1",
        probabilities: { clients: 0.92, none: 0.05, insufficient_evidence: 0.03 },
        ...overrides,
    } as CandidateEvidence;
}

describe("decision-contracts constants", () => {
    it("should expose the fixed label unions when the catalog constants are read", () => {
        expect(Object.values(DECISION_KINDS)).toEqual([
            "route-domains",
            "classify-client-intent",
            "evaluate-clarification",
            "rank-candidates",
        ]);
        expect(Object.values(DECISION_MODES)).toEqual(["off", "shadow", "enforce"]);
        expect(Object.values(DECISION_STATUSES)).toEqual([
            "accepted",
            "abstain",
            "unavailable",
            "not-evaluated",
        ]);
        expect(Object.values(CLIENT_INTENTS)).toEqual([
            "create",
            "update_related",
            "read",
            "ambiguous",
            "unrelated",
        ]);
        expect(Object.values(CANDIDATE_OUTCOMES)).toEqual([
            "match",
            "none",
            "insufficient_evidence",
        ]);
        expect(DECISION_QUESTION_VERSION).toBe("v1");
    });

    it("should list exactly the forbidden decision fields when the guard constant is read", () => {
        expect([...FORBIDDEN_DECISION_FIELDS]).toEqual([
            "approve",
            "execute",
            "principal",
            "db",
            "database",
            "client",
            "tools",
        ]);
    });
});

describe("decision status reachability", () => {
    const routingProfile = makeProfile(DECISION_KINDS.routeDomains);

    it("should reach accepted when routing evidence passes the threshold", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([{ domain: "clients", yesProbability: 0.9 }]),
            routingProfile,
            { permittedDomains: ["clients"], maxDomains: 3, baseline: [] },
        );
        expect(result.status).toBe(DECISION_STATUSES.accepted);
    });

    it("should reach abstain when no domain clears the accept probability", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([{ domain: "clients", yesProbability: 0.5 }]),
            routingProfile,
            { permittedDomains: ["clients"], maxDomains: 3, baseline: [] },
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("low-confidence");
    });

    it("should reach unavailable when clarification evidence has no judgments", () => {
        const result = applyClarificationPolicy(
            makeClarificationEvidence({ judgments: null }),
            makeProfile(DECISION_KINDS.evaluateClarification),
        );
        expect(result.status).toBe(DECISION_STATUSES.unavailable);
    });

    it("should reach not-evaluated when the evidence record itself was not evaluated", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([{ domain: "clients", yesProbability: 0.9 }], {
                status: DECISION_STATUSES.notEvaluated,
                failureReason: "not-sampled",
            }),
            routingProfile,
            { permittedDomains: ["clients"], maxDomains: 3, baseline: [] },
        );
        expect(result.status).toBe(DECISION_STATUSES.notEvaluated);
        expect(result.reason).toBe("not-sampled");
        expect(result.selection).toBeNull();
    });
});

describe("evidence status propagation", () => {
    it("should return unavailable with the evidence failure reason when routing evidence failed", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([{ domain: "clients", yesProbability: 0.9 }], {
                status: DECISION_STATUSES.unavailable,
                failureReason: DECISION_FAILURE_REASONS.timeout,
            }),
            makeProfile(DECISION_KINDS.routeDomains),
            { permittedDomains: ["clients"], maxDomains: 3, baseline: ["files"] },
        );
        expect(result.status).toBe(DECISION_STATUSES.unavailable);
        expect(result.reason).toBe(DECISION_FAILURE_REASONS.timeout);
        expect(result.selection).toBeNull();
        expect(result.baselineSelection).toEqual(["files"]);
    });

    it("should stay unavailable when an unavailable routing record carries domains above threshold", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence(
                [
                    { domain: "clients", yesProbability: 0.95 },
                    { domain: "schedules", yesProbability: 0.9 },
                ],
                {
                    status: DECISION_STATUSES.unavailable,
                    failureReason: DECISION_FAILURE_REASONS.providerError,
                },
            ),
            makeProfile(DECISION_KINDS.routeDomains),
            { permittedDomains: ["clients", "schedules"], maxDomains: 3, baseline: [] },
        );
        expect(result.status).toBe(DECISION_STATUSES.unavailable);
        expect(result.reason).toBe(DECISION_FAILURE_REASONS.providerError);
        expect(result.selection).toBeNull();
    });

    it("should default the unavailable reason to provider-error when the evidence carries none", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([], {
                status: DECISION_STATUSES.unavailable,
                failureReason: null,
            }),
            makeProfile(DECISION_KINDS.routeDomains),
            { permittedDomains: ["clients"], maxDomains: 3, baseline: [] },
        );
        expect(result.status).toBe(DECISION_STATUSES.unavailable);
        expect(result.reason).toBe(DECISION_FAILURE_REASONS.providerError);
    });

    it("should return abstain with the evidence failure reason when routing evidence abstained", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([{ domain: "clients", yesProbability: 0.9 }], {
                status: DECISION_STATUSES.abstain,
                failureReason: DECISION_FAILURE_REASONS.invalidOutput,
            }),
            makeProfile(DECISION_KINDS.routeDomains),
            { permittedDomains: ["clients"], maxDomains: 3, baseline: [] },
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
        expect(result.selection).toBeNull();
    });

    it("should propagate unavailable and abstain statuses for client intent evidence", () => {
        const unavailableResult = applyClientIntentPolicy(
            makeIntentEvidence({
                intent: CLIENT_INTENTS.create,
                status: DECISION_STATUSES.unavailable,
                failureReason: DECISION_FAILURE_REASONS.rateLimited,
            }),
            makeProfile(DECISION_KINDS.classifyClientIntent),
            CLIENT_INTENTS.read,
        );
        expect(unavailableResult.status).toBe(DECISION_STATUSES.unavailable);
        expect(unavailableResult.reason).toBe(DECISION_FAILURE_REASONS.rateLimited);
        expect(unavailableResult.selection).toBeNull();
        expect(unavailableResult.baselineSelection).toBe(CLIENT_INTENTS.read);

        const abstainResult = applyClientIntentPolicy(
            makeIntentEvidence({
                intent: CLIENT_INTENTS.create,
                status: DECISION_STATUSES.abstain,
                failureReason: DECISION_FAILURE_REASONS.invalidScore,
            }),
            makeProfile(DECISION_KINDS.classifyClientIntent),
            null,
        );
        expect(abstainResult.status).toBe(DECISION_STATUSES.abstain);
        expect(abstainResult.reason).toBe(DECISION_FAILURE_REASONS.invalidScore);
        expect(abstainResult.selection).toBeNull();
    });

    it("should stay unavailable when unavailable clarification evidence carries populated judgments", () => {
        const result = applyClarificationPolicy(
            makeClarificationEvidence({
                status: DECISION_STATUSES.unavailable,
                failureReason: DECISION_FAILURE_REASONS.authError,
            }),
            makeProfile(DECISION_KINDS.evaluateClarification),
        );
        expect(result.status).toBe(DECISION_STATUSES.unavailable);
        expect(result.reason).toBe(DECISION_FAILURE_REASONS.authError);
        expect(result.selection).toBeNull();
    });

    it("should propagate unavailable and abstain statuses for clarification evidence", () => {
        const unavailableResult = applyClarificationPolicy(
            makeClarificationEvidence({
                judgments: null,
                status: DECISION_STATUSES.unavailable,
                failureReason: DECISION_FAILURE_REASONS.transportError,
            }),
            makeProfile(DECISION_KINDS.evaluateClarification),
        );
        expect(unavailableResult.status).toBe(DECISION_STATUSES.unavailable);
        expect(unavailableResult.reason).toBe(DECISION_FAILURE_REASONS.transportError);
        expect(unavailableResult.selection).toBeNull();

        const abstainResult = applyClarificationPolicy(
            makeClarificationEvidence({
                status: DECISION_STATUSES.abstain,
                failureReason: DECISION_FAILURE_REASONS.invalidOutput,
            }),
            makeProfile(DECISION_KINDS.evaluateClarification),
        );
        expect(abstainResult.status).toBe(DECISION_STATUSES.abstain);
        expect(abstainResult.reason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
        expect(abstainResult.selection).toBeNull();
    });

    it("should propagate unavailable and abstain statuses for candidate evidence", () => {
        const profile = makeProfile(DECISION_KINDS.rankCandidates);
        const options = {
            choiceSetRevision: "rev-1",
            candidateLabels: ["clients", "schedules"],
            baseline: "schedules",
        };
        const unavailableResult = applyCandidatePolicy(
            makeCandidateEvidence({
                status: DECISION_STATUSES.unavailable,
                failureReason: DECISION_FAILURE_REASONS.aborted,
            }),
            profile,
            options,
        );
        expect(unavailableResult.status).toBe(DECISION_STATUSES.unavailable);
        expect(unavailableResult.reason).toBe(DECISION_FAILURE_REASONS.aborted);
        expect(unavailableResult.selection).toBeNull();
        expect(unavailableResult.baselineSelection).toBe("schedules");

        const abstainResult = applyCandidatePolicy(
            makeCandidateEvidence({
                status: DECISION_STATUSES.abstain,
                failureReason: DECISION_FAILURE_REASONS.invalidOutput,
            }),
            profile,
            options,
        );
        expect(abstainResult.status).toBe(DECISION_STATUSES.abstain);
        expect(abstainResult.reason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
        expect(abstainResult.selection).toBeNull();
    });
});

describe("applyDomainRoutingPolicy", () => {
    const profile = makeProfile(DECISION_KINDS.routeDomains);

    it("should keep independent noul probabilities untouched when they sum above one", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([
                { domain: "clients", yesProbability: 0.9 },
                { domain: "schedules", yesProbability: 0.85 },
                { domain: "files", yesProbability: 0.8 },
            ]),
            profile,
            { permittedDomains: ["clients", "schedules", "files"], maxDomains: 5, baseline: ["files"] },
        );
        expect(result.status).toBe(DECISION_STATUSES.accepted);
        expect(result.selection).toEqual(["clients", "schedules", "files"]);
        expect(result.baselineSelection).toEqual(["files"]);
    });

    it("should filter unknown domains when a score names a domain outside the permitted list", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([
                { domain: "clients", yesProbability: 0.9 },
                { domain: "unauthorized-domain", yesProbability: 0.95 },
            ]),
            profile,
            { permittedDomains: ["clients"], maxDomains: 5, baseline: [] },
        );
        expect(result.status).toBe(DECISION_STATUSES.accepted);
        expect(result.selection).toEqual(["clients"]);
    });

    it("should drop invalid scores when a probability is not a finite value in 0..1", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([
                { domain: "clients", yesProbability: 1.5 },
                { domain: "files", yesProbability: Number.NaN },
                { domain: "schedules", yesProbability: 0.8 },
            ]),
            profile,
            { permittedDomains: ["clients", "files", "schedules"], maxDomains: 5, baseline: [] },
        );
        expect(result.selection).toEqual(["schedules"]);
    });

    it("should abstain with unsupported-domain-count when accepted domains exceed maxDomains", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([
                { domain: "clients", yesProbability: 0.9 },
                { domain: "schedules", yesProbability: 0.85 },
                { domain: "files", yesProbability: 0.8 },
            ]),
            profile,
            { permittedDomains: ["clients", "schedules", "files"], maxDomains: 2, baseline: [] },
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("unsupported-domain-count");
        expect(result.selection).toBeNull();
    });

    it("should order tied domains by name ascending when probabilities are equal", () => {
        const result = applyDomainRoutingPolicy(
            makeRoutingEvidence([
                { domain: "schedules", yesProbability: 0.9 },
                { domain: "clients", yesProbability: 0.9 },
            ]),
            profile,
            { permittedDomains: ["clients", "schedules"], maxDomains: 5, baseline: [] },
        );
        expect(result.selection).toEqual(["clients", "schedules"]);
    });
});

describe("applyClientIntentPolicy", () => {
    const profile = makeProfile(DECISION_KINDS.classifyClientIntent);

    it("should accept a valid label when its probability clears the threshold and the margin holds", () => {
        const result = applyClientIntentPolicy(makeIntentEvidence(), profile, CLIENT_INTENTS.read);
        expect(result.status).toBe(DECISION_STATUSES.accepted);
        expect(result.selection).toBe(CLIENT_INTENTS.create);
        expect(result.baselineSelection).toBe(CLIENT_INTENTS.read);
        expect(result.profileVersion).toBe(profile.profileVersion);
    });

    it("should abstain with unknown-label when the label is outside CLIENT_INTENTS", () => {
        const result = applyClientIntentPolicy(
            makeIntentEvidence({ intent: "delete" as unknown as ClientIntent }),
            profile,
            null,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("unknown-label");
        expect(result.selection).toBeNull();
    });

    it("should abstain with missing-answer when the intent is null", () => {
        const result = applyClientIntentPolicy(
            makeIntentEvidence({ intent: null }),
            profile,
            null,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("missing-answer");
    });

    it("should abstain with low-confidence when the probability is below the threshold", () => {
        const result = applyClientIntentPolicy(
            makeIntentEvidence({
                intent: CLIENT_INTENTS.create,
                probabilities: { ...makeIntentEvidence().probabilities, create: 0.5 },
            }),
            profile,
            null,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("low-confidence");
    });

    it("should abstain with narrow-margin when the top two probabilities are too close", () => {
        const result = applyClientIntentPolicy(
            makeIntentEvidence({
                probabilities: {
                    create: 0.75,
                    update_related: 0.7,
                    read: 0.02,
                    ambiguous: 0.02,
                    unrelated: 0.01,
                },
            }),
            profile,
            null,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("narrow-margin");
    });

    it("should abstain with narrow-margin when the selected label is not the argmax of the distribution", () => {
        const result = applyClientIntentPolicy(
            makeIntentEvidence({
                intent: CLIENT_INTENTS.read,
                probabilities: { read: 0.75, create: 0.9 },
            }),
            profile,
            null,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("narrow-margin");
        expect(result.selection).toBeNull();
    });

    it("should accept the selected label when it is the argmax with a margin above minMargin over the best other label", () => {
        const result = applyClientIntentPolicy(
            makeIntentEvidence({
                intent: CLIENT_INTENTS.read,
                probabilities: { read: 0.9, create: 0.5 },
            }),
            profile,
            null,
        );
        expect(result.status).toBe(DECISION_STATUSES.accepted);
        expect(result.selection).toBe(CLIENT_INTENTS.read);
    });

    it("should return read as an intent category only when a read intent is accepted", () => {
        const result = applyClientIntentPolicy(
            makeIntentEvidence({
                intent: CLIENT_INTENTS.read,
                probabilities: {
                    create: 0.05,
                    update_related: 0.05,
                    read: 0.85,
                    ambiguous: 0.03,
                    unrelated: 0.02,
                },
            }),
            profile,
            null,
        );
        expect(result.status).toBe(DECISION_STATUSES.accepted);
        expect(result.selection).toBe("read");
        assertNoForbiddenDecisionFields(result);
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain("clients.read");
        expect(serialized).not.toContain("capability");
    });

    it("should accept ambiguous and unrelated as their own labels when they win", () => {
        const result = applyClientIntentPolicy(
            makeIntentEvidence({
                intent: CLIENT_INTENTS.unrelated,
                probabilities: {
                    create: 0.05,
                    update_related: 0.03,
                    read: 0.02,
                    ambiguous: 0.05,
                    unrelated: 0.85,
                },
            }),
            profile,
            null,
        );
        expect(result.status).toBe(DECISION_STATUSES.accepted);
        expect(result.selection).toBe(CLIENT_INTENTS.unrelated);
    });
});

describe("applyClarificationPolicy", () => {
    const profile = makeProfile(DECISION_KINDS.evaluateClarification);

    it("should recommend asking when clarificationRequired clears the threshold", () => {
        const result = applyClarificationPolicy(makeClarificationEvidence(), profile);
        expect(result.status).toBe(DECISION_STATUSES.accepted);
        expect(result.selection).toEqual({ recommendClarification: true });
    });

    it("should recommend not asking when clarificationRequired is below the threshold", () => {
        const result = applyClarificationPolicy(
            makeClarificationEvidence({
                judgments: {
                    mutationRequested: 0.9,
                    targetUnambiguous: 0.95,
                    valueUnambiguous: 0.9,
                    sufficientEvidence: 0.9,
                    clarificationRequired: 0.2,
                },
            }),
            profile,
        );
        expect(result.status).toBe(DECISION_STATUSES.accepted);
        expect(result.selection).toEqual({ recommendClarification: false });
    });

    it("should return unavailable and never a continue signal when evidence is missing", () => {
        const result = applyClarificationPolicy(
            makeClarificationEvidence({ judgments: null }),
            profile,
        );
        expect(result.status).toBe(DECISION_STATUSES.unavailable);
        expect(result.selection).toBeNull();
        expect(result.reason).toBe("missing-answer");
    });
});

describe("applyCandidatePolicy", () => {
    const profile = makeProfile(DECISION_KINDS.rankCandidates);
    const options = {
        choiceSetRevision: "rev-1",
        candidateLabels: ["clients", "schedules"],
        baseline: "schedules",
    };

    it("should accept a suggestion when it matches, echoes the revision, and is a supplied label", () => {
        const result = applyCandidatePolicy(makeCandidateEvidence(), profile, options);
        expect(result.status).toBe(DECISION_STATUSES.accepted);
        expect(result.selection).toBe("clients");
        expect(result.baselineSelection).toBe("schedules");
    });

    it("should abstain with unknown-label when the suggestion is outside the supplied labels", () => {
        const result = applyCandidatePolicy(
            makeCandidateEvidence({ suggestion: "not-a-label" }),
            profile,
            options,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("unknown-label");
        expect(result.selection).toBeNull();
    });

    it("should abstain with invalid-output when the revision does not echo the request", () => {
        const result = applyCandidatePolicy(
            makeCandidateEvidence({ choiceSetRevision: "rev-0" }),
            profile,
            options,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("invalid-output");
        expect(result.selection).toBeNull();
    });

    it("should never select a write target when the outcome is none", () => {
        const result = applyCandidatePolicy(
            makeCandidateEvidence({ outcome: CANDIDATE_OUTCOMES.none, suggestion: null }),
            profile,
            options,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("low-confidence");
        expect(result.selection).toBeNull();
    });

    it("should never select a write target when the outcome is insufficient_evidence", () => {
        const result = applyCandidatePolicy(
            makeCandidateEvidence({
                outcome: CANDIDATE_OUTCOMES.insufficientEvidence,
                suggestion: null,
            }),
            profile,
            options,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.selection).toBeNull();
    });

    it("should abstain with missing-answer when the outcome is absent", () => {
        const result = applyCandidatePolicy(
            makeCandidateEvidence({ outcome: null, suggestion: null }),
            profile,
            options,
        );
        expect(result.status).toBe(DECISION_STATUSES.abstain);
        expect(result.reason).toBe("missing-answer");
    });
});

describe("isProfileCompatible", () => {
    it("should return null when the profile matches the evidence exactly", () => {
        expect(isProfileCompatible(makeProfile(DECISION_KINDS.routeDomains), makeRoutingEvidence([]))).toBeNull();
    });

    it("should return model-mismatch when the returned model differs from the pinned model id", () => {
        const reason = isProfileCompatible(
            makeProfile(DECISION_KINDS.routeDomains),
            makeRoutingEvidence([], { returnedModel: "jev-latest" }),
        );
        expect(reason).toBe(DECISION_PROFILE_MISMATCH_REASONS.modelMismatch);
    });

    it("should return model-mismatch when only the requested model differs", () => {
        const reason = isProfileCompatible(
            makeProfile(DECISION_KINDS.routeDomains),
            makeRoutingEvidence([], { requestedModel: "jev-latest" }),
        );
        expect(reason).toBe(DECISION_PROFILE_MISMATCH_REASONS.modelMismatch);
    });

    it("should return question-mismatch when the question versions differ", () => {
        const reason = isProfileCompatible(
            makeProfile(DECISION_KINDS.routeDomains, { questionVersion: "v0" }),
            makeRoutingEvidence([]),
        );
        expect(reason).toBe(DECISION_PROFILE_MISMATCH_REASONS.questionMismatch);
    });

    it("should return profile-mismatch when the decision kinds differ", () => {
        const reason = isProfileCompatible(
            makeProfile(DECISION_KINDS.routeDomains),
            makeIntentEvidence(),
        );
        expect(reason).toBe(DECISION_PROFILE_MISMATCH_REASONS.profileMismatch);
    });

    it("should return scope-mismatch when the approved scope is empty", () => {
        const reason = isProfileCompatible(
            makeProfile(DECISION_KINDS.routeDomains, { approvedScope: [] }),
            makeRoutingEvidence([]),
        );
        expect(reason).toBe(DECISION_PROFILE_MISMATCH_REASONS.scopeMismatch);
    });
});

describe("decision-input redaction and guard", () => {
    it("should remove raw protected values when building the redacted decision text", () => {
        const result = buildRedactedDecisionText(
            "홍길동 님 연락처 010-1234-5678 로 부탁드립니다",
            ["홍길동"],
        );
        expect(result).not.toContain("010-1234-5678");
        expect(result).not.toContain("홍길동");
        expect(result).toContain("[redacted]");
        expect(result).toContain("[protected]");
    });

    it("should cap the decision text at 240 characters when the raw text is long", () => {
        const result = buildRedactedDecisionText("가".repeat(500), []);
        expect(result.length).toBeLessThanOrEqual(240);
    });

    it("should redact each fact when candidate facts are projected", () => {
        const result = projectCandidateFacts([
            "이름: 홍길동, 요청: 계약 변경",
            "상세 https://example.com/private/one",
        ]);
        expect(result[0]).not.toContain("홍길동");
        expect(result[0]).toContain("[protected]");
        expect(result[1]).not.toContain("https://example.com/private/one");
        expect(result[1]).toContain("[redacted]");
    });

    it("should throw when a projection object carries a forbidden raw field", () => {
        expect(() => assertNoForbiddenDecisionFields({ approve: true })).toThrow();
        expect(() => assertNoForbiddenDecisionFields({ nested: { tools: [] } })).toThrow();
        expect(() => assertNoForbiddenDecisionFields([{ principal: { id: "p1" } }])).toThrow();
        expect(() => assertNoForbiddenDecisionFields({ client: { name: "raw" } })).toThrow();
        expect(() => assertNoForbiddenDecisionFields({ db: {}, database: {} })).toThrow();
    });

    it("should pass a clean evidence object without throwing", () => {
        expect(() => assertNoForbiddenDecisionFields(makeIntentEvidence())).not.toThrow();
        expect(() => assertNoForbiddenDecisionFields({ redactedText: "텍스트", score: 0.9 })).not.toThrow();
    });

    it("should traverse each object at most once and return normally for a cyclic clean object", () => {
        const clean: Record<string, unknown> = { labels: ["clients"], meta: { score: 0.9 } };
        clean["self"] = clean;
        expect(() => assertNoForbiddenDecisionFields(clean)).not.toThrow();
    });

    it("should still throw the forbidden-field error when a cyclic object carries a forbidden key", () => {
        const hostile: Record<string, unknown> = { meta: {} };
        hostile["self"] = hostile;
        hostile["meta"] = { approve: true };
        expect(() => assertNoForbiddenDecisionFields(hostile)).toThrow(
            'Forbidden decision field "approve" at value.meta.approve',
        );
    });
});

describe("toDecisionTraceEvent", () => {
    it("should produce a finite, text-free trace event when converting shadow-mode evidence", () => {
        const evidence = makeIntentEvidence();
        const baseline = makeIntentEvidence({ intent: CLIENT_INTENTS.updateRelated });
        const event = toDecisionTraceEvent({
            evidence,
            mode: DECISION_MODES.shadow,
            baselineEvidence: baseline,
            profileVersion: "profile-v1",
            missing: false,
            droppedReason: null,
        });
        expect(event.kind).toBe("semantic-decision-v1");
        expect(event.decisionKind).toBe(DECISION_KINDS.classifyClientIntent);
        expect(event.mode).toBe(DECISION_MODES.shadow);
        expect(event.outcome).toBe(DECISION_STATUSES.accepted);
        expect(event.model).toBe(PINNED_MODEL);
        expect(event.profileVersion).toBe("profile-v1");
        expect(event.questionVersion).toBe(DECISION_QUESTION_VERSION);
        expect(event.disagreement).toBe(true);
        expect(event.missing).toBe(false);
        expect(event.droppedReason).toBeNull();
        expect(event.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
        const serialized = JSON.stringify(event);
        expect(serialized).not.toContain("redactedText");
        expect(event.scores.every((score) => Number.isFinite(score))).toBe(true);
        expect(event.labels).toEqual([
            "create",
            "update_related",
            "read",
            "ambiguous",
            "unrelated",
        ]);
    });

    it("should filter non-finite scores and report null disagreement when no baseline exists", () => {
        const event = toDecisionTraceEvent({
            evidence: makeIntentEvidence({
                probabilities: {
                    create: Number.NaN,
                    update_related: 0.05,
                    read: 0.02,
                    ambiguous: 0.02,
                    unrelated: 0.01,
                },
            }),
            mode: DECISION_MODES.enforce,
            baselineEvidence: null,
            profileVersion: null,
            missing: true,
            droppedReason: "not-sampled",
        });
        expect(event.labels).not.toContain("create");
        expect(event.scores).toHaveLength(4);
        expect(event.disagreement).toBeNull();
        expect(event.missing).toBe(true);
        expect(event.droppedReason).toBe("not-sampled");
    });

    it("should use domain names as labels when converting routing evidence", () => {
        const event = toDecisionTraceEvent({
            evidence: makeRoutingEvidence([
                { domain: "clients", yesProbability: 0.9 },
                { domain: "schedules", yesProbability: 0.8 },
            ]),
            mode: DECISION_MODES.off,
            baselineEvidence: null,
            profileVersion: null,
            missing: false,
            droppedReason: null,
        });
        expect(event.decisionKind).toBe(DECISION_KINDS.routeDomains);
        expect(event.labels).toEqual(["clients", "schedules"]);
        expect(event.scores).toEqual([0.9, 0.8]);
    });
});
