import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    APIConnectionError,
    APITimeoutError,
    APIUserAbortError,
    AuthenticationError,
    BadRequestError,
    PermissionDeniedError,
    RateLimitError,
    TypeSafeClient,
    UnprocessableEntityError,
    choice,
    noul,
} from "@typesafe-ai/sdk";
import type {
    ChoiceCriteria,
    ChoiceQuestion,
    Fetch,
    NoulQuestion,
    Usage,
} from "@typesafe-ai/sdk";

import {
    CANDIDATE_OUTCOMES,
    CLIENT_INTENTS,
    DECISION_FAILURE_REASONS,
    DECISION_KINDS,
    DECISION_STATUSES,
    type CandidateEvidence,
    type CandidateOutcome,
    type ClarificationEvidence,
    type ClarificationJudgments,
    type ClientIntent,
    type ClientIntentEvidence,
    type DecisionEvidenceBase,
    type DecisionFailureReason,
    type DecisionStatus,
    type DecisionUsage,
    type DomainRoutingEvidence,
    type DomainScore,
} from "../../application/agent/decision/decision-contracts";
import type {
    ClassifyClientIntentRequest,
    EvaluateClarificationRequest,
    RankCandidatesRequest,
    RouteDomainsRequest,
} from "../../application/agent/decision/agent-decision.port";
import {
    CANDIDATE_OUTCOME_LABELS,
    CLARIFICATION_JUDGMENT_KEYS,
    CLARIFICATION_JUDGMENT_QUESTIONS,
    DECISION_QUESTION_CATALOG,
    DECISION_QUESTION_VERSION,
    routeDomainQuestion,
    type ClarificationJudgmentKey,
} from "../../application/agent/decision/decision-questions";
import type { AgentDecisionPort } from "../../application/agent/decision/agent-decision.port";

/**
 * TypeSafe/Jev adapter for {@link AgentDecisionPort}.
 *
 * This is the only file in the backend that may import the TypeSafe SDK.
 * Application and domain code depends on the port only.
 *
 * Bounded failure behavior:
 * - The pinned model id is explicit on every request; a moving alias can
 *   never be sent and a mismatched returned model is never accepted.
 * - Every request is single-attempt (`maxRetries: 0`) with a per-attempt
 *   timeout clamped to the caller's remaining turn deadline.
 * - A missing `TYPESAFE_API_KEY` degrades to `unavailable`/`auth-error`
 *   without constructing a client or touching the network; startup never
 *   breaks because the key is absent.
 * - Malformed provider output is validated field by field and mapped to the
 *   finite failure categories; SDK payloads are never logged or embedded in
 *   errors.
 *
 * Status contract: this adapter emits `accepted` (complete, validated
 * answers) or `unavailable` (provider/transport/validation failure). The
 * `abstain` status is reserved for the Phase 3 policy layer, which applies
 * acceptance thresholds on top of this evidence; the adapter has no
 * threshold policy of its own.
 */

/** Pinned, versioned Jev model. Never use the moving aliases. */
export const PINNED_MODEL_ID = "jev-1.13.0";

/** Upper bound for a single provider attempt, in milliseconds. */
export const MAX_ATTEMPT_TIMEOUT_MS = 5000;

/** DI token for an injected SDK `fetch` implementation (test seam). */
export const TYPESAFE_SDK_FETCH = Symbol("TYPESAFE_SDK_FETCH");

const TYPESAFE_API_KEY_ENV = "TYPESAFE_API_KEY";
const TYPESAFE_BASE_URL_ENV = "TYPESAFE_BASE_URL";

const INTENT_ANSWER_KEY = "intent";
const RANK_ANSWER_KEY = "rank";

/** Candidate `facts` are bounded before they enter the prompt state. */
const MAX_CANDIDATE_FACTS = 8;
const MAX_FACT_CHARS = 200;

