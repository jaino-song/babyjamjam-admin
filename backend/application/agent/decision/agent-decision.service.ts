import { Inject, Injectable } from "@nestjs/common";

import type {
    AgentDecisionPort,
    CandidateProjection,
    ClassifyClientIntentRequest,
    EvaluateClarificationRequest,
    RankCandidatesRequest,
    RouteDomainsRequest,
} from "./agent-decision.port";
import { AgentDecisionConfigService } from "./agent-decision-config.service";
import type { AgentDecisionConfig } from "./agent-decision-config.service";
import {
    DECISION_FAILURE_REASONS,
    DECISION_KINDS,
    DECISION_MODES,
    DECISION_STATUSES,
    type CandidateEvidence,
    type ClarificationEvidence,
    type ClientIntent,
    type ClientIntentEvidence,
    type DecisionAcceptanceProfile,
    type DecisionEvidence,
    type DecisionFailureReason,
    type DecisionKind,
    type DecisionMode,
    type DecisionPolicyResult,
    type DomainRoutingEvidence,
} from "./decision-contracts";
import { buildRedactedDecisionText, projectCandidateFacts } from "./decision-input";
import {
    applyCandidatePolicy,
    applyClarificationPolicy,
    applyClientIntentPolicy,
    applyDomainRoutingPolicy,
    buildSkipTraceEvent,
    isProfileCompatible,
    toDecisionTraceEvent,
    type ClarificationAdvice,
} from "./decision-policy";
import { DECISION_QUESTION_VERSION } from "./decision-questions";
import { createDecisionTraceCollector, type DecisionTraceCollector } from "./decision-trace";

/** DI token for the provider-backed decision port. */
export const AGENT_DECISION_PORT = Symbol("AGENT_DECISION_PORT");

/** Server-side routing rule: at most 2 domains may be selected per decision. */
const MAX_ROUTE_DOMAINS = 2;

/**
 * Per-turn decision context. The per-turn P0/P1 budget counters are bound to
 * this object privately by the service (via a WeakMap); they are deliberately
 * NOT part of this public surface, so no caller can read or mutate them.
 */
export interface DecisionTurnContext {
    /** Caller-owned cancellation, forwarded to the port unchanged. */
    readonly signal: AbortSignal;
    /** Stable sampling key: the same key always produces the same sampling decision. */
    readonly sampleKey: string;
    /**
     * Whether this turn's branch is in {@link AgentDecisionConfig.allowedBranchIds}.
     * Fixed at creation from the config snapshot; an out-of-scope turn skips
     * every kind with zero port calls, in both shadow and enforce.
     */
    readonly inScope: boolean;
    /** Request-local, bounded observation collector. */
    readonly collector: DecisionTraceCollector;
}

export interface DecisionTurnOptions {
    readonly signal: AbortSignal;
    readonly sampleKey: string;
    /** Caller's tenant branch. Compared against config as a string (see String()). */
    readonly branchId: string;
}

/** Per-turn budget counters. Private to the service; never exposed on the context. */
interface DecisionTurnCounters {
    p0Used: number;
    p1Used: number;
}

function stableSampleValue(sampleKey: string): number {
    // FNV-1a 32-bit, mapped into 0..1. Deterministic across processes: the
    // same key always produces the same value, so for a given fraction the
    // same key always produces the same sampling decision.
    let hash = 0x811c9dc5;
    for (let index = 0; index < sampleKey.length; index += 1) {
        hash ^= sampleKey.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) / 0x100000000;
}

function isSampled(sampleKey: string, samplingFraction: number): boolean {
    return stableSampleValue(sampleKey) < samplingFraction;
}

function notEvaluated<TSelection>(
    baseline: TSelection | null,
    reason: DecisionFailureReason,
    profileVersion: string | null,
): DecisionPolicyResult<TSelection> {
    return {
        status: DECISION_STATUSES.notEvaluated,
        selection: null,
        baselineSelection: baseline,
        reason,
        profileVersion,
    };
}

/**
 * Off-by-default application façade over {@link AgentDecisionPort}.
 *
 * Contract for every façade method result: callers always apply
 * `result.selection ?? result.baselineSelection`. `selection` is non-null
 * only when the decision ran in enforce mode against a compatible profile
 * and was accepted; in every other state the caller keeps its baseline.
 */
@Injectable()
export class AgentDecisionService {
    private readonly turnCounters = new WeakMap<DecisionTurnContext, DecisionTurnCounters>();
    private inFlightCalls = 0;

