import {
    DECISION_KINDS,
    DECISION_MODES,
    DECISION_STATUSES,
    type CandidateEvidence,
    type ClarificationEvidence,
    type ClientIntentEvidence,
    type DecisionAcceptanceProfile,
    type DecisionKind,
    type DecisionMode,
    type DecisionPolicyResult,
    type DomainRoutingEvidence,
} from "./decision-contracts";
import { DECISION_QUESTION_VERSION } from "./decision-questions";
import type { ClarificationAdvice } from "./decision-policy";
import { AgentDecisionConfigService, type AgentDecisionConfig } from "./agent-decision-config.service";
import type { AgentDecisionPort } from "./agent-decision.port";
import { AGENT_DECISION_PORT, AgentDecisionService, type DecisionTurnContext } from "./agent-decision.service";

const MODEL_ID = "jev-1.13.0";

const DEFAULT_LIMITS: AgentDecisionConfig["limits"] = {
    turnDeadlineMs: 800,
    maxP0PerTurn: 2,
    maxP1PerTurn: 1,
    maxConcurrentCalls: 4,
    maxCandidates: 10,
};

/** Default in-scope branch for tests that are not exercising the branch gate itself. */
const DEFAULT_BRANCH_ID = "branch-default";

interface FakeConfigOptions {
    mode?: DecisionMode;
    samplingFraction?: number;
    limits?: Partial<AgentDecisionConfig["limits"]>;
    profiles?: Partial<Record<DecisionKind, DecisionAcceptanceProfile>>;
    /** Defaults to [DEFAULT_BRANCH_ID] so every existing scenario stays in scope. */
    allowedBranchIds?: readonly string[];
}

function fakeConfigService(options: FakeConfigOptions = {}): AgentDecisionConfigService {
    const mode = options.mode ?? DECISION_MODES.off;
    const samplingFraction = options.samplingFraction ?? 0;
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const profiles = options.profiles ?? {};
    const allowedBranchIds = options.allowedBranchIds ?? [DEFAULT_BRANCH_ID];
    return {
        getConfig: jest.fn().mockResolvedValue({
            globalDisabled: false,
            modelId: MODEL_ID,
            samplingFraction,
            environments: [],
            allowedBranchIds,
            limits,
            kinds: {},
            profiles,
        }),
        getKindMode: jest.fn().mockResolvedValue(mode),
        getAcceptanceProfile: jest.fn().mockImplementation(
            async (kind: DecisionKind) => profiles[kind] ?? null,
        ),
    } as unknown as AgentDecisionConfigService;
}

interface MockedPort {
    routeDomains: jest.Mock;
    classifyClientIntent: jest.Mock;
    evaluateClarification: jest.Mock;
    rankCandidates: jest.Mock;
}

function fakePort(): MockedPort {
    return {
        routeDomains: jest.fn(),
        classifyClientIntent: jest.fn(),
        evaluateClarification: jest.fn(),
        rankCandidates: jest.fn(),
    };
}

function serviceWith(config: AgentDecisionConfigService, port: AgentDecisionPort): AgentDecisionService {
    return new AgentDecisionService(config, port);
}

function portAsDecisionPort(port: MockedPort): AgentDecisionPort {
    return port as unknown as AgentDecisionPort;
}

async function turnContext(
    service: AgentDecisionService,
    sampleKey = "turn-key",
    branchId = DEFAULT_BRANCH_ID,
): Promise<DecisionTurnContext> {
    return service.createTurnContext({ signal: new AbortController().signal, sampleKey, branchId });
}

function routeEvidence(overrides: Partial<DomainRoutingEvidence> = {}): DomainRoutingEvidence {
    return {
        kind: DECISION_KINDS.routeDomains,
        status: DECISION_STATUSES.accepted,
        questionVersion: DECISION_QUESTION_VERSION,
        requestedModel: MODEL_ID,
        returnedModel: MODEL_ID,
        latencyMs: 12,
        providerRequestId: null,
        failureReason: null,
        usage: null,
        domains: [{ domain: "clients", yesProbability: 0.9 }],
        ...overrides,
    };
}