const INTENT_LABELS: readonly ClientIntent[] = Object.values(CLIENT_INTENTS);
const INTENT_LABEL_SET = new Set<string>(INTENT_LABELS);

function isClientIntentLabel(label: string): label is ClientIntent {
    return INTENT_LABEL_SET.has(label);
}

/** Successful response context kept for evidence on partial failures. */
interface ResponseContext {
    readonly model: string;
    readonly usage: Usage | null;
    readonly requestId: string | null;
}

function isUnitInterval(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clamp the per-attempt timeout to the caller's remaining deadline. */
function attemptTimeoutMs(deadlineAt: number, now: number): number {
    const remaining = deadlineAt - now;
    return Math.min(Math.max(remaining, 1), MAX_ATTEMPT_TIMEOUT_MS);
}

function toEvidenceUsage(usage: Usage | null | undefined): DecisionUsage | null {
    if (!usage) return null;
    const input = usage.input_tokens;
    const output = usage.output_tokens;
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
    return { inputTokens: input, outputTokens: output };
}

/**
 * Finite error mapping. Messages are static; SDK payloads, prompts, and
 * response bodies are never carried through.
 */
function mapSdkFailure(err: unknown, callerAborted: boolean): DecisionFailureReason {
    if (callerAborted) return DECISION_FAILURE_REASONS.aborted;
    if (err instanceof APITimeoutError) return DECISION_FAILURE_REASONS.timeout;
    if (err instanceof APIUserAbortError) return DECISION_FAILURE_REASONS.aborted;
    if (err instanceof APIConnectionError) return DECISION_FAILURE_REASONS.transportError;
    if (err instanceof RateLimitError) return DECISION_FAILURE_REASONS.rateLimited;
    if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
        return DECISION_FAILURE_REASONS.authError;
    }
    if (err instanceof BadRequestError || err instanceof UnprocessableEntityError) {
        return DECISION_FAILURE_REASONS.providerError;
    }
    // Any other APIError or TypeSafeError, and unknown throws, land here.
    return DECISION_FAILURE_REASONS.providerError;
}

function isNoulAnswer(answer: unknown): answer is { type: "noul"; noul: number } {
    if (!isRecord(answer)) return false;
    return answer["type"] === "noul" && isUnitInterval(answer["noul"]);
}

function isChoiceAnswer(
    answer: unknown,
): answer is { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> } {
    if (!isRecord(answer)) return false;
    if (answer["type"] !== "choice") return false;
    return typeof answer["choice"] === "string" && isRecord(answer["probabilities"]);
}

/**
 * Argmax over a probability map; missing or non-finite entries are ignored.
 * Callers must first reject any map that carries a label outside the
 * question's criteria, so this only ever runs over criteria-clean maps.
 * Ties keep the first label in iteration order (strict `>` comparison, no
 * replacement on equal values) — the deterministic tie behavior this
 * adapter has always had.
 */
function argmaxLabel(probabilities: Record<string, number | undefined>): string | null {
    let best: string | null = null;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const [label, value] of Object.entries(probabilities)) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (best === null || value > bestValue) {
            best = label;
            bestValue = value;
        }
    }
    return best;
}

function intentCriteria(): ChoiceCriteria {
    const criteria: ChoiceCriteria = {};
    for (const label of INTENT_LABELS) criteria[label] = null;
    return criteria;
}

function boundedFacts(facts: readonly string[]): string[] {
    return facts
        .slice(0, MAX_CANDIDATE_FACTS)
        .map((fact) => fact.slice(0, MAX_FACT_CHARS));
}

@Injectable()
export class TypeSafeJevDecisionService implements AgentDecisionPort {
    private client: TypeSafeClient | null = null;
    private clientApiKey: string | null = null;
    private clientBaseUrl: string | null = null;

    constructor(
        private readonly configService: ConfigService,
        @Optional() @Inject(TYPESAFE_SDK_FETCH) private readonly fetchImpl?: Fetch,
    ) {}

