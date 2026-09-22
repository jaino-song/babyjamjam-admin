import { ConfigService } from "@nestjs/config";
import type { Fetch } from "@typesafe-ai/sdk";

import {
    CANDIDATE_OUTCOMES,
    DECISION_FAILURE_REASONS,
    DECISION_KINDS,
    DECISION_STATUSES,
    type ClientIntent,
} from "../../application/agent/decision/decision-contracts";
import {
    CLARIFICATION_JUDGMENT_KEYS,
    DECISION_QUESTION_VERSION,
} from "../../application/agent/decision/decision-questions";
import type {
    ClassifyClientIntentRequest,
    EvaluateClarificationRequest,
    RankCandidatesRequest,
    RouteDomainsRequest,
} from "../../application/agent/decision/agent-decision.port";
import { PINNED_MODEL_ID, TypeSafeJevDecisionService } from "./typesafe-jev-decision.service";

/**
 * All transport is stubbed through the SDK's custom `fetch` seam
 * (injected via TYPESAFE_SDK_FETCH); no test touches the network.
 */

const TEST_BASE_URL = "https://typesafe.test";
const TEST_API_KEY = "test-key";

const JSON_HEADERS = { "content-type": "application/json" };

interface RecordedCall {
    readonly url: string;
    readonly init: RequestInit;
}

function requireDefined<T>(value: T | undefined | null): T {
    if (value === undefined || value === null) throw new Error("expected a value in test");
    return value;
}

function jsonResponse(
    body: string | unknown,
    status = 200,
    requestId?: string,
): Response {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, {
        status,
        headers: {
            ...JSON_HEADERS,
            ...(requestId ? { "x-typesafe-request-id": requestId } : {}),
        },
    });
}

interface StubResult {
    readonly fetch: Fetch;
    readonly calls: RecordedCall[];
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): StubResult {
    const calls: RecordedCall[] = [];
    const fetch: Fetch = async (url, init) => {
        const resolvedInit = init ?? {};
        calls.push({ url, init: resolvedInit });
        return handler(url, resolvedInit);
    };
    return { fetch, calls };
}

function systemOneBody(answers: unknown, model = PINNED_MODEL_ID): unknown {
    return {
        answers,
        model,
        usage: { input_tokens: 120, output_tokens: 30 },
    };
}

function baseRequest() {
    return {
        questionVersion: DECISION_QUESTION_VERSION,
        deadlineAt: Date.now() + 5000,
        signal: new AbortController().signal,
    };
}

function routeDomainsRequest(
    overrides: Partial<Omit<RouteDomainsRequest, "kind">> = {},
): RouteDomainsRequest {
    return {
        ...baseRequest(),
        kind: DECISION_KINDS.routeDomains,
        redactedText: "고객 문의 텍스트",
        permittedDomains: ["grooming", "scheduling"],
        ...overrides,
    };
}

function classifyIntentRequest(
    overrides: Partial<Omit<ClassifyClientIntentRequest, "kind">> = {},
): ClassifyClientIntentRequest {
    return {
        ...baseRequest(),
        kind: DECISION_KINDS.classifyClientIntent,
        redactedText: "고객 문의 텍스트",
        ...overrides,
    };
}

function clarificationRequest(
    overrides: Partial<Omit<EvaluateClarificationRequest, "kind">> = {},
): EvaluateClarificationRequest {
    return {
        ...baseRequest(),
        kind: DECISION_KINDS.evaluateClarification,
        redactedText: "고객 문의 텍스트",
        missingFields: ["visitDate"],
        targetConfirmed: true,
        ...overrides,
    };
}

function rankCandidatesRequest(
    overrides: Partial<Omit<RankCandidatesRequest, "kind">> = {},
): RankCandidatesRequest {
    return {
        ...baseRequest(),
        kind: DECISION_KINDS.rankCandidates,
        redactedText: "고객 문의 텍스트",
        choiceSetRevision: "rev-7",
        candidates: [
            { label: "cand-1", facts: ["fact one"] },
            { label: "cand-2", facts: ["fact two"] },
        ],
        ...overrides,
    };
}

