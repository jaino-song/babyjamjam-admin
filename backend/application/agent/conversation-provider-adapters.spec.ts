import type { ConversationTransport } from "../../../evals/conversation/evaluation-policy";
import {
    ConversationProviderCodecError,
    createConversationProviderRegistry,
    createGoogleConversationProviderAdapter,
    createOpenAIConversationProviderAdapter,
    serializeProviderEvaluationReport,
    type ConversationEvaluationRequest,
    type OpenAIContinuation,
    type ConversationProviderProfile,
} from "../../../evals/conversation/providers";

interface RecordedRequest {
    readonly input: string;
    readonly init: unknown;
}

function createRecordingTransport(responses: readonly unknown[]): ConversationTransport & { readonly requests: readonly RecordedRequest[] } {
    let calls = 0;
    let responseIndex = 0;
    const requests: RecordedRequest[] = [];
    return {
        get calls() { return calls; },
        get networkCalls() { return calls; },
        get requests() { return requests; },
        async request<T = never>(input: string, init?: unknown): Promise<T> {
            calls += 1;
            requests.push({ input, init });
            const response = responses[responseIndex++];
            if (response instanceof Error) throw response;
            return response as T;
        },
    };
}

const profiles: readonly ConversationProviderProfile[] = [
    {
        provider: "google",
        profileId: "google-test-only",
        modelId: "mock-google-test-only",
        profileVersion: "google-profile-v1",
        reasoningContinuation: false,
        testOnly: true,
    },
    {
        provider: "openai",
        profileId: "openai-reasoning-test-only",
        modelId: "mock-openai-test-only",
        profileVersion: "openai-profile-v1",
        reasoningContinuation: true,
        testOnly: true,
    },
];

const registry = createConversationProviderRegistry(profiles);

function createRequest(overrides: Partial<ConversationEvaluationRequest> = {}): ConversationEvaluationRequest {
    return {
        fixtureVersion: "conversation-eval-v1",
        promptVersion: "prompt-v1",
        contextVersion: "context-v1",
        maxSteps: 4,
        messages: [{ role: "user", text: "SYN_CLIENT_K의 바우처를 조회해줘." }],
        tools: [{
            name: "lookup_voucher",
            description: "Lookup a synthetic voucher.",
            parameters: {
                type: "object",
                properties: { token: { type: "string" } },
                required: ["token"],
                additionalProperties: false,
            },
            strict: true,
        }],
        ...overrides,
    };
}

function createOpenAIContinuation(outputItems: OpenAIContinuation["outputItems"]): OpenAIContinuation {
    return { provider: "openai", outputItems };
}

const googleToolResponse = {
    candidates: [{
        content: {
            role: "model",
            parts: [{
                functionCall: {
                    name: "lookup_voucher",
                    args: { token: "SYN_VOUCHER_K" },
                    id: "google-call-1",
                },
                thoughtSignature: "GOOGLE_OPAQUE_THOUGHT_SENTINEL",
            }],
        },
        finishReason: "STOP",
    }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 },
    modelVersion: "mock-google-test-only",
};

const openAiToolResponse = {
    id: "resp_1",
    model: "mock-openai-test-only",
    status: "completed",
    output: [
        { type: "reasoning", id: "rs_1", encrypted_content: "OPENAI_ENCRYPTED_REASONING_SENTINEL" },
        {
            type: "function_call",
            id: "fc_1",
            call_id: "call-openai-1",
            name: "lookup_voucher",
            arguments: '{"token":"SYN_VOUCHER_K"}',
        },
    ],
    usage: { input_tokens: 10, output_tokens: 6, total_tokens: 16 },
};