    async routeDomains(request: RouteDomainsRequest): Promise<DomainRoutingEvidence> {
        const startedAt = Date.now();
        const failure = (
            reason: DecisionFailureReason,
            response: ResponseContext | null = null,
        ): DomainRoutingEvidence => ({
            kind: DECISION_KINDS.routeDomains,
            ...this.evidenceBase(startedAt, DECISION_STATUSES.unavailable, reason, response),
            domains: [],
        });

        if (request.deadlineAt <= startedAt) return failure(DECISION_FAILURE_REASONS.timeout);

        const apiKey = this.readApiKey();
        if (apiKey === null) return failure(DECISION_FAILURE_REASONS.authError);

        // No permitted domains means no answers are required: vacuously
        // complete without a provider call (the SDK rejects empty question
        // sets).
        if (request.permittedDomains.length === 0) {
            return {
                kind: DECISION_KINDS.routeDomains,
                ...this.evidenceBase(startedAt, DECISION_STATUSES.accepted, null, null),
                domains: [],
            };
        }

        // Fail closed BEFORE constructing the client or making any provider
        // call when any permitted domain has no question text. Here
        // `question-mismatch` means "no question text for a permitted
        // domain" (the same failure token is also used for profile/evidence
        // version mismatch elsewhere) — this is not a new failure reason.
        const domainQuestions: Record<string, string> = {};
        for (const domain of request.permittedDomains) {
            const text = routeDomainQuestion(domain);
            if (text === null) return failure(DECISION_FAILURE_REASONS.questionMismatch);
            domainQuestions[domain] = text;
        }

        const questions: Record<string, NoulQuestion> = {};
        for (const domain of request.permittedDomains) {
            questions[domain] = noul(domainQuestions[domain]);
        }

        try {
            const client = this.clientFor(apiKey);
            const { data, requestId } = await client
                .systemOne(
                    {
                        state: { text: request.redactedText },
                        questions,
                        model: PINNED_MODEL_ID,
                    },
                    {
                        signal: request.signal,
                        timeout: attemptTimeoutMs(request.deadlineAt, startedAt),
                        retry: { maxRetries: 0 },
                    },
                )
                .withResponse();

            const response: ResponseContext = {
                model: data.model,
                usage: data.usage,
                requestId: requestId ?? null,
            };
            if (data.model !== PINNED_MODEL_ID) {
                return failure(DECISION_FAILURE_REASONS.modelMismatch, response);
            }

            const domains: DomainScore[] = [];
            for (const domain of request.permittedDomains) {
                const answer = data.answers[domain];
                if (!isNoulAnswer(answer)) {
                    return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
                }
                domains.push({ domain, yesProbability: answer.noul });
            }

            return {
                kind: DECISION_KINDS.routeDomains,
                ...this.evidenceBase(startedAt, DECISION_STATUSES.accepted, null, response),
                domains,
            };
        } catch (err) {
            return failure(mapSdkFailure(err, request.signal.aborted));
        }
    }