function intentEvidence(overrides: Partial<ClientIntentEvidence> = {}): ClientIntentEvidence {
    return {
        kind: DECISION_KINDS.classifyClientIntent,
        status: DECISION_STATUSES.accepted,
        questionVersion: DECISION_QUESTION_VERSION,
        requestedModel: MODEL_ID,
        returnedModel: MODEL_ID,
        latencyMs: 12,
        providerRequestId: null,
        failureReason: null,
        usage: null,
        intent: "create",
        probabilities: { create: 0.9, read: 0.05 },
        confidence: 0.9,
        ...overrides,
    };
}

function clarificationEvidence(overrides: Partial<ClarificationEvidence> = {}): ClarificationEvidence {
    return {
        kind: DECISION_KINDS.evaluateClarification,
        status: DECISION_STATUSES.accepted,
        questionVersion: DECISION_QUESTION_VERSION,
        requestedModel: MODEL_ID,
        returnedModel: MODEL_ID,
        latencyMs: 12,
        providerRequestId: null,
        failureReason: null,
        usage: null,
        judgments: {
            mutationRequested: 0.9,
            targetUnambiguous: 0.9,
            valueUnambiguous: 0.9,
            sufficientEvidence: 0.9,
            clarificationRequired: 0.9,
        },
        ...overrides,
    };
}

function rankEvidence(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
    return {
        kind: DECISION_KINDS.rankCandidates,
        status: DECISION_STATUSES.accepted,
        questionVersion: DECISION_QUESTION_VERSION,
        requestedModel: MODEL_ID,
        returnedModel: MODEL_ID,
        latencyMs: 12,
        providerRequestId: null,
        failureReason: null,
        usage: null,
        outcome: "match",
        suggestion: "client-1",
        choiceSetRevision: "rev-1",
        probabilities: { "client-1": 0.9 },
        ...overrides,
    };
}

function profileFor(
    decisionKind: DecisionKind,
    overrides: Partial<DecisionAcceptanceProfile> = {},
): DecisionAcceptanceProfile {
    return {
        profileVersion: "profile-v1",
        decisionKind,
        modelId: MODEL_ID,
        questionVersion: DECISION_QUESTION_VERSION,
        datasetDigest: "sha256:abcdef1234",
        thresholds: { acceptProbability: 0.8, minMargin: 0.05 },
        approvedScope: ["jev-test"],
        evaluationReference: "evals/agent/jev",
        approvalReference: "APPROVAL-1",
        ...overrides,
    };
}