    constructor(
        private readonly config: AgentDecisionConfigService,
        @Inject(AGENT_DECISION_PORT) private readonly port: AgentDecisionPort,
    ) {}

    /**
     * Deadline is resolved from config at creation time; a fresh collector
     * and fresh counters are bound per call, so no mutable state is shared
     * across turns.
     */
    async createTurnContext(options: DecisionTurnOptions): Promise<DecisionTurnContext> {
        const config = await this.config.getConfig();
        // Empty allowedBranchIds means nothing is in scope; String() keeps
        // the comparison stable regardless of the principal's branchId type.
        const inScope = config.allowedBranchIds.includes(String(options.branchId));
        const context: DecisionTurnContext = {
            signal: options.signal,
            sampleKey: options.sampleKey,
            inScope,
            collector: createDecisionTraceCollector(),
        };
        this.turnCounters.set(context, { p0Used: 0, p1Used: 0 });
        return context;
    }

    async routeDomains(
        ctx: DecisionTurnContext,
        input: {
            readonly text: string;
            readonly knownValues: readonly string[];
            readonly permittedDomains: readonly string[];
            readonly baseline: readonly string[];
        },
    ): Promise<DecisionPolicyResult<readonly string[]>> {
        return this.evaluate<readonly string[], DomainRoutingEvidence>({
            ctx,
            kind: DECISION_KINDS.routeDomains,
            tier: "p0",
            baseline: input.baseline,
            callPort: (deadlineAt: number): Promise<DomainRoutingEvidence> =>
                this.port.routeDomains({
                    kind: DECISION_KINDS.routeDomains,
                    questionVersion: DECISION_QUESTION_VERSION,
                    deadlineAt,
                    signal: ctx.signal,
                    redactedText: buildRedactedDecisionText(input.text, input.knownValues),
                    // Caller-supplied enabled set only — never widened from configuration.
                    permittedDomains: input.permittedDomains,
                } satisfies RouteDomainsRequest),
            // maxDomains stays the server-side rule of 2.
            applyPolicy: (evidence, profile) =>
                applyDomainRoutingPolicy(evidence, profile, {
                    permittedDomains: input.permittedDomains,
                    maxDomains: MAX_ROUTE_DOMAINS,
                    baseline: input.baseline,
                }),
        });
    }

    async classifyClientIntent(
        ctx: DecisionTurnContext,
        input: {
            readonly text: string;
            readonly knownValues: readonly string[];
            readonly baseline: ClientIntent | null;
        },
    ): Promise<DecisionPolicyResult<ClientIntent>> {
        return this.evaluate<ClientIntent, ClientIntentEvidence>({
            ctx,
            kind: DECISION_KINDS.classifyClientIntent,
            tier: "p0",
            baseline: input.baseline,
            callPort: (deadlineAt: number): Promise<ClientIntentEvidence> =>
                this.port.classifyClientIntent({
                    kind: DECISION_KINDS.classifyClientIntent,
                    questionVersion: DECISION_QUESTION_VERSION,
                    deadlineAt,
                    signal: ctx.signal,
                    redactedText: buildRedactedDecisionText(input.text, input.knownValues),
                } satisfies ClassifyClientIntentRequest),
            applyPolicy: (evidence, profile) => applyClientIntentPolicy(evidence, profile, input.baseline),
        });
    }

    async evaluateClarification(
        ctx: DecisionTurnContext,
        input: {
            readonly text: string;
            readonly knownValues: readonly string[];
            readonly missingFields: readonly string[];
            readonly targetConfirmed: boolean;
            readonly baseline: ClarificationAdvice | null;
        },
    ): Promise<DecisionPolicyResult<ClarificationAdvice>> {
        return this.evaluate<ClarificationAdvice, ClarificationEvidence>({
            ctx,
            kind: DECISION_KINDS.evaluateClarification,
            tier: "p1",
            baseline: input.baseline,
            callPort: (deadlineAt: number): Promise<ClarificationEvidence> =>
                this.port.evaluateClarification({
                    kind: DECISION_KINDS.evaluateClarification,
                    questionVersion: DECISION_QUESTION_VERSION,
                    deadlineAt,
                    signal: ctx.signal,
                    redactedText: buildRedactedDecisionText(input.text, input.knownValues),
                    missingFields: input.missingFields,
                    targetConfirmed: input.targetConfirmed,
                } satisfies EvaluateClarificationRequest),
            // Advice-only policy: it takes no baseline; in shadow mode the
            // caller baseline is restored by the shadow override below.
            applyPolicy: (evidence, profile) => applyClarificationPolicy(evidence, profile),
        });
    }