    async classifyClientIntent(request: ClassifyClientIntentRequest): Promise<ClientIntentEvidence> {
        const startedAt = Date.now();
        const failure = (
            reason: DecisionFailureReason,
            response: ResponseContext | null = null,
        ): ClientIntentEvidence => ({
            kind: DECISION_KINDS.classifyClientIntent,
            ...this.evidenceBase(startedAt, DECISION_STATUSES.unavailable, reason, response),
            intent: null,
            probabilities: {},
            confidence: null,
        });

        if (request.deadlineAt <= startedAt) return failure(DECISION_FAILURE_REASONS.timeout);

        const apiKey = this.readApiKey();
        if (apiKey === null) return failure(DECISION_FAILURE_REASONS.authError);

        const catalog = DECISION_QUESTION_CATALOG[DECISION_KINDS.classifyClientIntent];
        const questions: Record<string, ChoiceQuestion<ChoiceCriteria>> = {
            [INTENT_ANSWER_KEY]: choice(catalog.questionText, intentCriteria()),
        };

        try {
            const client = this.clientFor(apiKey);
            const { data, requestId } = await client
                .systemOne(
                    {
                        state: { text: request.redactedText },
                        questions,
                        model: PINNED_MODEL_ID,
                    },
                    {
                        signal: request.signal,
                        timeout: attemptTimeoutMs(request.deadlineAt, startedAt),
                        retry: { maxRetries: 0 },
                    },
                )
                .withResponse();

            const response: ResponseContext = {
                model: data.model,
                usage: data.usage,
                requestId: requestId ?? null,
            };
            if (data.model !== PINNED_MODEL_ID) {
                return failure(DECISION_FAILURE_REASONS.modelMismatch, response);
            }

            const answer = data.answers[INTENT_ANSWER_KEY];
            if (!isChoiceAnswer(answer)) {
                return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
            }
            // Strict label validation: the provider is given exactly this
            // question's criteria (the five intent labels), so any returned
            // label outside them makes the whole answer untrustworthy
            // (AC-02: unknown labels never become accepted decisions).
            // Dropping an off-catalog label and continuing could turn a
            // rejection into an acceptance, so the full answer is rejected.
            for (const label of Object.keys(answer.probabilities)) {
                if (!INTENT_LABEL_SET.has(label)) {
                    return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
                }
            }
            if (!isClientIntentLabel(answer.choice)) {
                return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
            }

            // A choice answer must carry an entry for every criteria label:
            // the evidence probabilities end up criteria-complete.
            const probabilities: Partial<Record<ClientIntent, number>> = {};
            for (const label of INTENT_LABELS) {
                const value = answer.probabilities[label];
                if (value === undefined) {
                    return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
                }
                if (!isUnitInterval(value)) {
                    return failure(DECISION_FAILURE_REASONS.invalidScore, response);
                }
                probabilities[label] = value;
            }

            // Self-contradictory evidence: the chosen label must also be the
            // argmax of the returned probabilities map (criteria-complete by
            // the validation above). Ties keep the first criteria label in
            // INTENT_LABELS order via the deterministic `>` comparison in
            // `argmaxLabel`.
            if (argmaxLabel(probabilities) !== answer.choice) {
                return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
            }

            const confidence = isUnitInterval(answer.confidence) ? answer.confidence : null;

            return {
                kind: DECISION_KINDS.classifyClientIntent,
                ...this.evidenceBase(startedAt, DECISION_STATUSES.accepted, null, response),
                intent: answer.choice,
                probabilities,
                confidence,
            };
        } catch (err) {
            return failure(mapSdkFailure(err, request.signal.aborted));
        }
    }