function serviceWith(fetch: Fetch, env: Record<string, string> = {}): TypeSafeJevDecisionService {
    return new TypeSafeJevDecisionService(
        new ConfigService({ TYPESAFE_API_KEY: TEST_API_KEY, TYPESAFE_BASE_URL: TEST_BASE_URL, ...env }),
        fetch,
    );
}

describe("TypeSafeJevDecisionService", () => {
    describe("routeDomains", () => {
        it("accepts complete noul answers in the requested domain order", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    grooming: { type: "noul", noul: 0.9 },
                    scheduling: { type: "noul", noul: 0.1 },
                }),
                200,
                "req-123",
            ));
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.kind).toBe(DECISION_KINDS.routeDomains);
            expect(evidence.status).toBe(DECISION_STATUSES.accepted);
            expect(evidence.failureReason).toBeNull();
            expect(evidence.questionVersion).toBe(DECISION_QUESTION_VERSION);
            expect(evidence.requestedModel).toBe(PINNED_MODEL_ID);
            expect(evidence.returnedModel).toBe(PINNED_MODEL_ID);
            expect(evidence.providerRequestId).toBe("req-123");
            expect(evidence.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
            expect(evidence.latencyMs).toBeGreaterThanOrEqual(0);
            expect(evidence.domains).toEqual([
                { domain: "grooming", yesProbability: 0.9 },
                { domain: "scheduling", yesProbability: 0.1 },
            ]);
        });

        it("sends the pinned model, catalog question text, and domain-keyed questions", async () => {
            const { fetch, calls } = stubFetch(() => jsonResponse(
                systemOneBody({
                    grooming: { type: "noul", noul: 0.5 },
                    scheduling: { type: "noul", noul: 0.5 },
                }),
            ));
            const service = serviceWith(fetch);

            await service.routeDomains(routeDomainsRequest());

            const call = requireDefined(calls[0]);
            expect(call.url).toBe(`${TEST_BASE_URL}/v1/systemone`);
            expect(call.init.method).toBe("POST");
            const body = JSON.parse(String(call.init.body)) as {
                model: string;
                state: { text: string };
                questions: Record<string, unknown>;
            };
            expect(body.model).toBe(PINNED_MODEL_ID);
            expect(body.model).not.toBe("jev-latest");
            expect(body.model).not.toBe("jev-preview");
            expect(body.state).toEqual({ text: "고객 문의 텍스트" });
            expect(Object.keys(body.questions).sort()).toEqual(["grooming", "scheduling"]);
        });

        it("returns invalid-output when a domain answer is missing", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({ grooming: { type: "noul", noul: 0.9 } }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
            expect(evidence.domains).toEqual([]);
            expect(evidence.returnedModel).toBe(PINNED_MODEL_ID);
        });

        it("returns invalid-output when an answer has the wrong type", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    grooming: { type: "choice", choice: "x", confidence: 1, probabilities: {} },
                    scheduling: { type: "noul", noul: 0.1 },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
            expect(evidence.domains).toEqual([]);
        });

        it("returns invalid-output for a non-finite probability", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                '{"answers":{"grooming":{"type":"noul","noul":1e999},"scheduling":{"type":"noul","noul":0.1}},"model":"jev-1.13.0","usage":{"input_tokens":1,"output_tokens":1}}',
            ));
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
            expect(evidence.domains).toEqual([]);
        });

        it("returns invalid-output for an out-of-range probability", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    grooming: { type: "noul", noul: 1.5 },
                    scheduling: { type: "noul", noul: 0.1 },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
            expect(evidence.domains).toEqual([]);
        });

        it("accepts an empty permitted-domain list without calling the provider", async () => {
            const { fetch, calls } = stubFetch(() => {
                throw new Error("provider must not be called");
            });
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(routeDomainsRequest({ permittedDomains: [] }));

            expect(evidence.status).toBe(DECISION_STATUSES.accepted);
            expect(evidence.domains).toEqual([]);
            expect(calls).toHaveLength(0);
        });
    });

    describe("classifyClientIntent", () => {
        it("accepts a consistent choice answer with validated probabilities", async () => {
            const { fetch, calls } = stubFetch(() => jsonResponse(
                systemOneBody({
                    intent: {
                        type: "choice",
                        choice: "create",
                        confidence: 0.8,
                        probabilities: {
                            create: 0.7,
                            update_related: 0.2,
                            read: 0.05,
                            ambiguous: 0.03,
                            unrelated: 0.02,
                            mystery_label: 0.9,
                        },
                    },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.classifyClientIntent(classifyIntentRequest());

            expect(evidence.kind).toBe(DECISION_KINDS.classifyClientIntent);
            expect(evidence.status).toBe(DECISION_STATUSES.accepted);
            expect(evidence.intent).toBe<ClientIntent>("create");
            expect(evidence.probabilities).toEqual({
                create: 0.7,
                update_related: 0.2,
                read: 0.05,
                ambiguous: 0.03,
                unrelated: 0.02,
            });
            expect(evidence.confidence).toBe(0.8);
            expect(evidence.returnedModel).toBe(PINNED_MODEL_ID);

            const call = requireDefined(calls[0]);
            const body = JSON.parse(String(call.init.body)) as {
                questions: Record<string, { type: string }>;
            };
            expect(Object.keys(body.questions)).toEqual(["intent"]);
        });

        it("returns invalid-output for an unknown intent label", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    intent: {
                        type: "choice",
                        choice: "delete",
                        confidence: 0.9,
                        probabilities: { create: 0.5, delete: 0.5 },
                    },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.classifyClientIntent(classifyIntentRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
            expect(evidence.intent).toBeNull();
            expect(evidence.probabilities).toEqual({});
        });

        it("returns unavailable invalid-output when the choice is not the argmax", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    intent: {
                        type: "choice",
                        choice: "create",
                        confidence: 0.9,
                        probabilities: {
                            create: 0.3,
                            update_related: 0.5,
                            read: 0.1,
                            ambiguous: 0.05,
                            unrelated: 0.05,
                        },
                    },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.classifyClientIntent(classifyIntentRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
            expect(evidence.intent).toBeNull();
            expect(evidence.confidence).toBeNull();
        });

        it("returns invalid-score for a non-finite probability on a known label", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                '{"answers":{"intent":{"type":"choice","choice":"create","confidence":0.9,"probabilities":{"create":1e999,"read":0.1}}},"model":"jev-1.13.0","usage":{"input_tokens":1,"output_tokens":1}}',
            ));
            const service = serviceWith(fetch);

            const evidence = await service.classifyClientIntent(classifyIntentRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidScore);
            expect(evidence.intent).toBeNull();
        });

        it("returns invalid-output when the answer type is wrong", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({ intent: { type: "noul", noul: 0.5 } }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.classifyClientIntent(classifyIntentRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
        });

        it("clamps out-of-range confidence to null while staying accepted", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    intent: {
                        type: "choice",
                        choice: "read",
                        confidence: 5,
                        probabilities: { read: 0.9, create: 0.1 },
                    },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.classifyClientIntent(classifyIntentRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.accepted);
            expect(evidence.intent).toBe("read");
            expect(evidence.confidence).toBeNull();
        });
    });

    describe("evaluateClarification", () => {
        it("accepts five validated judgments", async () => {
            const { fetch, calls } = stubFetch(() => jsonResponse(
                systemOneBody({
                    mutationRequested: { type: "noul", noul: 0.8 },
                    targetUnambiguous: { type: "noul", noul: 0.7 },
                    valueUnambiguous: { type: "noul", noul: 0.6 },
                    sufficientEvidence: { type: "noul", noul: 0.5 },
                    clarificationRequired: { type: "noul", noul: 0.4 },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.evaluateClarification(clarificationRequest());

            expect(evidence.kind).toBe(DECISION_KINDS.evaluateClarification);
            expect(evidence.status).toBe(DECISION_STATUSES.accepted);
            expect(evidence.judgments).toEqual({
                mutationRequested: 0.8,
                targetUnambiguous: 0.7,
                valueUnambiguous: 0.6,
                sufficientEvidence: 0.5,
                clarificationRequired: 0.4,
            });

            const call = requireDefined(calls[0]);
            const body = JSON.parse(String(call.init.body)) as {
                state: { text: string; missingFields: string[]; targetConfirmed: boolean };
                questions: Record<string, unknown>;
            };
            expect(body.state.text).toBe("고객 문의 텍스트");
            expect(body.state.missingFields).toEqual(["visitDate"]);
            expect(body.state.targetConfirmed).toBe(true);
            expect(Object.keys(body.questions).sort()).toEqual(
                [...CLARIFICATION_JUDGMENT_KEYS].sort(),
            );
        });

        it("returns invalid-output when a judgment answer is missing", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    mutationRequested: { type: "noul", noul: 0.8 },
                    targetUnambiguous: { type: "noul", noul: 0.7 },
                    valueUnambiguous: { type: "noul", noul: 0.6 },
                    sufficientEvidence: { type: "noul", noul: 0.5 },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.evaluateClarification(clarificationRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
            expect(evidence.judgments).toBeNull();
        });
    });

    describe("rankCandidates", () => {
        it("accepts a candidate match and echoes the choice-set revision", async () => {
            const { fetch, calls } = stubFetch(() => jsonResponse(
                systemOneBody({
                    rank: {
                        type: "choice",
                        choice: "cand-2",
                        confidence: 0.9,
                        probabilities: {
                            "cand-1": 0.2,
                            "cand-2": 0.6,
                            none: 0.15,
                            insufficient_evidence: 0.05,
                        },
                    },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.rankCandidates(rankCandidatesRequest());

            expect(evidence.kind).toBe(DECISION_KINDS.rankCandidates);
            expect(evidence.status).toBe(DECISION_STATUSES.accepted);
            expect(evidence.outcome).toBe(CANDIDATE_OUTCOMES.match);
            expect(evidence.suggestion).toBe("cand-2");
            expect(evidence.choiceSetRevision).toBe("rev-7");
            expect(evidence.probabilities).toEqual({
                "cand-1": 0.2,
                "cand-2": 0.6,
                none: 0.15,
                insufficient_evidence: 0.05,
            });

            const call = requireDefined(calls[0]);
            const body = JSON.parse(String(call.init.body)) as {
                state: { candidates: Array<{ label: string; facts: string[] }> };
                questions: Record<string, { type: string }>;
            };
            expect(body.state.candidates).toEqual([
                { label: "cand-1", facts: ["fact one"] },
                { label: "cand-2", facts: ["fact two"] },
            ]);
            expect(Object.keys(body.questions)).toEqual(["rank"]);
            expect(body.questions["rank"]?.type).toBe("choice");
        });

        it("reports a fixed outcome label with no suggestion", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    rank: {
                        type: "choice",
                        choice: "none",
                        confidence: 0.7,
                        probabilities: { "cand-1": 0.1, "cand-2": 0.1, none: 0.7, insufficient_evidence: 0.1 },
                    },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.rankCandidates(rankCandidatesRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.accepted);
            expect(evidence.outcome).toBe(CANDIDATE_OUTCOMES.none);
            expect(evidence.suggestion).toBeNull();
        });

        it("reports insufficient_evidence without a suggestion", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    rank: {
                        type: "choice",
                        choice: "insufficient_evidence",
                        confidence: 0.6,
                        probabilities: { "cand-1": 0.3, "cand-2": 0.1, none: 0.1, insufficient_evidence: 0.5 },
                    },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.rankCandidates(rankCandidatesRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.accepted);
            expect(evidence.outcome).toBe("insufficient_evidence");
            expect(evidence.suggestion).toBeNull();
        });

        it("returns invalid-output for an unknown chosen label", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody({
                    rank: {
                        type: "choice",
                        choice: "cand-99",
                        confidence: 0.9,
                        probabilities: { "cand-99": 0.9 },
                    },
                }),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.rankCandidates(rankCandidatesRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidOutput);
            expect(evidence.outcome).toBeNull();
            expect(evidence.suggestion).toBeNull();
            expect(evidence.choiceSetRevision).toBe("rev-7");
        });

        it("returns invalid-score for a non-finite probability on a known label", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                '{"answers":{"rank":{"type":"choice","choice":"cand-1","confidence":0.9,"probabilities":{"cand-1":1e999}}},"model":"jev-1.13.0","usage":{"input_tokens":1,"output_tokens":1}}',
            ));
            const service = serviceWith(fetch);

            const evidence = await service.rankCandidates(rankCandidatesRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.invalidScore);
        });
    });

    describe("bounded failure behavior", () => {
        it("maps HTTP 429 to rate-limited", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                { error: { message: "rate limited" } },
                429,
            ));
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.rateLimited);
            expect(evidence.returnedModel).toBeNull();
            expect(evidence.usage).toBeNull();
            expect(evidence.providerRequestId).toBeNull();
            expect(evidence.domains).toEqual([]);
        });

        it("maps an attempt timeout to timeout", async () => {
            // Mimics real fetch: never resolves on its own, but rejects when
            // the (SDK-owned) signal aborts. The SDK's per-attempt timer
            // fires, the fake fetch rejects, and the SDK raises
            // APITimeoutError, which maps to `timeout`.
            const { fetch, calls } = stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
                const signal = init.signal;
                if (!signal) return;
                if (signal.aborted) {
                    reject(new Error("aborted"));
                    return;
                }
                signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            }));
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(
                routeDomainsRequest({ deadlineAt: Date.now() + 80 }),
            );

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.timeout);
            expect(evidence.returnedModel).toBeNull();
            expect(evidence.usage).toBeNull();
            expect(evidence.domains).toEqual([]);
            expect(calls).toHaveLength(1);
        });

        it("maps a caller abort to aborted", async () => {
            const { fetch, calls } = stubFetch(() => jsonResponse(systemOneBody({})));
            const service = serviceWith(fetch);
            const controller = new AbortController();
            controller.abort();

            const evidence = await service.routeDomains(
                routeDomainsRequest({ signal: controller.signal }),
            );

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.aborted);
            expect(evidence.domains).toEqual([]);
            expect(calls).toHaveLength(1);
        });

        it("returns auth-error without any fetch call when the key is missing", async () => {
            const { fetch, calls } = stubFetch(() => {
                throw new Error("provider must not be called");
            });
            const service = new TypeSafeJevDecisionService(
                new ConfigService({ TYPESAFE_BASE_URL: TEST_BASE_URL }),
                fetch,
            );

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.authError);
            expect(calls).toHaveLength(0);
        });

        it("returns auth-error for a blank key without any fetch call", async () => {
            const { fetch, calls } = stubFetch(() => {
                throw new Error("provider must not be called");
            });
            const service = serviceWith(fetch, { TYPESAFE_API_KEY: "   " });

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.authError);
            expect(calls).toHaveLength(0);
        });

        it("returns timeout without any fetch call when the deadline has expired", async () => {
            const { fetch, calls } = stubFetch(() => {
                throw new Error("provider must not be called");
            });
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(
                routeDomainsRequest({ deadlineAt: Date.now() - 10 }),
            );

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.timeout);
            expect(calls).toHaveLength(0);
        });

        it("rejects answers when the returned model does not match the pin", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                systemOneBody(
                    { grooming: { type: "noul", noul: 0.9 }, scheduling: { type: "noul", noul: 0.1 } },
                    "jev-1.13.1",
                ),
            ));
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.modelMismatch);
            expect(evidence.returnedModel).toBe("jev-1.13.1");
            expect(evidence.requestedModel).toBe(PINNED_MODEL_ID);
            expect(evidence.domains).toEqual([]);
        });

        it("maps a fetch-level connection failure to transport-error", async () => {
            // The SDK wraps any fetch-level rejection into APIConnectionError,
            // which maps to `transport-error`.
            const { fetch } = stubFetch(() => {
                throw new Error("boom");
            });
            const service = serviceWith(fetch);

            const evidence = await service.routeDomains(routeDomainsRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.transportError);
        });

        it("maps a 500 response to provider-error", async () => {
            const { fetch } = stubFetch(() => jsonResponse(
                { error: { message: "internal" } },
                500,
            ));
            const service = serviceWith(fetch);

            const evidence = await service.rankCandidates(rankCandidatesRequest());

            expect(evidence.status).toBe(DECISION_STATUSES.unavailable);
            expect(evidence.failureReason).toBe(DECISION_FAILURE_REASONS.providerError);
            expect(evidence.outcome).toBeNull();
            expect(evidence.choiceSetRevision).toBe("rev-7");
        });
    });
});