    async rankCandidates(
        ctx: DecisionTurnContext,
        input: {
            readonly text: string;
            readonly knownValues: readonly string[];
            readonly choiceSetRevision: string;
            readonly candidates: readonly CandidateProjection[];
            readonly baseline: string | null;
        },
    ): Promise<DecisionPolicyResult<string>> {
        return this.evaluate<string, CandidateEvidence>({
            ctx,
            kind: DECISION_KINDS.rankCandidates,
            tier: "p1",
            baseline: input.baseline,
            exceedsLimits: (config) => input.candidates.length > config.limits.maxCandidates,
            callPort: (deadlineAt: number): Promise<CandidateEvidence> =>
                this.port.rankCandidates({
                    kind: DECISION_KINDS.rankCandidates,
                    questionVersion: DECISION_QUESTION_VERSION,
                    deadlineAt,
                    signal: ctx.signal,
                    redactedText: buildRedactedDecisionText(input.text, input.knownValues),
                    choiceSetRevision: input.choiceSetRevision,
                    candidates: input.candidates.map((candidate) => ({
                        label: candidate.label,
                        facts: projectCandidateFacts(candidate.facts),
                    })),
                } satisfies RankCandidatesRequest),
            // Candidate labels/revision come from the request side, never the provider.
            applyPolicy: (evidence, profile) =>
                applyCandidatePolicy(evidence, profile, {
                    choiceSetRevision: input.choiceSetRevision,
                    candidateLabels: input.candidates.map((candidate) => candidate.label),
                    baseline: input.baseline,
                }),
        });
    }