    async evaluateClarification(
        request: EvaluateClarificationRequest,
    ): Promise<ClarificationEvidence> {
        const startedAt = Date.now();
        const failure = (
            reason: DecisionFailureReason,
            response: ResponseContext | null = null,
        ): ClarificationEvidence => ({
            kind: DECISION_KINDS.evaluateClarification,
            ...this.evidenceBase(startedAt, DECISION_STATUSES.unavailable, reason, response),
            judgments: null,
        });

        if (request.deadlineAt <= startedAt) return failure(DECISION_FAILURE_REASONS.timeout);

        const apiKey = this.readApiKey();
        if (apiKey === null) return failure(DECISION_FAILURE_REASONS.authError);

        const questions: Record<string, NoulQuestion> = {};
        for (const key of CLARIFICATION_JUDGMENT_KEYS) {
            questions[key] = noul(CLARIFICATION_JUDGMENT_QUESTIONS[key]);
        }

        try {
            const client = this.clientFor(apiKey);
            const { data, requestId } = await client
                .systemOne(
                    {
                        state: {
                            text: request.redactedText,
                            missingFields: [...request.missingFields],
                            targetConfirmed: request.targetConfirmed,
                        },
                        questions,
                        model: PINNED_MODEL_ID,
                    },
                    {
                        signal: request.signal,
                        timeout: attemptTimeoutMs(request.deadlineAt, startedAt),
                        retry: { maxRetries: 0 },
                    },
                )
                .withResponse();

            const response: ResponseContext = {
                model: data.model,
                usage: data.usage,
                requestId: requestId ?? null,
            };
            if (data.model !== PINNED_MODEL_ID) {
                return failure(DECISION_FAILURE_REASONS.modelMismatch, response);
            }

            const readProbability = (key: ClarificationJudgmentKey): number | null => {
                const answer = data.answers[key];
                if (!isNoulAnswer(answer)) return null;
                return answer.noul;
            };
            const mutationRequested = readProbability("mutationRequested");
            const targetUnambiguous = readProbability("targetUnambiguous");
            const valueUnambiguous = readProbability("valueUnambiguous");
            const sufficientEvidence = readProbability("sufficientEvidence");
            const clarificationRequired = readProbability("clarificationRequired");

            if (
                mutationRequested === null
                || targetUnambiguous === null
                || valueUnambiguous === null
                || sufficientEvidence === null
                || clarificationRequired === null
            ) {
                return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
            }

            const judgments: ClarificationJudgments = {
                mutationRequested,
                targetUnambiguous,
                valueUnambiguous,
                sufficientEvidence,
                clarificationRequired,
            };

            return {
                kind: DECISION_KINDS.evaluateClarification,
                ...this.evidenceBase(startedAt, DECISION_STATUSES.accepted, null, response),
                judgments,
            };
        } catch (err) {
            return failure(mapSdkFailure(err, request.signal.aborted));
        }
    }

    async rankCandidates(request: RankCandidatesRequest): Promise<CandidateEvidence> {
        const startedAt = Date.now();
        const failure = (
            reason: DecisionFailureReason,
            response: ResponseContext | null = null,
        ): CandidateEvidence => ({
            kind: DECISION_KINDS.rankCandidates,
            ...this.evidenceBase(startedAt, DECISION_STATUSES.unavailable, reason, response),
            outcome: null,
            suggestion: null,
            choiceSetRevision: request.choiceSetRevision,
            probabilities: {},
        });

        if (request.deadlineAt <= startedAt) return failure(DECISION_FAILURE_REASONS.timeout);

        const apiKey = this.readApiKey();
        if (apiKey === null) return failure(DECISION_FAILURE_REASONS.authError);

        const candidateLabels = request.candidates.map((candidate) => candidate.label);
        const labels = [...candidateLabels, ...CANDIDATE_OUTCOME_LABELS];
        const labelSet = new Set(labels);
        const candidateSet = new Set(candidateLabels);

        const catalog = DECISION_QUESTION_CATALOG[DECISION_KINDS.rankCandidates];
        const criteria: ChoiceCriteria = {};
        for (const label of labels) criteria[label] = null;
        const questions: Record<string, ChoiceQuestion<ChoiceCriteria>> = {
            [RANK_ANSWER_KEY]: choice(catalog.questionText, criteria),
        };

        try {
            const client = this.clientFor(apiKey);
            const { data, requestId } = await client
                .systemOne(
                    {
                        state: {
                            text: request.redactedText,
                            candidates: request.candidates.map((candidate) => ({
                                label: candidate.label,
                                facts: boundedFacts(candidate.facts),
                            })),
                        },
                        questions,
                        model: PINNED_MODEL_ID,
                    },
                    {
                        signal: request.signal,
                        timeout: attemptTimeoutMs(request.deadlineAt, startedAt),
                        retry: { maxRetries: 0 },
                    },
                )
                .withResponse();

            const response: ResponseContext = {
                model: data.model,
                usage: data.usage,
                requestId: requestId ?? null,
            };
            if (data.model !== PINNED_MODEL_ID) {
                return failure(DECISION_FAILURE_REASONS.modelMismatch, response);
            }

            const answer = data.answers[RANK_ANSWER_KEY];
            if (!isChoiceAnswer(answer)) {
                return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
            }
            // Strict label validation (same rule as intent classification):
            // any returned label outside the criteria supplied for this
            // question (the candidate labels plus `none` and
            // `insufficient_evidence`) makes the whole answer untrustworthy.
            // The answer is rejected, never trimmed to the known labels.
            for (const label of Object.keys(answer.probabilities)) {
                if (!labelSet.has(label)) {
                    return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
                }
            }
            if (!labelSet.has(answer.choice)) {
                return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
            }

            // A choice answer must carry an entry for every criteria label:
            // the evidence probabilities end up criteria-complete.
            const probabilities: Record<string, number> = {};
            for (const label of labelSet) {
                const value = answer.probabilities[label];
                if (value === undefined) {
                    return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
                }
                if (!isUnitInterval(value)) {
                    return failure(DECISION_FAILURE_REASONS.invalidScore, response);
                }
                probabilities[label] = value;
            }

            // The chosen label must also be the argmax of the returned map
            // (ties keep the first label in `labelSet` insertion order via
            // the deterministic `>` comparison in `argmaxLabel`).
            if (argmaxLabel(probabilities) !== answer.choice) {
                return failure(DECISION_FAILURE_REASONS.invalidOutput, response);
            }

            const isMatch = candidateSet.has(answer.choice);
            const outcome: CandidateOutcome = isMatch
                ? CANDIDATE_OUTCOMES.match
                : answer.choice === CANDIDATE_OUTCOMES.none
                    ? CANDIDATE_OUTCOMES.none
                    : CANDIDATE_OUTCOMES.insufficientEvidence;

            return {
                kind: DECISION_KINDS.rankCandidates,
                ...this.evidenceBase(startedAt, DECISION_STATUSES.accepted, null, response),
                outcome,
                suggestion: isMatch ? answer.choice : null,
                choiceSetRevision: request.choiceSetRevision,
                probabilities,
            };
        } catch (err) {
            return failure(mapSdkFailure(err, request.signal.aborted));
        }
    }