describe("AgentDecisionService", () => {
    it("keeps Nest DI metadata resolvable: config service is a value import, port stays on its symbol token", () => {
        // Regression guard: reverting AgentDecisionConfigService to a
        // type-only import erases the design:paramtypes entry and breaks
        // every AppModule boot, while manual instantiation keeps passing.
        const paramTypes = Reflect.getMetadata("design:paramtypes", AgentDecisionService) as unknown[] | undefined;
        expect(paramTypes?.[0]).toBe(AgentDecisionConfigService);

        const selfDeclared = Reflect.getMetadata("self:paramtypes", AgentDecisionService) as
            | Array<{ index: number; param: unknown }>
            | undefined;
        expect(selfDeclared).toContainEqual({ index: 1, param: AGENT_DECISION_PORT });
    });

    it("off mode: zero port calls and a not-evaluated/disabled result", async () => {
        const port = fakePort();
        port.routeDomains.mockResolvedValue(routeEvidence());
        const service = serviceWith(fakeConfigService({ mode: DECISION_MODES.off }), portAsDecisionPort(port));
        const ctx = await turnContext(service);

        const result = await service.routeDomains(ctx, {
            text: "please route this",
            knownValues: [],
            permittedDomains: ["clients"],
            baseline: ["clients"],
        });

        expect(port.routeDomains).not.toHaveBeenCalled();
        expect(result).toEqual({
            status: "not-evaluated",
            selection: null,
            baselineSelection: ["clients"],
            reason: "disabled",
            profileVersion: null,
        });
        expect(ctx.collector.drain().events).toEqual([]);
    });

    it("shadow sampled: one port call, nothing applied, one bounded observation", async () => {
        const port = fakePort();
        port.routeDomains.mockResolvedValue(routeEvidence());
        const service = serviceWith(
            fakeConfigService({
                mode: DECISION_MODES.shadow,
                samplingFraction: 1,
                profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
            }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);

        const result = await service.routeDomains(ctx, {
            text: "switch client-alpha to premium",
            knownValues: ["client-alpha"],
            permittedDomains: ["clients"],
            baseline: [],
        });

        expect(port.routeDomains).toHaveBeenCalledTimes(1);
        const request = port.routeDomains.mock.calls[0]?.[0];
        expect(request).toMatchObject({
            kind: "route-domains",
            permittedDomains: ["clients"],
            questionVersion: DECISION_QUESTION_VERSION,
            signal: ctx.signal,
        });
        // Per-call deadline, computed fresh at call admission (see the
        // fake-timer-pinned assertion below for the exact
        // `Date.now() + turnDeadlineMs` bound); the turn context itself no
        // longer carries a deadline field.
        expect(request?.deadlineAt).toBeGreaterThanOrEqual(Date.now());
        expect(request?.redactedText).not.toContain("client-alpha");

        // Shadow never applies: the caller keeps its baseline.
        expect(result.status).toBe("accepted");
        expect(result.selection).toBeNull();
        expect(result.baselineSelection).toEqual([]);
        expect(result.profileVersion).toBe("profile-v1");

        const drain = ctx.collector.drain();
        expect(drain.events).toHaveLength(1);
        expect(drain.events[0]).toMatchObject({
            kind: "semantic-decision-v1",
            decisionKind: "route-domains",
            mode: "shadow",
            outcome: "accepted",
            profileVersion: "profile-v1",
            labels: ["clients"],
            scores: [0.9],
        });
    });

    it("shadow not sampled: zero port calls and not-sampled", async () => {
        const port = fakePort();
        const service = serviceWith(
            fakeConfigService({ mode: DECISION_MODES.shadow, samplingFraction: 0 }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);

        const result = await service.routeDomains(ctx, {
            text: "text",
            knownValues: [],
            permittedDomains: ["clients"],
            baseline: ["clients"],
        });

        expect(port.routeDomains).not.toHaveBeenCalled();
        expect(result.status).toBe("not-evaluated");
        expect(result.reason).toBe("not-sampled");
        expect(result.selection).toBeNull();
        expect(result.baselineSelection).toEqual(["clients"]);
        expect(ctx.collector.drain().events).toEqual([]);
    });

    it("enforce with a matching profile: applies the accepted policy result", async () => {
        const port = fakePort();
        port.routeDomains.mockResolvedValue(routeEvidence({ domains: [{ domain: "clients", yesProbability: 0.9 }] }));
        const service = serviceWith(
            fakeConfigService({
                mode: DECISION_MODES.enforce,
                profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
            }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);

        const result = await service.routeDomains(ctx, {
            text: "text",
            knownValues: [],
            permittedDomains: ["clients"],
            baseline: [],
        });

        expect(port.routeDomains).toHaveBeenCalledTimes(1);
        expect(result.status).toBe("accepted");
        expect(result.selection).toEqual(["clients"]);
        expect(result.reason).toBeNull();
        expect(result.profileVersion).toBe("profile-v1");

        const drain = ctx.collector.drain();
        expect(drain.events).toHaveLength(1);
        expect(drain.events[0]).toMatchObject({ mode: "enforce", outcome: "accepted" });
    });

    it("enforce with a matching profile: abstains without a selection on low evidence", async () => {
        const port = fakePort();
        port.routeDomains.mockResolvedValue(routeEvidence({ domains: [{ domain: "clients", yesProbability: 0.5 }] }));
        const service = serviceWith(
            fakeConfigService({
                mode: DECISION_MODES.enforce,
                profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
            }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);

        const result = await service.routeDomains(ctx, {
            text: "text",
            knownValues: [],
            permittedDomains: ["clients"],
            baseline: ["clients"],
        });

        expect(result.status).toBe("abstain");
        expect(result.reason).toBe("low-confidence");
        expect(result.selection).toBeNull();
        expect(result.baselineSelection).toEqual(["clients"]);
    });

    it("enforce with a missing profile: not-evaluated/ineligible with zero behavior change", async () => {
        const port = fakePort();
        port.classifyClientIntent.mockResolvedValue(intentEvidence());
        const service = serviceWith(
            fakeConfigService({ mode: DECISION_MODES.enforce }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);

        const result = await service.classifyClientIntent(ctx, {
            text: "text",
            knownValues: [],
            baseline: "read",
        });

        expect(port.classifyClientIntent).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            status: "not-evaluated",
            selection: null,
            baselineSelection: "read",
            reason: "ineligible",
            profileVersion: null,
        });
    });

    it("enforce with a mismatched model profile: not-evaluated/ineligible", async () => {
        const port = fakePort();
        port.rankCandidates.mockResolvedValue(rankEvidence());
        const service = serviceWith(
            fakeConfigService({
                mode: DECISION_MODES.enforce,
                profiles: {
                    [DECISION_KINDS.rankCandidates]: profileFor(DECISION_KINDS.rankCandidates, {
                        modelId: "jev-0.9.0",
                    }),
                },
            }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);

        const result = await service.rankCandidates(ctx, {
            text: "text",
            knownValues: [],
            choiceSetRevision: "rev-1",
            candidates: [{ label: "client-1", facts: ["fact"] }],
            baseline: null,
        });

        expect(port.rankCandidates).toHaveBeenCalledTimes(1);
        expect(result.status).toBe("not-evaluated");
        expect(result.reason).toBe("ineligible");
        expect(result.profileVersion).toBe("profile-v1");
        expect(result.selection).toBeNull();
        expect(result.baselineSelection).toBeNull();
    });

    it("computes a fresh per-call deadline at admission time, not at turn creation (BJJ-347)", async () => {
        jest.useFakeTimers();
        try {
            jest.setSystemTime(new Date("2026-09-24T00:00:00.000Z"));
            const port = fakePort();
            port.evaluateClarification.mockResolvedValue(clarificationEvidence());
            const service = serviceWith(
                fakeConfigService({
                    mode: DECISION_MODES.enforce,
                    limits: { turnDeadlineMs: 800 },
                    profiles: {
                        [DECISION_KINDS.evaluateClarification]: profileFor(DECISION_KINDS.evaluateClarification),
                    },
                }),
                portAsDecisionPort(port),
            );
            const ctx = await turnContext(service);

            // Admit the call 900ms after turn-context creation: past the old
            // (now-removed) turn-deadline window. The deadline is per call,
            // so this call still reaches the port.
            jest.advanceTimersByTime(900);
            const callStart = Date.now();

            const result: DecisionPolicyResult<ClarificationAdvice> = await service.evaluateClarification(ctx, {
                text: "text",
                knownValues: [],
                missingFields: ["phone"],
                targetConfirmed: false,
                baseline: null,
            });

            expect(port.evaluateClarification).toHaveBeenCalledTimes(1);
            expect(result.status).toBe("accepted");
            const request = port.evaluateClarification.mock.calls[0]?.[0] as { deadlineAt: number };
            expect(request.deadlineAt).toBe(callStart + 800);
        } finally {
            jest.useRealTimers();
        }
    });


    it("blocks P0 kinds after the P0 cap and keeps the P1 budget independent", async () => {
        const port = fakePort();
        port.routeDomains.mockResolvedValue(routeEvidence());
        port.classifyClientIntent.mockResolvedValue(intentEvidence());
        port.rankCandidates.mockResolvedValue(rankEvidence());
        const service = serviceWith(
            fakeConfigService({
                mode: DECISION_MODES.enforce,
                limits: { maxP0PerTurn: 1, maxP1PerTurn: 1 },
                profiles: {
                    [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains),
                    [DECISION_KINDS.classifyClientIntent]: profileFor(DECISION_KINDS.classifyClientIntent),
                    [DECISION_KINDS.rankCandidates]: profileFor(DECISION_KINDS.rankCandidates),
                },
            }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);
        const routeInput = { text: "text", knownValues: [], permittedDomains: ["clients"], baseline: [] as string[] };

        const firstRoute = await service.routeDomains(ctx, routeInput);
        expect(firstRoute.status).toBe("accepted");

        const secondRoute = await service.routeDomains(ctx, routeInput);
        expect(secondRoute.reason).toBe("budget-exhausted");

        const classified = await service.classifyClientIntent(ctx, { text: "text", knownValues: [], baseline: null });
        expect(classified.reason).toBe("budget-exhausted");
        expect(port.classifyClientIntent).not.toHaveBeenCalled();
        expect(port.routeDomains).toHaveBeenCalledTimes(1);

        const ranked = await service.rankCandidates(ctx, {
            text: "text",
            knownValues: [],
            choiceSetRevision: "rev-1",
            candidates: [{ label: "client-1", facts: [] }],
            baseline: null,
        });
        expect(ranked.status).toBe("accepted");

        const secondRank = await service.rankCandidates(ctx, {
            text: "text",
            knownValues: [],
            choiceSetRevision: "rev-1",
            candidates: [{ label: "client-1", facts: [] }],
            baseline: null,
        });
        expect(secondRank.reason).toBe("budget-exhausted");
        expect(port.rankCandidates).toHaveBeenCalledTimes(1);
    });

    it("skips with concurrency-saturated when the process slot is taken, never queues", async () => {
        const port = fakePort();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        port.routeDomains.mockImplementation(async () => {
            await gate;
            return routeEvidence();
        });
        const service = serviceWith(
            fakeConfigService({
                mode: DECISION_MODES.enforce,
                limits: { maxConcurrentCalls: 1 },
                profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
            }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);
        const input = { text: "text", knownValues: [], permittedDomains: ["clients"], baseline: [] as string[] };

        const inFlight = service.routeDomains(ctx, input);
        const skipped = await service.routeDomains(ctx, input);

        expect(skipped.status).toBe("not-evaluated");
        expect(skipped.reason).toBe("concurrency-saturated");
        expect(skipped.selection).toBeNull();
        expect(port.routeDomains).toHaveBeenCalledTimes(1);

        release();
        const applied = await inFlight;
        expect(applied.status).toBe("accepted");

        // Exactly one skip-trace event for the concurrency-saturated call,
        // alongside the in-flight call's own accepted observation.
        const events = ctx.collector.drain().events;
        expect(events).toHaveLength(2);
        const skipEvents = events.filter((event) => event.reason === "concurrency-saturated");
        expect(skipEvents).toHaveLength(1);
        expect(skipEvents[0]).toMatchObject({
            decisionKind: "route-domains",
            mode: "enforce",
            model: null,
            profileVersion: null,
            labels: [],
            scores: [],
            latencyMs: 0,
            outcome: "not-evaluated",
            reason: "concurrency-saturated",
            disagreement: null,
            usage: null,
            missing: true,
            droppedReason: null,
        });
    });

    it("maps a port throw to unavailable/provider-error and preserves the baseline", async () => {
        const port = fakePort();
        port.routeDomains.mockRejectedValue(new Error("provider exploded"));
        const service = serviceWith(
            fakeConfigService({
                mode: DECISION_MODES.shadow,
                samplingFraction: 1,
                profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
            }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);

        const result = await service.routeDomains(ctx, {
            text: "text",
            knownValues: [],
            permittedDomains: ["clients"],
            baseline: ["clients"],
        });

        expect(result.status).toBe("unavailable");
        expect(result.reason).toBe("provider-error");
        expect(result.selection).toBeNull();
        expect(result.baselineSelection).toEqual(["clients"]);
        expect(ctx.collector.drain().events).toEqual([]);
    });

    it("samples deterministically: the same key always produces the same outcome", async () => {
        const run = async (sampleKey: string): Promise<string | null> => {
            const port = fakePort();
            port.routeDomains.mockResolvedValue(routeEvidence());
            const service = serviceWith(
                fakeConfigService({
                    mode: DECISION_MODES.shadow,
                    samplingFraction: 0.5,
                    profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
                }),
                portAsDecisionPort(port),
            );
            const ctx = await turnContext(service, sampleKey);
            const result = await service.routeDomains(ctx, {
                text: "text",
                knownValues: [],
                permittedDomains: ["clients"],
                baseline: [],
            });
            return result.reason;
        };

        for (const key of ["turn-0", "turn-1", "turn-2", "turn-3"]) {
            expect(await run(key)).toBe(await run(key));
        }

        // With the fixed hash and a 0.5 fraction, some keys must land on each
        // side of the boundary (this is deterministic for the implementation).
        const reasons = await Promise.all(
            Array.from({ length: 64 }, (_item, index) => run(`turn-${index}`)),
        );
        expect(reasons).toContain(null);
        expect(reasons).toContain("not-sampled");
    });

    it("isolates turn contexts: counters and collectors are not shared", async () => {
        const port = fakePort();
        port.routeDomains.mockResolvedValue(routeEvidence());
        const service = serviceWith(
            fakeConfigService({
                mode: DECISION_MODES.enforce,
                limits: { maxP0PerTurn: 1 },
                profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
            }),
            portAsDecisionPort(port),
        );
        const ctxA = await turnContext(service, "a");
        const ctxB = await turnContext(service, "b");
        const input = { text: "text", knownValues: [], permittedDomains: ["clients"], baseline: [] as string[] };

        const a1 = await service.routeDomains(ctxA, input);
        expect(a1.status).toBe("accepted");
        const a2 = await service.routeDomains(ctxA, input);
        expect(a2.reason).toBe("budget-exhausted");

        // A fresh context has its own budget.
        const b1 = await service.routeDomains(ctxB, input);
        expect(b1.status).toBe("accepted");

        // Collectors are per-context too. ctxA additionally drains the one
        // skip-trace event recorded for its budget-exhausted second call.
        const drainedA = ctxA.collector.drain().events;
        expect(drainedA).toHaveLength(2);
        expect(drainedA[1]).toMatchObject({
            decisionKind: "route-domains",
            mode: "enforce",
            outcome: "not-evaluated",
            reason: "budget-exhausted",
            missing: true,
        });
        expect(ctxB.collector.drain().events).toHaveLength(1);
    });

    it("refuses a candidate set above maxCandidates without a port call", async () => {
        const port = fakePort();
        port.rankCandidates.mockResolvedValue(rankEvidence());
        const service = serviceWith(
            fakeConfigService({
                mode: DECISION_MODES.enforce,
                limits: { maxCandidates: 2 },
                profiles: { [DECISION_KINDS.rankCandidates]: profileFor(DECISION_KINDS.rankCandidates) },
            }),
            portAsDecisionPort(port),
        );
        const ctx = await turnContext(service);

        const result = await service.rankCandidates(ctx, {
            text: "text",
            knownValues: [],
            choiceSetRevision: "rev-1",
            candidates: [
                { label: "a", facts: [] },
                { label: "b", facts: [] },
                { label: "c", facts: [] },
            ],
            baseline: null,
        });

        expect(port.rankCandidates).not.toHaveBeenCalled();
        expect(result.status).toBe("not-evaluated");
        expect(result.reason).toBe("budget-exhausted");

        // The kind-specific exceedsLimits skip also drains exactly one event.
        const events = ctx.collector.drain().events;
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            decisionKind: "rank-candidates",
            mode: "enforce",
            outcome: "not-evaluated",
            reason: "budget-exhausted",
            missing: true,
        });
    });

    describe("skip traces (BJJ-347)", () => {
        it("records nothing for a disabled skip", async () => {
            const port = fakePort();
            const service = serviceWith(fakeConfigService({ mode: DECISION_MODES.off }), portAsDecisionPort(port));
            const ctx = await turnContext(service);
            await service.routeDomains(ctx, {
                text: "text",
                knownValues: [],
                permittedDomains: ["clients"],
                baseline: [],
            });
            expect(ctx.collector.drain().events).toEqual([]);
        });

        it("records nothing for a not-sampled skip", async () => {
            const port = fakePort();
            const service = serviceWith(
                fakeConfigService({ mode: DECISION_MODES.shadow, samplingFraction: 0 }),
                portAsDecisionPort(port),
            );
            const ctx = await turnContext(service);
            await service.routeDomains(ctx, {
                text: "text",
                knownValues: [],
                permittedDomains: ["clients"],
                baseline: [],
            });
            expect(ctx.collector.drain().events).toEqual([]);
        });
    });

    describe("branch allowlist (BJJ-346)", () => {
        it.each([DECISION_MODES.shadow, DECISION_MODES.enforce])(
            "skips with zero port calls when the turn's branch is not in allowedBranchIds (%s)",
            async (mode) => {
                const port = fakePort();
                port.routeDomains.mockResolvedValue(routeEvidence());
                const service = serviceWith(
                    fakeConfigService({
                        mode,
                        samplingFraction: 1,
                        allowedBranchIds: ["other-branch"],
                        profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
                    }),
                    portAsDecisionPort(port),
                );
                const ctx = await turnContext(service, "turn-key", "branch-out-of-scope");
                expect(ctx.inScope).toBe(false);

                const result = await service.routeDomains(ctx, {
                    text: "text",
                    knownValues: [],
                    permittedDomains: ["clients"],
                    baseline: ["clients"],
                });

                expect(port.routeDomains).not.toHaveBeenCalled();
                expect(result).toEqual({
                    status: "not-evaluated",
                    selection: null,
                    baselineSelection: ["clients"],
                    reason: "disabled",
                    profileVersion: null,
                });
                expect(ctx.collector.drain().events).toEqual([]);
            },
        );

        it("empty allowedBranchIds puts every branch out of scope", async () => {
            const port = fakePort();
            const service = serviceWith(
                fakeConfigService({ mode: DECISION_MODES.enforce, allowedBranchIds: [] }),
                portAsDecisionPort(port),
            );
            const ctx = await turnContext(service, "turn-key", "any-branch");
            expect(ctx.inScope).toBe(false);
        });

        it("runs normally when the turn's branch is listed", async () => {
            const port = fakePort();
            port.routeDomains.mockResolvedValue(routeEvidence());
            const service = serviceWith(
                fakeConfigService({
                    mode: DECISION_MODES.enforce,
                    allowedBranchIds: ["branch-in-scope"],
                    profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
                }),
                portAsDecisionPort(port),
            );
            const ctx = await turnContext(service, "turn-key", "branch-in-scope");
            expect(ctx.inScope).toBe(true);

            const result = await service.routeDomains(ctx, {
                text: "text",
                knownValues: [],
                permittedDomains: ["clients"],
                baseline: [],
            });

            expect(port.routeDomains).toHaveBeenCalledTimes(1);
            expect(result.status).toBe("accepted");
        });

        it("normalises branch comparison with String() for a numeric-like principal branchId", async () => {
            const port = fakePort();
            port.routeDomains.mockResolvedValue(routeEvidence());
            const service = serviceWith(
                fakeConfigService({
                    mode: DECISION_MODES.enforce,
                    allowedBranchIds: ["42"],
                    profiles: { [DECISION_KINDS.routeDomains]: profileFor(DECISION_KINDS.routeDomains) },
                }),
                portAsDecisionPort(port),
            );
            const ctx = await service.createTurnContext({
                signal: new AbortController().signal,
                sampleKey: "turn-key",
                branchId: 42 as unknown as string,
            });
            expect(ctx.inScope).toBe(true);
        });
    });
});
