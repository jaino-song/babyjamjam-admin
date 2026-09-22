import {
    CONVERSATION_EVAL_CASES,
    type ConversationScenario,
} from "../../../evals/conversation/cases";
import {
    createStagingEvaluationPlan,
    parseStagingEvaluationConfig,
    runStagingEvaluation,
    scoreStagingResponse,
    StagingEvaluationConfigError,
    type StagingEvaluationConfig,
} from "../../../evals/conversation/staging-evaluation-runner";
import type {
    ConversationProviderResponse,
} from "../../../evals/conversation/providers/types";
import type { ConversationTransport } from "../../../evals/conversation/evaluation-policy";

const googleArguments = [
    "--provider", "google",
    "--google-current-profile", "google-current",
    "--google-improved-profile", "google-improved",
    "--google-current-model", "gemini-2.5-flash",
    "--google-improved-model", "gemini-2.5-flash",
];

function liveConfig(extra: readonly string[] = ["--google-key", "GOOGLE_SECRET_SENTINEL", "--execute", "--output", "/tmp/staging-evaluation-test.json"]): StagingEvaluationConfig {
    return parseStagingEvaluationConfig({ argv: [...googleArguments, ...extra] });
}

function googleTransport(responseText = "{\"events\":[{\"type\":\"fact_observed\",\"token\":\"SYN_CLIENT_A\"},{\"type\":\"date_intent_resolved\",\"value\":\"SYN_DATE_NEXT_VISIT\"}],\"answer\":\"PRIVATE_RESPONSE_SENTINEL\"}"): ConversationTransport {
    let calls = 0;
    return {
        get calls() { return calls; },
        get networkCalls() { return calls; },
        async request<T = never>(): Promise<T> {
            calls += 1;
            return {
                status: 200,
                body: {
                    candidates: [{
                        content: { role: "model", parts: [{ text: responseText }] },
                        finishReason: "STOP",
                    }],
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8, totalTokenCount: 18 },
                    modelVersion: "gemini-2.5-flash-001",
                },
            } as T;
        },
    };
}

function openAiTransport(): ConversationTransport {
    let calls = 0;
    return {
        get calls() { return calls; },
        get networkCalls() { return calls; },
        async request<T = never>(): Promise<T> {
            calls += 1;
            return {
                status: 200,
                body: {
                    id: "resp_staging_1",
                    model: "gpt-4.1-mini",
                    status: "completed",
                    output: [{
                        type: "message",
                        id: "msg_staging_1",
                        role: "assistant",
                        content: [{ type: "output_text", text: "SYN_CLIENT_A" }],
                    }],
                    usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 },
                },
            } as T;
        },
    };
}

function responseForScoring(): ConversationProviderResponse {
    return {
        outcome: "text",
        text: "{\"structured_events\":[{\"type\":\"fact_observed\",\"token\":\"SYN_CLIENT_A\"},{\"type\":\"date_intent_resolved\",\"value\":\"SYN_DATE_NEXT_VISIT\"}],\"answer\":\"SYN_CLIENT_A SYN_DATE_NEXT_VISIT\"}",
        metadata: {
            codecVersion: "conversation-provider-codec-v1",
            provider: "google",
            profileId: "google-current",
            profileVersion: "current-v1",
            model: "gemini-2.5-flash",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: "unavailable" },
        },
    };
}

describe("staging synthetic conversation evaluation runner", () => {
    it("scores required synthetic tokens and structured events without using assistant prose as state", () => {
        const scenario = CONVERSATION_EVAL_CASES[0] as ConversationScenario;
        const score = scoreStagingResponse(scenario, responseForScoring());

        expect(score.requiredTokenScore).toEqual({ required: 1, matched: 1, missing: [] });
        expect(score.structuredEventScore).toEqual({ required: 2, matched: 2, missing: [] });
    });

    it("creates a deterministic current/improved repeat matrix", () => {
        const config = liveConfig(["--google-key", "KEY", "--execute", "--output", "/tmp/matrix.json", "--repeat", "3"]);
        const plan = createStagingEvaluationPlan(config, [CONVERSATION_EVAL_CASES[0] as ConversationScenario]);

        expect(plan).toHaveLength(6);
        expect(plan.map((item) => `${item.profile.name}:${item.runIndex}`)).toEqual([
            "current:1", "current:2", "current:3", "improved:1", "improved:2", "improved:3",
        ]);
        expect(new Set(plan.map((item) => item.contextVersion))).toEqual(new Set(["context-current-v1", "context-improved-v1"]));
    });

    it("refuses a live run before transport creation when the provider key is missing", () => {
        expect(() => liveConfig(["--execute", "--output", "/tmp/missing-key.json"])).toThrow(StagingEvaluationConfigError);
        try {
            liveConfig(["--execute", "--output", "/tmp/missing-key.json"]);
        } catch (error) {
            expect(error).toMatchObject({ code: "MISSING_API_KEY" });
        }
    });

    it("allows a keyless dry run and makes no network call", async () => {
        const config = liveConfig(["--dry-run"]);
        let transportCalls = 0;
        const report = await runStagingEvaluation(config, {
            cases: [CONVERSATION_EVAL_CASES[0] as ConversationScenario],
            transportFactory: () => ({
                get calls() { return transportCalls; },
                get networkCalls() { return transportCalls; },
                async request<T = never>(): Promise<T> {
                    transportCalls += 1;
                    throw new Error("dry run must not call transport");
                },
            }),
        });

        expect(report.dryRun).toBe(true);
        expect(report.planCount).toBe(6);
        expect(report.providers[0]?.keyConfigured).toBe(false);
        expect(transportCalls).toBe(0);
    });

    it("writes only redacted metadata, hashes, scores, and aggregates", async () => {
        const config = liveConfig();
        const report = await runStagingEvaluation(config, {
            cases: [CONVERSATION_EVAL_CASES[0] as ConversationScenario],
            transportFactory: () => googleTransport(),
            now: (() => {
                let tick = 100;
                return () => (tick += 7);
            })(),
        });
        const serialized = JSON.stringify(report);

        expect(report.records).toHaveLength(6);
        expect(serialized).not.toContain("GOOGLE_SECRET_SENTINEL");
        expect(serialized).not.toContain("PRIVATE_RESPONSE_SENTINEL");
        expect(serialized).not.toContain("x-goog-api-key");
        expect(report.records.every((record) => /^[a-f0-9]{64}$/.test(record.responseHash))).toBe(true);
        expect(report.aggregate.runCount).toBe(6);
        expect(report.aggregate.usage.totalTokens).toBe(108);
        expect(report.fixtureDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(report.assertionDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(report.selectionDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    it("runs the same synthetic matrix through the OpenAI codec with injected transport", async () => {
        const config = parseStagingEvaluationConfig({ argv: [
            "--provider", "openai",
            "--openai-current-profile", "openai-current",
            "--openai-improved-profile", "openai-improved",
            "--openai-current-model", "gpt-4.1-mini",
            "--openai-improved-model", "gpt-4.1-mini",
            "--openai-key", "OPENAI_SECRET_SENTINEL",
            "--execute", "--output", "/tmp/openai-staging-evaluation.json", "--repeat", "1",
        ] });
        const report = await runStagingEvaluation(config, {
            cases: [CONVERSATION_EVAL_CASES[0] as ConversationScenario],
            transportFactory: () => openAiTransport(),
        });

        expect(report.records).toHaveLength(2);
        expect(report.records.every((record) => record.provider === "openai" && record.outcome === "text")).toBe(true);
        expect(JSON.stringify(report)).not.toContain("OPENAI_SECRET_SENTINEL");
    });
});