    /**
     * Shared per-call sequence for all four kinds:
     * mode → branch scope → shadow sampling → priority budgets →
     * concurrency slot → provider call → observation → enforce gating →
     * policy application.
     */
    private async evaluate<TSelection, TEvidence extends DecisionEvidence>(args: {
        readonly ctx: DecisionTurnContext;
        readonly kind: DecisionKind;
        readonly tier: "p0" | "p1";
        readonly baseline: TSelection | null;
        /** Kind-specific request bound (e.g. candidate-set size). */
        readonly exceedsLimits?: (config: AgentDecisionConfig) => boolean;
        /** Receives the per-call deadline computed at admission time. */
        readonly callPort: (deadlineAt: number) => Promise<TEvidence>;
        readonly applyPolicy: (
            evidence: TEvidence,
            profile: DecisionAcceptanceProfile,
        ) => DecisionPolicyResult<TSelection>;
    }): Promise<DecisionPolicyResult<TSelection>> {
        const { ctx, kind, baseline } = args;

        // (1) Mode resolution. Off → not evaluated, zero port calls.
        const mode = await this.config.getKindMode(kind);
        if (mode === DECISION_MODES.off) {
            return notEvaluated(baseline, DECISION_FAILURE_REASONS.disabled, null);
        }

        // (1b) Branch scope. An out-of-scope turn is treated exactly like
        // disabled: zero port calls, in both shadow and enforce.
        if (!ctx.inScope) {
            return notEvaluated(baseline, DECISION_FAILURE_REASONS.disabled, null);
        }

        const config = await this.config.getConfig();

        // (2) Shadow sampling: deterministic per sampleKey. Enforce is never sampled.
        if (mode === DECISION_MODES.shadow && !isSampled(ctx.sampleKey, config.samplingFraction)) {
            return notEvaluated(baseline, DECISION_FAILURE_REASONS.notSampled, null);
        }

        // (3) Per-turn priority budgets. There is no pre-call turn-deadline
        // skip here: the deadline is per call, computed once a call is
        // actually admitted (below), never checked against the turn's start.
        const counters = this.countersFor(ctx);
        const cap = args.tier === "p0" ? config.limits.maxP0PerTurn : config.limits.maxP1PerTurn;
        const used = args.tier === "p0" ? counters.p0Used : counters.p1Used;
        if (used >= cap) {
            this.recordSkip(ctx, kind, mode, DECISION_FAILURE_REASONS.budgetExhausted);
            return notEvaluated(baseline, DECISION_FAILURE_REASONS.budgetExhausted, null);
        }
        // Kind-specific request bound (fail-closed, no port call, no budget consumed).
        if (args.exceedsLimits !== undefined && args.exceedsLimits(config)) {
            this.recordSkip(ctx, kind, mode, DECISION_FAILURE_REASONS.budgetExhausted);
            return notEvaluated(baseline, DECISION_FAILURE_REASONS.budgetExhausted, null);
        }

        // (4) Concurrency: at most maxConcurrentCalls provider calls in flight
        // per process. Saturated → skip, never queue.
        if (this.inFlightCalls >= config.limits.maxConcurrentCalls) {
            this.recordSkip(ctx, kind, mode, DECISION_FAILURE_REASONS.concurrencySaturated);
            return notEvaluated(baseline, DECISION_FAILURE_REASONS.concurrencySaturated, null);
        }

        // Budget consumption happens only for calls that actually run; a call
        // skipped by the concurrency gate does not burn the turn budget.
        if (args.tier === "p0") counters.p0Used += 1;
        else counters.p1Used += 1;
        this.inFlightCalls += 1;
        // (5) Per-call deadline, fixed at the moment the call is admitted —
        // not at turn-context creation, so a call queued behind other work
        // still gets a full budget from here.
        const callDeadlineAt = Date.now() + config.limits.turnDeadlineMs;
        try {
            // (6) Provider call. The adapter returns evidence and should never
            // throw; a throw is bounded to `unavailable`/`provider-error`.
            let evidence: TEvidence;
            try {
                evidence = await args.callPort(callDeadlineAt);
            } catch {
                return {
                    status: DECISION_STATUSES.unavailable,
                    selection: null,
                    baselineSelection: baseline,
                    reason: DECISION_FAILURE_REASONS.providerError,
                    profileVersion: null,
                };
            }

            // Resolved before the observation so the trace event and the
            // enforce gate see the same profile version.
            const profile = await this.config.getAcceptanceProfile(kind);

            // (7) Observation, in both shadow and enforce. The collector is
            // bounded and may reject — ignore the rejection; telemetry must
            // never throw into the decision path.
            this.recordObservation(ctx, evidence, mode, profile?.profileVersion ?? null);

            // (8) Enforce gating: never enforce without a compatible profile.
            if (mode === DECISION_MODES.enforce) {
                if (profile === null || isProfileCompatible(profile, evidence) !== null) {
                    // Callers apply `result.selection ?? result.baselineSelection`.
                    return {
                        status: DECISION_STATUSES.notEvaluated,
                        selection: null,
                        baselineSelection: baseline,
                        reason: DECISION_FAILURE_REASONS.ineligible,
                        profileVersion: profile?.profileVersion ?? null,
                    };
                }
                // (9)+(10) Policy applied; callers apply
                // `result.selection ?? result.baselineSelection`.
                return args.applyPolicy(evidence, profile);
            }

            // Shadow mode observes but never applies. Without a usable profile
            // there are no thresholds to observe with, so the outcome is
            // `ineligible`; nothing is ever selected.
            if (profile === null) {
                return notEvaluated(baseline, DECISION_FAILURE_REASONS.ineligible, null);
            }
            const observed = args.applyPolicy(evidence, profile);
            // Callers apply `result.selection ?? result.baselineSelection`;
            // in shadow that is always the caller's baseline.
            return { ...observed, selection: null, baselineSelection: baseline };
        } finally {
            this.inFlightCalls -= 1;
        }
    }

    /** Get-or-create: contexts always come from createTurnContext, which pre-registers. */
    private countersFor(ctx: DecisionTurnContext): DecisionTurnCounters {
        let counters = this.turnCounters.get(ctx);
        if (counters === undefined) {
            counters = { p0Used: 0, p1Used: 0 };
            this.turnCounters.set(ctx, counters);
        }
        return counters;
    }

    private recordObservation(
        ctx: DecisionTurnContext,
        evidence: DecisionEvidence,
        mode: DecisionMode,
        profileVersion: string | null,
    ): void {
        try {
            ctx.collector.record(toDecisionTraceEvent({
                evidence,
                mode,
                baselineEvidence: null,
                profileVersion,
                missing: false,
                droppedReason: null,
            }));
        } catch {
            // Telemetry failures are swallowed by contract.
        }
    }

    /**
     * Records exactly one trace event for a call skipped by a budget/
     * concurrency gate (never for `disabled`/`not-sampled`, which stay
     * unrecorded). Never throws into the decision path.
     */
    private recordSkip(
        ctx: DecisionTurnContext,
        kind: DecisionKind,
        mode: DecisionMode,
        reason: DecisionFailureReason,
    ): void {
        try {
            ctx.collector.record(buildSkipTraceEvent({
                decisionKind: kind,
                mode,
                questionVersion: DECISION_QUESTION_VERSION,
                reason,
            }));
        } catch {
            // Telemetry failures are swallowed by contract.
        }
    }
}