describe("evaluation-only conversation provider adapters", () => {
    it("encodes Google function calls and preserves thoughtSignature without making a default request", async () => {
        const transport = createRecordingTransport([googleToolResponse]);
        const adapter = createGoogleConversationProviderAdapter({
            registry,
            profileId: "google-test-only",
            transport,
            apiKey: "GOOGLE_KEY_SENTINEL",
        });

        const response = await adapter.run(createRequest());
        const request = transport.requests[0];
        const body = JSON.parse(String((request?.init as { body: string }).body)) as Record<string, unknown>;
        const contents = body["contents"] as Array<Record<string, unknown>>;
        const declaration = ((body["tools"] as Array<Record<string, unknown>>)[0]?.["functionDeclarations"] as Array<Record<string, unknown>>)[0];

        expect(request?.input).toBe("https://generativelanguage.googleapis.com/v1beta/models/mock-google-test-only:generateContent");
        expect((request?.init as { headers: Record<string, string> }).headers["x-goog-api-key"]).toBe("GOOGLE_KEY_SENTINEL");
        expect(contents[0]).toEqual({ role: "user", parts: [{ text: "SYN_CLIENT_K의 바우처를 조회해줘." }] });
        expect(declaration).toMatchObject({ name: "lookup_voucher", parametersJsonSchema: expect.any(Object) });
        expect(declaration).not.toHaveProperty("strict");
        expect(response.outcome).toBe("tool_calls");
        expect(response.toolCalls).toEqual([{ id: "google-call-1", name: "lookup_voucher", arguments: { token: "SYN_VOUCHER_K" } }]);
        expect(response.continuation).toEqual({
            provider: "google",
            thoughtSignatures: { "google-call-1": "GOOGLE_OPAQUE_THOUGHT_SENTINEL" },
        });
        expect(response.metadata.usage).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18, cost: "unavailable" });
        expect(response.metadata).toMatchObject({ fixtureVersion: "conversation-eval-v1", promptVersion: "prompt-v1", contextVersion: "context-v1", maxSteps: 4 });
        expect(transport.networkCalls).toBe(1);
    });

    it("round-trips Google's opaque signature with a function response and rejects provider-mismatched continuation", async () => {
        const transport = createRecordingTransport([{ candidates: [{ content: { role: "model", parts: [{ text: "완료" }] }, finishReason: "STOP" }] }]);
        const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport });
        const continuation = {
            provider: "google" as const,
            thoughtSignatures: { "google-call-1": "GOOGLE_OPAQUE_THOUGHT_SENTINEL" },
        };
        await adapter.run(createRequest({
            messages: [
                { role: "user", text: "SYN_CLIENT_K의 바우처를 조회해줘." },
                { role: "assistant", toolCalls: [{ id: "google-call-1", name: "lookup_voucher", arguments: { token: "SYN_VOUCHER_K" } }] },
                { role: "tool", toolCallId: "google-call-1", name: "lookup_voucher", output: { voucher: "SYN_VOUCHER_K" } },
            ],
            continuation,
        }));
        const body = JSON.parse(String((transport.requests[0]?.init as { body: string }).body)) as Record<string, unknown>;
        expect(body["contents"]).toEqual([
            { role: "user", parts: [{ text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
            { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "SYN_VOUCHER_K" }, id: "google-call-1" }, thoughtSignature: "GOOGLE_OPAQUE_THOUGHT_SENTINEL" }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { voucher: "SYN_VOUCHER_K" }, id: "google-call-1" } }] },
        ]);

        const mismatched = createRequest({ continuation: { provider: "openai", outputItems: [] } });
        await expect(adapter.run(mismatched)).rejects.toMatchObject({ code: "PROVIDER_MISMATCH" });
        expect(transport.calls).toBe(1);
    });

    it("uses OpenAI Responses stateless encrypted continuation and preserves call_id round trips", async () => {
        const transport = createRecordingTransport([openAiToolResponse, {
            id: "resp_2",
            model: "mock-openai-test-only",
            status: "completed",
            output: [{ type: "message", content: [{ type: "output_text", text: "완료" }] }],
        }]);
        const adapter = createOpenAIConversationProviderAdapter({
            registry,
            profileId: "openai-reasoning-test-only",
            transport,
            apiKey: "OPENAI_KEY_SENTINEL",
        });

        const first = await adapter.run(createRequest());
        const firstBody = JSON.parse(String((transport.requests[0]?.init as { body: string }).body)) as Record<string, unknown>;
        expect(transport.requests[0]?.input).toBe("https://api.openai.com/v1/responses");
        expect(firstBody).toMatchObject({ model: "mock-openai-test-only", store: false, include: ["reasoning.encrypted_content"] });
        expect((transport.requests[0]?.init as { headers: Record<string, string> }).headers["Authorization"]).toBe(["Bearer", "OPENAI_KEY_SENTINEL"].join(" "));
        expect(firstBody["tools"]).toEqual([{ type: "function", name: "lookup_voucher", description: "Lookup a synthetic voucher.", parameters: expect.any(Object), strict: true }]);
        expect(first.outcome).toBe("tool_calls");
        expect(first.toolCalls).toEqual([{ id: "call-openai-1", name: "lookup_voucher", arguments: { token: "SYN_VOUCHER_K" } }]);
        expect(first.continuation).toEqual({
            provider: "openai",
            outputItems: [
                { type: "reasoning", id: "rs_1", encrypted_content: "OPENAI_ENCRYPTED_REASONING_SENTINEL" },
                { type: "function_call", id: "fc_1", call_id: "call-openai-1", name: "lookup_voucher", arguments: '{"token":"SYN_VOUCHER_K"}' },
            ],
        });
        expect(first.metadata.usage).toEqual({ inputTokens: 10, outputTokens: 6, totalTokens: 16, cost: "unavailable" });

        await adapter.run(createRequest({
            messages: [{ role: "tool", toolCallId: "call-openai-1", name: "lookup_voucher", output: { voucher: "SYN_VOUCHER_K" } }],
            continuation: first.continuation,
        }));
        const secondBody = JSON.parse(String((transport.requests[1]?.init as { body: string }).body)) as Record<string, unknown>;
        expect(secondBody["input"]).toEqual([
            { type: "reasoning", id: "rs_1", encrypted_content: "OPENAI_ENCRYPTED_REASONING_SENTINEL" },
            { type: "function_call", id: "fc_1", call_id: "call-openai-1", name: "lookup_voucher", arguments: '{"token":"SYN_VOUCHER_K"}' },
            { type: "function_call_output", call_id: "call-openai-1", output: '{"voucher":"SYN_VOUCHER_K"}' },
        ]);
    });

    it("preserves parallel OpenAI calls and requires exact continuation output pairing before transport", async () => {
        const transport = createRecordingTransport([{
            id: "resp_parallel",
            model: "mock-openai-test-only",
            status: "completed",
            output: [{ type: "message", content: [{ type: "output_text", text: "완료" }] }],
        }]);
        const adapter = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport });
        const continuation = createOpenAIContinuation([
            { type: "reasoning", id: "rs_parallel", encrypted_content: "OPENAI_PARALLEL_REASONING_SENTINEL", summary: [] },
            { type: "function_call", id: "fc_a", call_id: "call-a", name: "lookup_voucher", arguments: '{"token":"A"}' },
            { type: "function_call", id: "fc_b", call_id: "call-b", name: "lookup_account", arguments: '{"token":"B"}' },
        ]);
        await adapter.run(createRequest({
            tools: [{ name: "lookup_voucher" }, { name: "lookup_account" }],
            messages: [
                { role: "tool", toolCallId: "call-b", name: "lookup_account", output: { account: "B" } },
                { role: "tool", toolCallId: "call-a", name: "lookup_voucher", output: { voucher: "A" } },
            ],
            continuation,
        }));
        expect(transport.calls).toBe(1);
        const body = JSON.parse(String((transport.requests[0]?.init as { body: string }).body)) as Record<string, unknown>;
        expect(body["input"]).toEqual([
            { type: "reasoning", id: "rs_parallel", encrypted_content: "OPENAI_PARALLEL_REASONING_SENTINEL", summary: [] },
            { type: "function_call", id: "fc_a", call_id: "call-a", name: "lookup_voucher", arguments: '{"token":"A"}' },
            { type: "function_call", id: "fc_b", call_id: "call-b", name: "lookup_account", arguments: '{"token":"B"}' },
            { type: "function_call_output", call_id: "call-b", output: '{"account":"B"}' },
            { type: "function_call_output", call_id: "call-a", output: '{"voucher":"A"}' },
        ]);
    });

    it.each([
        {
            label: "empty encrypted continuation",
            request: createRequest({
                messages: [{ role: "tool", toolCallId: "call-empty", name: "lookup_voucher", output: {} }],
                continuation: createOpenAIContinuation([
                    { type: "reasoning", id: "rs_empty", encrypted_content: "" },
                    { type: "function_call", id: "fc_empty", call_id: "call-empty", name: "lookup_voucher", arguments: "{}" },
                ]),
            }),
        },
        {
            label: "mismatched call id",
            request: createRequest({
                messages: [{ role: "tool", toolCallId: "call-output", name: "lookup_voucher", output: {} }],
                continuation: createOpenAIContinuation([
                    { type: "reasoning", id: "rs_id", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_id", call_id: "call-continuation", name: "lookup_voucher", arguments: "{}" },
                ]),
            }),
        },
        {
            label: "mismatched tool name",
            request: createRequest({
                tools: [{ name: "lookup_voucher" }, { name: "lookup_account" }],
                messages: [{ role: "tool", toolCallId: "call-name", name: "lookup_account", output: {} }],
                continuation: createOpenAIContinuation([
                    { type: "reasoning", id: "rs_name", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_name", call_id: "call-name", name: "lookup_voucher", arguments: "{}" },
                ]),
            }),
        },
        {
            label: "undeclared continuation tool",
            request: createRequest({
                continuation: createOpenAIContinuation([
                    { type: "reasoning", id: "rs_undeclared", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_undeclared", call_id: "call-undeclared", name: "delete_everything", arguments: "{}" },
                ]),
            }),
        },
        {
            label: "duplicate continuation call id",
            request: createRequest({
                tools: [{ name: "lookup_voucher" }, { name: "lookup_account" }],
                continuation: createOpenAIContinuation([
                    { type: "reasoning", id: "rs_duplicate", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_duplicate_a", call_id: "call-duplicate", name: "lookup_voucher", arguments: "{}" },
                    { type: "function_call", id: "fc_duplicate_b", call_id: "call-duplicate", name: "lookup_account", arguments: "{}" },
                ]),
            }),
        },
        {
            label: "orphan continuation call",
            request: createRequest({
                continuation: createOpenAIContinuation([
                    { type: "reasoning", id: "rs_orphan_call", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_orphan_call", call_id: "call-orphan-call", name: "lookup_voucher", arguments: "{}" },
                ]),
            }),
        },
        {
            label: "orphan tool output",
            request: createRequest({
                messages: [{ role: "tool", toolCallId: "call-orphan-output", name: "lookup_voucher", output: {} }],
                continuation: createOpenAIContinuation([{ type: "reasoning", id: "rs_orphan_output", encrypted_content: "OPENAI_REASONING_SENTINEL" }]),
            }),
        },
    ])("rejects $label without making a transport call", async ({ request }) => {
        const transport = createRecordingTransport([{ id: "should_not_be_used", status: "completed", output: [] }]);
        const adapter = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport });
        await expect(adapter.run(request)).rejects.toMatchObject({ code: expect.stringMatching(/^(INVALID_CONTINUATION|MISSING_CONTINUATION)$/) });
        expect(transport.calls).toBe(0);
    });

    it("keeps omitted optional tool fields omitted for both providers", async () => {
        const request = createRequest({ tools: [{ name: "lookup_voucher" }] });
        const googleTransport = createRecordingTransport([{ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }] }]);
        const openAiTransport = createRecordingTransport([{ id: "resp", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] }]);
        await createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport: googleTransport }).run(request);
        await createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport: openAiTransport }).run(request);
        const googleTool = (((JSON.parse(String((googleTransport.requests[0]?.init as { body: string }).body)) as Record<string, unknown>)["tools"] as Array<Record<string, unknown>>)[0]?.["functionDeclarations"] as Array<Record<string, unknown>>)[0];
        const openAiTool = ((JSON.parse(String((openAiTransport.requests[0]?.init as { body: string }).body)) as Record<string, unknown>)["tools"] as Array<Record<string, unknown>>)[0];
        expect(googleTool).toEqual({ name: "lookup_voucher" });
        expect(openAiTool).toEqual({ type: "function", name: "lookup_voucher" });
    });

    it("rejects syntactically valid calls for tools absent from the request declaration", async () => {
        const googleTransport = createRecordingTransport([{
            candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "undeclared_tool", args: {}, id: "call-unknown" } }] }, finishReason: "STOP" }],
        }]);
        const openAiTransport = createRecordingTransport([{
            id: "resp-unknown",
            status: "completed",
            output: [{ type: "function_call", call_id: "call-unknown", name: "undeclared_tool", arguments: "{}" }],
        }]);
        const google = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport: googleTransport });
        const openAi = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport: openAiTransport });
        await expect(google.run(createRequest())).rejects.toMatchObject({ code: "INVALID_TOOL_ARGUMENTS" });
        await expect(openAi.run(createRequest())).rejects.toMatchObject({ code: "INVALID_TOOL_ARGUMENTS" });
    });

    it("rejects profile/path injection before transport and has no live fallback", async () => {
        expect(() => createConversationProviderRegistry([{
            ...profiles[0]!,
            modelId: "mock-google-test-only/../../secret",
        }])).toThrow();
        expect(() => createConversationProviderRegistry([{
            ...profiles[0]!,
            modelId: "mock-google-test-only",
            testOnly: false,
        }])).toThrow();
        const transport = createRecordingTransport([googleToolResponse]);
        const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport });
        await expect(adapter.run(createRequest({ fixtureVersion: "../../prompt" }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        expect(transport.calls).toBe(0);
    });

    it.each([
        { label: "transport", response: new Error("TRANSPORT_SECRET_SENTINEL") },
        { label: "http", response: { status: 429, body: { error: { message: "HTTP_BODY_SECRET_SENTINEL" } } } },
        { label: "malformed", response: { candidates: [{ content: { parts: [{ functionCall: { name: "lookup_voucher", args: "MALFORMED_ARGS_SECRET_SENTINEL", id: "call" } }] } }] } },
    ])("sanitizes $label failures without source messages or bodies", async ({ response }) => {
        const transport = createRecordingTransport([response]);
        const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport });
        const result = adapter.run(createRequest());
        await expect(result).rejects.toBeInstanceOf(ConversationProviderCodecError);
        try {
            await result;
        } catch (error) {
            const serialized = JSON.stringify(error);
            expect(serialized).not.toContain("SECRET_SENTINEL");
            expect(serialized).not.toContain("MALFORMED_ARGS");
            expect((error as ConversationProviderCodecError).metadata).toEqual(expect.any(Object));
        }
    });

    it("returns refusal, blocked, and incomplete outcomes without exposing them as successful tool calls", async () => {
        const responses = [
            { candidates: [{ finishReason: "SAFETY", content: { role: "model", parts: [] } }] },
            { promptFeedback: { blockReason: "SAFETY" }, candidates: [] },
            { candidates: [{ finishReason: "MAX_TOKENS", content: { role: "model", parts: [] } }] },
        ];
        const transport = createRecordingTransport(responses);
        const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport });
        const first = await adapter.run(createRequest());
        const second = await adapter.run(createRequest());
        const third = await adapter.run(createRequest());
        expect(first.outcome).toBe("blocked");
        expect(second.outcome).toBe("blocked");
        expect(third.outcome).toBe("incomplete");
        expect(first.toolCalls).toBeUndefined();
        expect(second.toolCalls).toBeUndefined();
        expect(third.toolCalls).toBeUndefined();
    });

    it("does not publish provider internal thought text as assistant prose", async () => {
        const transport = createRecordingTransport([{
            candidates: [{
                content: {
                    role: "model",
                    parts: [
                        { text: "INTERNAL_GOOGLE_THOUGHT_SENTINEL", thought: true },
                        { text: "사용자에게 보여줄 답변" },
                    ],
                },
                finishReason: "STOP",
            }],
        }]);
        const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport });
        const response = await adapter.run(createRequest());
        expect(response.outcome).toBe("text");
        expect(response.text).toBe("사용자에게 보여줄 답변");
        expect(response.text).not.toContain("INTERNAL_GOOGLE_THOUGHT_SENTINEL");
    });

    it("keeps OpenAI reasoning items internal while returning only message text", async () => {
        const transport = createRecordingTransport([{
            id: "resp_reasoning_text",
            status: "completed",
            output: [
                { type: "reasoning", id: "rs_text", encrypted_content: "INTERNAL_OPENAI_REASONING_SENTINEL" },
                { type: "message", content: [{ type: "output_text", text: "사용자에게 보여줄 답변" }] },
            ],
        }]);
        const adapter = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport });
        const response = await adapter.run(createRequest());
        expect(response.outcome).toBe("text");
        expect(response.text).toBe("사용자에게 보여줄 답변");
        expect(response.text).not.toContain("INTERNAL_OPENAI_REASONING_SENTINEL");
        expect(JSON.stringify(serializeProviderEvaluationReport(response))).not.toContain("INTERNAL_OPENAI_REASONING_SENTINEL");
    });

    it("publishes only allowlisted metadata and keeps prompts, headers, and opaque continuations out of reports", async () => {
        const transport = createRecordingTransport([googleToolResponse]);
        const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport, apiKey: "REPORT_KEY_SENTINEL" });
        const response = await adapter.run(createRequest({ messages: [{ role: "user", text: "REPORT_PROMPT_SENTINEL" }] }));
        const report = serializeProviderEvaluationReport(response);
        const serialized = JSON.stringify(report);
        expect(serialized).not.toContain("REPORT_PROMPT_SENTINEL");
        expect(serialized).not.toContain("REPORT_KEY_SENTINEL");
        expect(serialized).not.toContain("GOOGLE_OPAQUE_THOUGHT_SENTINEL");
        expect(report).toEqual(expect.objectContaining({ outcome: "tool_calls", provider: "google", usage: expect.any(Object) }));
    });

    it("performs zero I/O on import", () => {
        expect(typeof createGoogleConversationProviderAdapter).toBe("function");
        expect(typeof createOpenAIConversationProviderAdapter).toBe("function");
    });
});