    private readApiKey(): string | null {
        const value = this.configService.get<string>(TYPESAFE_API_KEY_ENV);
        if (typeof value !== "string" || value.trim().length === 0) return null;
        return value;
    }

    private readBaseUrl(): string | null {
        const value = this.configService.get<string>(TYPESAFE_BASE_URL_ENV);
        if (typeof value !== "string" || value.trim().length === 0) return null;
        return value;
    }

    /**
     * Lazily construct (and cache) the client. The SDK constructor throws
     * when the key is missing, so every caller checks `readApiKey()` first;
     * a construction failure with a present key maps to `provider-error`.
     */
    private clientFor(apiKey: string): TypeSafeClient {
        const baseURL = this.readBaseUrl();
        if (
            this.client !== null
            && this.clientApiKey === apiKey
            && this.clientBaseUrl === baseURL
        ) {
            return this.client;
        }
        const client = new TypeSafeClient({
            apiKey,
            ...(baseURL !== null ? { baseURL } : {}),
            defaultModel: PINNED_MODEL_ID,
            logLevel: "off",
            ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
        });
        this.client = client;
        this.clientApiKey = apiKey;
        this.clientBaseUrl = baseURL;
        return client;
    }

    private evidenceBase(
        startedAt: number,
        status: DecisionStatus,
        failureReason: DecisionFailureReason | null,
        response: ResponseContext | null,
    ): Omit<DecisionEvidenceBase, "kind"> {
        return {
            questionVersion: DECISION_QUESTION_VERSION,
            requestedModel: PINNED_MODEL_ID,
            returnedModel: response?.model ?? null,
            latencyMs: Date.now() - startedAt,
            providerRequestId: response?.requestId ?? null,
            usage: toEvidenceUsage(response?.usage),
            status,
            failureReason,
        };
    }
}
