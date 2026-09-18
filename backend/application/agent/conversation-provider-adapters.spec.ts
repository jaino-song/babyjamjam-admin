import type { ConversationTransport } from "../../../evals/conversation/evaluation-policy";
import {
    ConversationProviderCodecError,
    createConversationProviderRegistry,
    createGoogleConversationProviderAdapter,
    createOpenAIConversationProviderAdapter,
    serializeProviderEvaluationReport,
    type ConversationEvaluationRequest,
    type ConversationToolCall,
    type JsonObject,
    type OpenAIContinuation,
    type GoogleContinuation,
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

function createOpenAIContinuation(history: OpenAIContinuation["history"], pendingToolCalls: readonly ConversationToolCall[] = []): OpenAIContinuation {
    return {
        provider: "openai",
        codecVersion: "conversation-provider-codec-v1",
        profileId: "openai-reasoning-test-only",
        profileVersion: "openai-profile-v1",
        modelId: "mock-openai-test-only",
        history,
        pendingToolCalls,
    };
}

function createGoogleContinuation(history: GoogleContinuation["history"], pendingToolCalls: readonly ConversationToolCall[] = [], systemInstruction?: JsonObject): GoogleContinuation {
    return {
        provider: "google",
        codecVersion: "conversation-provider-codec-v1",
        profileId: "google-test-only",
        profileVersion: "google-profile-v1",
        modelId: "mock-google-test-only",
        history,
        ...(systemInstruction === undefined ? {} : { systemInstruction }),
        pendingToolCalls,
    };
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
            codecVersion: "conversation-provider-codec-v1",
            profileId: "google-test-only",
            profileVersion: "google-profile-v1",
            modelId: "mock-google-test-only",
            history: [{
                role: "user",
                parts: [{ text: "SYN_CLIENT_K의 바우처를 조회해줘." }],
            }, {
                role: "model",
                parts: [{
                    functionCall: {
                        name: "lookup_voucher",
                        args: { token: "SYN_VOUCHER_K" },
                        id: "google-call-1",
                    },
                    thoughtSignature: "GOOGLE_OPAQUE_THOUGHT_SENTINEL",
                }],
            }],
            pendingToolCalls: [{ id: "google-call-1", name: "lookup_voucher", arguments: { token: "SYN_VOUCHER_K" } }],
        });
        expect(response.metadata.usage).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18, cost: "unavailable" });
        expect(response.metadata).toMatchObject({ fixtureVersion: "conversation-eval-v1", promptVersion: "prompt-v1", contextVersion: "context-v1", maxSteps: 4 });
        expect(transport.networkCalls).toBe(1);
    });

    it("round-trips Google's opaque signature with a function response and rejects provider-mismatched continuation", async () => {
        const transport = createRecordingTransport([{ candidates: [{ content: { role: "model", parts: [{ text: "완료" }] }, finishReason: "STOP" }] }]);
        const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport });
        const continuation = createGoogleContinuation([
            { role: "user", parts: [{ text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
            { role: "model", parts: [{
                functionCall: {
                    name: "lookup_voucher",
                    args: { token: "SYN_VOUCHER_K" },
                    id: "google-call-1",
                },
                thoughtSignature: "GOOGLE_OPAQUE_THOUGHT_SENTINEL",
            }] },
        ], [{ id: "google-call-1", name: "lookup_voucher", arguments: { token: "SYN_VOUCHER_K" } }]);
        await adapter.run(createRequest({
            messages: [{ role: "tool", toolCallId: "google-call-1", name: "lookup_voucher", output: { voucher: "SYN_VOUCHER_K" } }],
            continuation,
        }));
        const body = JSON.parse(String((transport.requests[0]?.init as { body: string }).body)) as Record<string, unknown>;
        expect(body["contents"]).toEqual([
            { role: "user", parts: [{ text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
            { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "SYN_VOUCHER_K" }, id: "google-call-1" }, thoughtSignature: "GOOGLE_OPAQUE_THOUGHT_SENTINEL" }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { voucher: "SYN_VOUCHER_K" }, id: "google-call-1" } }] },
        ]);

        const mismatched = createRequest({ continuation: createOpenAIContinuation([], []) });
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
            codecVersion: "conversation-provider-codec-v1",
            profileId: "openai-reasoning-test-only",
            profileVersion: "openai-profile-v1",
            modelId: "mock-openai-test-only",
            history: [
                { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
                { type: "reasoning", id: "rs_1", encrypted_content: "OPENAI_ENCRYPTED_REASONING_SENTINEL" },
                { type: "function_call", id: "fc_1", call_id: "call-openai-1", name: "lookup_voucher", arguments: '{"token":"SYN_VOUCHER_K"}' },
            ],
            pendingToolCalls: [{ id: "call-openai-1", name: "lookup_voucher", arguments: { token: "SYN_VOUCHER_K" } }],
        });
        expect(first.metadata.usage).toEqual({ inputTokens: 10, outputTokens: 6, totalTokens: 16, cost: "unavailable" });

        await adapter.run(createRequest({
            messages: [{ role: "tool", toolCallId: "call-openai-1", name: "lookup_voucher", output: { voucher: "SYN_VOUCHER_K" } }],
            continuation: first.continuation,
        }));
        const secondBody = JSON.parse(String((transport.requests[1]?.init as { body: string }).body)) as Record<string, unknown>;
        expect(secondBody["input"]).toEqual([
            { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
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
            { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
            { type: "reasoning", id: "rs_parallel", encrypted_content: "OPENAI_PARALLEL_REASONING_SENTINEL", summary: [] },
            { type: "function_call", id: "fc_a", call_id: "call-a", name: "lookup_voucher", arguments: '{"token":"A"}' },
            { type: "function_call", id: "fc_b", call_id: "call-b", name: "lookup_account", arguments: '{"token":"B"}' },
        ], [
            { id: "call-a", name: "lookup_voucher", arguments: { token: "A" } },
            { id: "call-b", name: "lookup_account", arguments: { token: "B" } },
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
            { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
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
                    { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
                    { type: "reasoning", id: "rs_empty", encrypted_content: "" },
                    { type: "function_call", id: "fc_empty", call_id: "call-empty", name: "lookup_voucher", arguments: "{}" },
                ], [{ id: "call-empty", name: "lookup_voucher", arguments: {} }]),
            }),
        },
        {
            label: "mismatched call id",
            request: createRequest({
                messages: [{ role: "tool", toolCallId: "call-output", name: "lookup_voucher", output: {} }],
                continuation: createOpenAIContinuation([
                    { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
                    { type: "reasoning", id: "rs_id", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_id", call_id: "call-continuation", name: "lookup_voucher", arguments: "{}" },
                ], [{ id: "call-continuation", name: "lookup_voucher", arguments: {} }]),
            }),
        },
        {
            label: "mismatched tool name",
            request: createRequest({
                tools: [{ name: "lookup_voucher" }, { name: "lookup_account" }],
                messages: [{ role: "tool", toolCallId: "call-name", name: "lookup_account", output: {} }],
                continuation: createOpenAIContinuation([
                    { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
                    { type: "reasoning", id: "rs_name", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_name", call_id: "call-name", name: "lookup_voucher", arguments: "{}" },
                ], [{ id: "call-name", name: "lookup_voucher", arguments: {} }]),
            }),
        },
        {
            label: "undeclared continuation tool",
            request: createRequest({
                continuation: createOpenAIContinuation([
                    { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
                    { type: "reasoning", id: "rs_undeclared", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_undeclared", call_id: "call-undeclared", name: "delete_everything", arguments: "{}" },
                ], [{ id: "call-undeclared", name: "delete_everything", arguments: {} }]),
            }),
        },
        {
            label: "duplicate continuation call id",
            request: createRequest({
                tools: [{ name: "lookup_voucher" }, { name: "lookup_account" }],
                continuation: createOpenAIContinuation([
                    { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
                    { type: "reasoning", id: "rs_duplicate", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_duplicate_a", call_id: "call-duplicate", name: "lookup_voucher", arguments: "{}" },
                    { type: "function_call", id: "fc_duplicate_b", call_id: "call-duplicate", name: "lookup_account", arguments: "{}" },
                ], [{ id: "call-duplicate", name: "lookup_voucher", arguments: {} }]),
            }),
        },
        {
            label: "orphan continuation call",
            request: createRequest({
                continuation: createOpenAIContinuation([
                    { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
                    { type: "reasoning", id: "rs_orphan_call", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                    { type: "function_call", id: "fc_orphan_call", call_id: "call-orphan-call", name: "lookup_voucher", arguments: "{}" },
                ], [{ id: "call-orphan-call", name: "lookup_voucher", arguments: {} }]),
            }),
        },
        {
            label: "orphan tool output",
            request: createRequest({
                messages: [{ role: "tool", toolCallId: "call-orphan-output", name: "lookup_voucher", output: {} }],
                continuation: createOpenAIContinuation([
                    { role: "user", content: [{ type: "input_text", text: "SYN_CLIENT_K의 바우처를 조회해줘." }] },
                    { type: "reasoning", id: "rs_orphan_output", encrypted_content: "OPENAI_REASONING_SENTINEL" },
                ], []),
            }),
        },
    ])("rejects $label without making a transport call", async ({ request }) => {
        const transport = createRecordingTransport([{ id: "should_not_be_used", status: "completed", output: [] }]);
        const adapter = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport });
        await expect(adapter.run(request)).rejects.toMatchObject({ code: expect.stringMatching(/^(INVALID_CONTINUATION|MISSING_CONTINUATION)$/) });
        expect(transport.calls).toBe(0);
    });

    it("retains complete chronological Google history across three rounds and a later user turn", async () => {
        const transport = createRecordingTransport([
            { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "A" }, id: "google-call-a" }, thoughtSignature: "GOOGLE_SIG_A" }] }, finishReason: "STOP" }] },
            { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "B" }, id: "google-call-b" }, thoughtSignature: "GOOGLE_SIG_B" }] }, finishReason: "STOP" }] },
            { candidates: [{ content: { role: "model", parts: [{ text: "첫 답변" }] }, finishReason: "STOP" }] },
            { candidates: [{ content: { role: "model", parts: [{ text: "두 번째 답변" }] }, finishReason: "STOP" }] },
        ]);
        const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport });
        const first = await adapter.run(createRequest({ messages: [{ role: "system", text: "SYSTEM_SENTINEL" }, { role: "user", text: "첫 질문" }] }));
        const second = await adapter.run(createRequest({
            messages: [{ role: "tool", toolCallId: "google-call-a", name: "lookup_voucher", output: { voucher: "A" } }],
            continuation: first.continuation,
        }));
        const third = await adapter.run(createRequest({
            messages: [{ role: "tool", toolCallId: "google-call-b", name: "lookup_voucher", output: { voucher: "B" } }],
            continuation: second.continuation,
        }));
        await adapter.run(createRequest({
            messages: [{ role: "user", text: "후속 질문" }],
            continuation: third.continuation,
        }));

        const bodies = transport.requests.map((request) => JSON.parse(String((request.init as { body: string }).body)) as Record<string, unknown>);
        expect(bodies[0]?.["systemInstruction"]).toEqual({ parts: [{ text: "SYSTEM_SENTINEL" }] });
        expect(bodies[1]?.["systemInstruction"]).toEqual({ parts: [{ text: "SYSTEM_SENTINEL" }] });
        expect(bodies[2]?.["systemInstruction"]).toEqual({ parts: [{ text: "SYSTEM_SENTINEL" }] });
        expect(bodies[3]?.["systemInstruction"]).toEqual({ parts: [{ text: "SYSTEM_SENTINEL" }] });
        expect(bodies[1]?.["contents"]).toEqual([
            { role: "user", parts: [{ text: "첫 질문" }] },
            { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "A" }, id: "google-call-a" }, thoughtSignature: "GOOGLE_SIG_A" }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { voucher: "A" }, id: "google-call-a" } }] },
        ]);
        expect(bodies[2]?.["contents"]).toEqual([
            { role: "user", parts: [{ text: "첫 질문" }] },
            { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "A" }, id: "google-call-a" }, thoughtSignature: "GOOGLE_SIG_A" }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { voucher: "A" }, id: "google-call-a" } }] },
            { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "B" }, id: "google-call-b" }, thoughtSignature: "GOOGLE_SIG_B" }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { voucher: "B" }, id: "google-call-b" } }] },
        ]);
        expect(bodies[3]?.["contents"]).toEqual([
            { role: "user", parts: [{ text: "첫 질문" }] },
            { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "A" }, id: "google-call-a" }, thoughtSignature: "GOOGLE_SIG_A" }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { voucher: "A" }, id: "google-call-a" } }] },
            { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "B" }, id: "google-call-b" }, thoughtSignature: "GOOGLE_SIG_B" }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { voucher: "B" }, id: "google-call-b" } }] },
            { role: "model", parts: [{ text: "첫 답변" }] },
            { role: "user", parts: [{ text: "후속 질문" }] },
        ]);
        expect(third.continuation).toEqual(expect.objectContaining({ pendingToolCalls: [] }));
        expect(transport.calls).toBe(4);
    });

    it("retains complete chronological OpenAI history across three rounds and a later user turn", async () => {
        const transport = createRecordingTransport([
            { id: "resp_a", model: "mock-openai-test-only", status: "completed", output: [{ type: "reasoning", id: "rs_a", encrypted_content: "OPENAI_SIG_A" }, { type: "function_call", id: "fc_a", call_id: "openai-call-a", name: "lookup_voucher", arguments: '{"token":"A"}' }] },
            { id: "resp_b", model: "mock-openai-test-only", status: "completed", output: [{ type: "reasoning", id: "rs_b", encrypted_content: "OPENAI_SIG_B" }, { type: "function_call", id: "fc_b", call_id: "openai-call-b", name: "lookup_voucher", arguments: '{"token":"B"}' }] },
            { id: "resp_c", model: "mock-openai-test-only", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "첫 답변" }] }] },
            { id: "resp_d", model: "mock-openai-test-only", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "두 번째 답변" }] }] },
        ]);
        const adapter = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport });
        const first = await adapter.run(createRequest({ messages: [{ role: "system", text: "SYSTEM_SENTINEL" }, { role: "user", text: "첫 질문" }] }));
        const second = await adapter.run(createRequest({
            messages: [{ role: "tool", toolCallId: "openai-call-a", name: "lookup_voucher", output: { voucher: "A" } }],
            continuation: first.continuation,
        }));
        const third = await adapter.run(createRequest({
            messages: [{ role: "tool", toolCallId: "openai-call-b", name: "lookup_voucher", output: { voucher: "B" } }],
            continuation: second.continuation,
        }));
        await adapter.run(createRequest({ messages: [{ role: "user", text: "후속 질문" }], continuation: third.continuation }));

        const bodies = transport.requests.map((request) => JSON.parse(String((request.init as { body: string }).body)) as Record<string, unknown>);
        expect(bodies[1]?.["input"]).toEqual([
            { role: "system", content: [{ type: "input_text", text: "SYSTEM_SENTINEL" }] },
            { role: "user", content: [{ type: "input_text", text: "첫 질문" }] },
            { type: "reasoning", id: "rs_a", encrypted_content: "OPENAI_SIG_A" },
            { type: "function_call", id: "fc_a", call_id: "openai-call-a", name: "lookup_voucher", arguments: '{"token":"A"}' },
            { type: "function_call_output", call_id: "openai-call-a", output: '{"voucher":"A"}' },
        ]);
        expect(bodies[2]?.["input"]).toEqual([
            { role: "system", content: [{ type: "input_text", text: "SYSTEM_SENTINEL" }] },
            { role: "user", content: [{ type: "input_text", text: "첫 질문" }] },
            { type: "reasoning", id: "rs_a", encrypted_content: "OPENAI_SIG_A" },
            { type: "function_call", id: "fc_a", call_id: "openai-call-a", name: "lookup_voucher", arguments: '{"token":"A"}' },
            { type: "function_call_output", call_id: "openai-call-a", output: '{"voucher":"A"}' },
            { type: "reasoning", id: "rs_b", encrypted_content: "OPENAI_SIG_B" },
            { type: "function_call", id: "fc_b", call_id: "openai-call-b", name: "lookup_voucher", arguments: '{"token":"B"}' },
            { type: "function_call_output", call_id: "openai-call-b", output: '{"voucher":"B"}' },
        ]);
        expect(bodies[3]?.["input"]).toEqual([
            { role: "system", content: [{ type: "input_text", text: "SYSTEM_SENTINEL" }] },
            { role: "user", content: [{ type: "input_text", text: "첫 질문" }] },
            { type: "reasoning", id: "rs_a", encrypted_content: "OPENAI_SIG_A" },
            { type: "function_call", id: "fc_a", call_id: "openai-call-a", name: "lookup_voucher", arguments: '{"token":"A"}' },
            { type: "function_call_output", call_id: "openai-call-a", output: '{"voucher":"A"}' },
            { type: "reasoning", id: "rs_b", encrypted_content: "OPENAI_SIG_B" },
            { type: "function_call", id: "fc_b", call_id: "openai-call-b", name: "lookup_voucher", arguments: '{"token":"B"}' },
            { type: "function_call_output", call_id: "openai-call-b", output: '{"voucher":"B"}' },
            { type: "message", content: [{ type: "output_text", text: "첫 답변" }] },
            { role: "user", content: [{ type: "input_text", text: "후속 질문" }] },
        ]);
        expect(third.continuation).toEqual(expect.objectContaining({ pendingToolCalls: [] }));
        expect(transport.calls).toBe(4);
    });

    it("does not expose a resumable continuation from direct parseResponse", () => {
        const adapter = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport: createRecordingTransport([]) });
        const parsed = adapter.parseResponse({ id: "resp_parse", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "직접 파싱" }] }] }, new Set(["lookup_voucher"]));
        expect(parsed.outcome).toBe("text");
        expect(parsed.continuation).toBeUndefined();

        const google = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport: createRecordingTransport([]) });
        const googleParsed = google.parseResponse({ candidates: [{ content: { role: "model", parts: [{ text: "직접 파싱" }] }, finishReason: "STOP" }] }, new Set(["lookup_voucher"]));
        expect(googleParsed.outcome).toBe("text");
        expect(googleParsed.continuation).toBeUndefined();
    });

    it("keeps Google fallback IDs unique when native function calls omit ids", async () => {
        const transport = createRecordingTransport([
            { candidates: [{ content: { role: "model", parts: [
                { functionCall: { name: "lookup_voucher", args: { token: "A" } }, thoughtSignature: "GOOGLE_NO_ID_SIG_A" },
                { functionCall: { name: "lookup_voucher", args: { token: "B" } }, thoughtSignature: "GOOGLE_NO_ID_SIG_B" },
            ] }, finishReason: "STOP" }] },
            { candidates: [{ content: { role: "model", parts: [
                { functionCall: { name: "lookup_voucher", args: { token: "C" } }, thoughtSignature: "GOOGLE_NO_ID_SIG_C" },
            ] }, finishReason: "STOP" }] },
            { candidates: [{ content: { role: "model", parts: [{ text: "완료" }] }, finishReason: "STOP" }] },
        ]);
        const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport });
        const first = await adapter.run(createRequest({ messages: [{ role: "user", text: "두 개를 조회해줘." }] }));
        const pending = first.toolCalls ?? [];
        expect(pending).toHaveLength(2);
        expect(new Set(pending.map((call) => call.id)).size).toBe(2);
        const second = await adapter.run(createRequest({
            messages: pending.map((call) => ({ role: "tool" as const, toolCallId: call.id, name: call.name, output: { ok: call.id } })),
            continuation: first.continuation,
        }));
        const nextPending = second.toolCalls ?? [];
        expect(nextPending).toHaveLength(1);
        expect(new Set([...pending.map((call) => call.id), ...nextPending.map((call) => call.id)]).size).toBe(3);
        await adapter.run(createRequest({
            messages: nextPending.map((call) => ({ role: "tool" as const, toolCallId: call.id, name: call.name, output: { ok: call.id } })),
            continuation: second.continuation,
        }));
        const secondBody = JSON.parse(String((transport.requests[1]?.init as { body: string }).body)) as Record<string, unknown>;
        expect(secondBody["contents"]).toEqual([
            { role: "user", parts: [{ text: "두 개를 조회해줘." }] },
            { role: "model", parts: [
                { functionCall: { name: "lookup_voucher", args: { token: "A" } }, thoughtSignature: "GOOGLE_NO_ID_SIG_A" },
                { functionCall: { name: "lookup_voucher", args: { token: "B" } }, thoughtSignature: "GOOGLE_NO_ID_SIG_B" },
            ] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { ok: pending[0]?.id }, id: pending[0]?.id } }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { ok: pending[1]?.id }, id: pending[1]?.id } }] },
        ]);
        const thirdBody = JSON.parse(String((transport.requests[2]?.init as { body: string }).body)) as Record<string, unknown>;
        expect(thirdBody["contents"]).toEqual([
            ...(secondBody["contents"] as readonly JsonObject[]),
            { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: { token: "C" } }, thoughtSignature: "GOOGLE_NO_ID_SIG_C" }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup_voucher", response: { ok: nextPending[0]?.id }, id: nextPending[0]?.id } }] },
        ]);
    });

    it("rejects invalid continuation deltas and bindings for both providers before transport", async () => {
        const googleHistory: GoogleContinuation["history"] = [
            { role: "user", parts: [{ text: "질문" }] },
            { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: {}, id: "google-pending" }, thoughtSignature: "GOOGLE_PENDING_SIG" }] },
        ];
        const openAiHistory: OpenAIContinuation["history"] = [
            { role: "user", content: [{ type: "input_text", text: "질문" }] },
            { type: "reasoning", id: "openai-reasoning", encrypted_content: "OPENAI_PENDING_SIG" },
            { type: "function_call", id: "openai-function", call_id: "openai-pending", name: "lookup_voucher", arguments: "{}" },
        ];
        const cases = [
            {
                label: "pending user interruption",
                google: createRequest({ messages: [{ role: "tool", toolCallId: "google-pending", name: "lookup_voucher", output: {} }, { role: "user", text: "중단" }], continuation: createGoogleContinuation(googleHistory, [{ id: "google-pending", name: "lookup_voucher", arguments: {} }]) }),
                openai: createRequest({ messages: [{ role: "tool", toolCallId: "openai-pending", name: "lookup_voucher", output: {} }, { role: "user", text: "중단" }], continuation: createOpenAIContinuation(openAiHistory, [{ id: "openai-pending", name: "lookup_voucher", arguments: {} }]) }),
            },
            {
                label: "system override",
                google: createRequest({ messages: [{ role: "system", text: "override" }], continuation: createGoogleContinuation(googleHistory, [{ id: "google-pending", name: "lookup_voucher", arguments: {} }]) }),
                openai: createRequest({ messages: [{ role: "system", text: "override" }], continuation: createOpenAIContinuation(openAiHistory, [{ id: "openai-pending", name: "lookup_voucher", arguments: {} }]) }),
            },
            {
                label: "assistant full history replay",
                google: createRequest({ messages: [{ role: "assistant", toolCalls: [{ id: "google-pending", name: "lookup_voucher", arguments: {} }] }, { role: "tool", toolCallId: "google-pending", name: "lookup_voucher", output: {} }], continuation: createGoogleContinuation(googleHistory, [{ id: "google-pending", name: "lookup_voucher", arguments: {} }]) }),
                openai: createRequest({ messages: [{ role: "assistant", toolCalls: [{ id: "openai-pending", name: "lookup_voucher", arguments: {} }] }, { role: "tool", toolCallId: "openai-pending", name: "lookup_voucher", output: {} }], continuation: createOpenAIContinuation(openAiHistory, [{ id: "openai-pending", name: "lookup_voucher", arguments: {} }]) }),
            },
            {
                label: "stale tool output",
                google: createRequest({ messages: [{ role: "tool", toolCallId: "google-stale", name: "lookup_voucher", output: {} }], continuation: createGoogleContinuation(googleHistory, [{ id: "google-pending", name: "lookup_voucher", arguments: {} }]) }),
                openai: createRequest({ messages: [{ role: "tool", toolCallId: "openai-stale", name: "lookup_voucher", output: {} }], continuation: createOpenAIContinuation(openAiHistory, [{ id: "openai-pending", name: "lookup_voucher", arguments: {} }]) }),
            },
            {
                label: "duplicate tool output",
                google: createRequest({ messages: [{ role: "tool", toolCallId: "google-pending", name: "lookup_voucher", output: {} }, { role: "tool", toolCallId: "google-pending", name: "lookup_voucher", output: {} }], continuation: createGoogleContinuation(googleHistory, [{ id: "google-pending", name: "lookup_voucher", arguments: {} }]) }),
                openai: createRequest({ messages: [{ role: "tool", toolCallId: "openai-pending", name: "lookup_voucher", output: {} }, { role: "tool", toolCallId: "openai-pending", name: "lookup_voucher", output: {} }], continuation: createOpenAIContinuation(openAiHistory, [{ id: "openai-pending", name: "lookup_voucher", arguments: {} }]) }),
            },
            {
                label: "no pending system message",
                google: createRequest({ messages: [{ role: "system", text: "override" }], continuation: createGoogleContinuation([{ role: "user", parts: [{ text: "질문" }] }, { role: "model", parts: [{ text: "답변" }] }]) }),
                openai: createRequest({ messages: [{ role: "system", text: "override" }], continuation: createOpenAIContinuation([{ role: "user", content: [{ type: "input_text", text: "질문" }] }, { type: "message", content: [{ type: "output_text", text: "답변" }] }]) }),
            },
        ];
        for (const testCase of cases) {
            const googleTransport = createRecordingTransport([{ candidates: [] }]);
            const openAiTransport = createRecordingTransport([{ output: [] }]);
            const google = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport: googleTransport });
            const openai = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport: openAiTransport });
            await expect(google.run(testCase.google)).rejects.toMatchObject({ code: "INVALID_CONTINUATION" });
            await expect(openai.run(testCase.openai)).rejects.toMatchObject({ code: "INVALID_CONTINUATION" });
            expect(googleTransport.calls).toBe(0);
            expect(openAiTransport.calls).toBe(0);
        }
    });

    it("rejects continuation profile bindings, native shapes, and history bounds before transport", async () => {
        const validGoogle = createGoogleContinuation([{ role: "user", parts: [{ text: "질문" }] }]);
        const validOpenAI = createOpenAIContinuation([{ role: "user", content: [{ type: "input_text", text: "질문" }] }]);
        const oversizedGoogle = createGoogleContinuation(Array.from({ length: 513 }, () => ({ role: "user", parts: [{ text: "x" }] })));
        const oversizedOpenAI = createOpenAIContinuation(Array.from({ length: 513 }, () => ({ role: "user", content: [{ type: "input_text", text: "x" }] })));
        const huge = "x".repeat(200_000);
        const hugeGoogle = createGoogleContinuation(Array.from({ length: 6 }, () => ({ role: "user", parts: [{ text: huge }] })));
        const hugeOpenAI = createOpenAIContinuation(Array.from({ length: 6 }, () => ({ role: "user", content: [{ type: "input_text", text: huge }] })));
        const cases = [
            { google: { ...validGoogle, profileId: "other-profile" }, openai: { ...validOpenAI, profileId: "other-profile" } },
            { google: { ...validGoogle, history: [{ role: "evil", parts: [{ text: "x" }] }] }, openai: { ...validOpenAI, history: [{ type: "evil" }] } },
            { google: oversizedGoogle, openai: oversizedOpenAI },
            { google: hugeGoogle, openai: hugeOpenAI },
        ];
        for (const testCase of cases) {
            const googleTransport = createRecordingTransport([]);
            const openAiTransport = createRecordingTransport([]);
            const google = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport: googleTransport });
            const openai = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport: openAiTransport });
            await expect(google.run(createRequest({ continuation: testCase.google }))).rejects.toMatchObject({ code: "INVALID_CONTINUATION" });
            await expect(openai.run(createRequest({ continuation: testCase.openai }))).rejects.toMatchObject({ code: "INVALID_CONTINUATION" });
            expect(googleTransport.calls).toBe(0);
            expect(openAiTransport.calls).toBe(0);
        }
    });

    it("rejects JSON prototype keys recursively for both providers before transport", async () => {
        const cases = [
            {
                provider: "google" as const,
                continuation: createGoogleContinuation(JSON.parse('[{"__proto__":{"role":"model","parts":[{"text":"x"}]}}]') as GoogleContinuation["history"]),
            },
            {
                provider: "google" as const,
                continuation: createGoogleContinuation(JSON.parse('[{"role":"model","parts":[{"functionCall":{"name":"lookup_voucher","args":{"__proto__":{"polluted":true}},"id":"call-proto"}}]}]') as GoogleContinuation["history"]),
            },
            {
                provider: "openai" as const,
                continuation: createOpenAIContinuation(JSON.parse('[{"__proto__":{"type":"function_call","call_id":"call-proto","name":"lookup_voucher","arguments":"{}"}}]') as OpenAIContinuation["history"]),
            },
            {
                provider: "openai" as const,
                continuation: createOpenAIContinuation(JSON.parse('[{"type":"function_call","call_id":"call-proto","name":"lookup_voucher","arguments":"{\\"__proto__\\":{\\"polluted\\":true}}"}]') as OpenAIContinuation["history"]),
            },
        ];
        for (const testCase of cases) {
            const transport = createRecordingTransport([]);
            const adapter = testCase.provider === "google"
                ? createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport })
                : createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport });
            await expect(adapter.run(createRequest({ continuation: testCase.continuation }))).rejects.toMatchObject({ code: "INVALID_CONTINUATION" });
            expect(transport.calls).toBe(0);
        }
    });

    it("rejects Google function calls and responses in the inverted history role before transport", async () => {
        const cases: readonly ConversationEvaluationRequest[] = [
            createRequest({
                messages: [{ role: "tool", toolCallId: "google-role-call", name: "lookup_voucher", output: {} }],
                continuation: createGoogleContinuation([
                    { role: "user", parts: [{ text: "question" }] },
                    { role: "user", parts: [{ functionCall: { name: "lookup_voucher", args: {}, id: "google-role-call" } }] },
                ], [{ id: "google-role-call", name: "lookup_voucher", arguments: {} }]),
            }),
            createRequest({
                messages: [{ role: "user", text: "next question" }],
                continuation: createGoogleContinuation([
                    { role: "user", parts: [{ text: "question" }] },
                    { role: "model", parts: [{ functionCall: { name: "lookup_voucher", args: {}, id: "google-role-call" } }] },
                    { role: "model", parts: [{ functionResponse: { name: "lookup_voucher", response: {}, id: "google-role-call" } }] },
                ]),
            }),
        ];
        for (const request of cases) {
            const transport = createRecordingTransport([]);
            const adapter = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport });
            await expect(adapter.run(request)).rejects.toMatchObject({ code: "INVALID_CONTINUATION" });
            expect(transport.calls).toBe(0);
        }
    });

    it("rejects generated continuations whose complete snapshot exceeds the UTF-8 bound", async () => {
        const huge = "x".repeat(200_000);
        const googleTransport = createRecordingTransport([{
            candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        }]);
        const google = createGoogleConversationProviderAdapter({ registry, profileId: "google-test-only", transport: googleTransport });
        const largeSystemRequest = createRequest({
            messages: Array.from({ length: 6 }, () => ({ role: "system" as const, text: huge })),
        });
        await expect(google.run(largeSystemRequest)).rejects.toMatchObject({ code: "INVALID_CONTINUATION", metadata: { field: "history" } });
        expect(googleTransport.calls).toBe(1);

        const argumentText = JSON.stringify({ value: "x".repeat(150_000) });
        const openAiTransport = createRecordingTransport([{
            id: "resp_large_pending",
            model: "mock-openai-test-only",
            status: "completed",
            output: [
                { type: "reasoning", id: "rs_large_pending", encrypted_content: "OPENAI_LARGE_PENDING_REASONING" },
                ...Array.from({ length: 4 }, (_, index) => ({
                    type: "function_call",
                    id: `fc_large_${index}`,
                    call_id: `call-large-${index}`,
                    name: "lookup_voucher",
                    arguments: argumentText,
                })),
            ],
        }]);
        const openai = createOpenAIConversationProviderAdapter({ registry, profileId: "openai-reasoning-test-only", transport: openAiTransport });
        await expect(openai.run(createRequest())).rejects.toMatchObject({ code: "INVALID_CONTINUATION", metadata: { field: "history" } });
        expect(openAiTransport.calls).toBe(1);
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
