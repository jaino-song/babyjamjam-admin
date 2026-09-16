import type {
    ConversationEvaluationRequest,
    ConversationMessage,
    ConversationProviderAdapter,
    ConversationProviderAdapterOptions,
    ConversationProviderProfile,
    ConversationProviderResponse,
    EncodedProviderRequest,
    JsonObject,
    OpenAIContinuation,
} from "./types";
import {
    assertProviderProfile,
    attachEvaluationMetadata,
    cloneContinuationHistory,
    cloneJsonObject,
    cloneJsonValue,
    isRecord,
    parseJsonObject,
    readTransportResult,
    responseMetadata,
    requireSafeReference,
    requireSafeToolName,
    serializeJsonValue,
    throwForHttpStatus,
    transportError,
    usageMetadata,
    validateConversationProviderProfile,
    validateConversationRequest,
} from "./shared";
import { CONVERSATION_PROVIDER_CODEC_VERSION, OPENAI_RESPONSES_ENDPOINT } from "./types";
import { ConversationProviderCodecError, providerError } from "./errors";

const MAX_TEXT_LENGTH = 200_000;

function mapTextContent(message: { readonly role: "system" | "user"; readonly text: string }): JsonObject {
    const type: "input_text" = "input_text";
    return { role: message.role, content: [{ type, text: message.text }] };
}

function mapMessage(message: ConversationMessage): readonly JsonObject[] {
    if (message.role === "system" || message.role === "user") return [mapTextContent({ role: message.role, text: message.text })];
    if (message.role === "tool") {
        return [{ type: "function_call_output", call_id: message.toolCallId, output: serializeJsonValue(message.output) }];
    }
    const items: JsonObject[] = [];
    if (message.text !== undefined) items.push({ role: "assistant", content: [{ type: "output_text", text: message.text }] });
    for (const call of "toolCalls" in message ? message.toolCalls : []) {
        items.push({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: serializeJsonValue(call.arguments),
        });
    }
    return items;
}

function mapToolDeclaration(request: ConversationEvaluationRequest): readonly JsonObject[] {
    return (request.tools ?? []).map((declaration) => ({
        type: "function",
        name: declaration.name,
        ...(declaration.description === undefined ? {} : { description: declaration.description }),
        ...(declaration.parameters === undefined ? {} : { parameters: declaration.parameters }),
        ...(declaration.strict === undefined ? {} : { strict: declaration.strict }),
    }));
}

function buildOpenAIInput(request: ConversationEvaluationRequest): JsonObject[] {
    const continuation = request.continuation?.provider === "openai" ? request.continuation : undefined;
    const input: JsonObject[] = continuation
        ? continuation.history.map((item) => cloneJsonObject(item))
        : [];
    for (const message of request.messages) input.push(...mapMessage(message));
    return input;
}

function buildOpenAIBody(request: ConversationEvaluationRequest, profile: ConversationProviderProfile): JsonObject {
    const body: Record<string, unknown> = {
        model: profile.modelId,
        store: false,
        input: buildOpenAIInput(request),
    };
    if (request.tools !== undefined) body["tools"] = mapToolDeclaration(request);
    if (profile.reasoningContinuation) body["include"] = ["reasoning.encrypted_content"];
    return cloneJsonObject(body);
}

function parseOutputText(content: unknown): { readonly text: string; readonly refusal: boolean } {
    if (!Array.isArray(content) || content.length === 0) throw providerError("MALFORMED_RESPONSE");
    let text = "";
    let refusal = false;
    for (const rawPart of content) {
        const part = cloneJsonObject(rawPart, "MALFORMED_RESPONSE");
        const type = part["type"];
        if (type === "output_text") {
            if (Object.keys(part).some((key) => !new Set(["type", "text", "annotations", "logprobs"]).has(key))) throw providerError("MALFORMED_RESPONSE");
            if (typeof part["text"] !== "string" || part["text"].length > MAX_TEXT_LENGTH) throw providerError("MALFORMED_RESPONSE");
            text += part["text"];
            continue;
        }
        if (type === "refusal") {
            if (Object.keys(part).some((key) => !new Set(["type", "refusal"]).has(key))) throw providerError("MALFORMED_RESPONSE");
            if (typeof part["refusal"] !== "string" || part["refusal"].length > MAX_TEXT_LENGTH) throw providerError("MALFORMED_RESPONSE");
            refusal = true;
            continue;
        }
        throw providerError("MALFORMED_RESPONSE");
    }
    return { text, refusal };
}

function isIncompleteStatus(status: unknown): boolean {
    return status === "incomplete" || status === "failed" || status === "cancelled";
}

interface ParsedOpenAIResponse {
    readonly response: ConversationProviderResponse;
    readonly outputItems?: readonly JsonObject[];
}

export class OpenAIConversationProviderAdapter implements ConversationProviderAdapter {
    readonly provider = "openai" as const;
    readonly profile: ConversationProviderProfile;
    private readonly transport: ConversationProviderAdapterOptions["transport"];
    private readonly apiKey: string | undefined;

    constructor(options: ConversationProviderAdapterOptions) {
        if (!options || typeof options.registry?.resolve !== "function") throw providerError("INVALID_PROFILE", { field: "registry" });
        if (typeof options.transport?.request !== "function") throw providerError("INVALID_PROFILE", { field: "transport" });
        if (options.apiKey !== undefined && (typeof options.apiKey !== "string" || options.apiKey.length > 2048 || /[\r\n]/.test(options.apiKey))) {
            throw providerError("INVALID_PROFILE", { field: "apiKey" });
        }
        let profile: ConversationProviderProfile;
        try {
            profile = options.registry.resolve(options.profileId);
        } catch (error) {
            if (error instanceof ConversationProviderCodecError) throw error;
            throw providerError("INVALID_PROFILE", { field: "registry" });
        }
        const validatedProfile = validateConversationProviderProfile(profile);
        assertProviderProfile(validatedProfile, "openai");
        this.profile = validatedProfile;
        this.transport = options.transport;
        this.apiKey = options.apiKey;
    }

    encodeRequest(request: ConversationEvaluationRequest): EncodedProviderRequest {
        validateConversationRequest(request, "openai", this.profile);
        const body = buildOpenAIBody(request, this.profile);
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (this.apiKey !== undefined) headers["Authorization"] = `Bearer ${this.apiKey}`;
        return {
            url: OPENAI_RESPONSES_ENDPOINT,
            init: { method: "POST", headers, body: JSON.stringify(body), redirect: "error" },
        };
    }

    async run(request: ConversationEvaluationRequest): Promise<ConversationProviderResponse> {
        const encoded = this.encodeRequest(request);
        let result: unknown;
        try {
            result = await this.transport.request<unknown>(encoded.url, encoded.init);
        } catch (error) {
            throw transportError(error);
        }
        const response = readTransportResult(result);
        throwForHttpStatus(response.status);
        const parsed = this.parseResponseInternal(response.body, new Set((request.tools ?? []).map((tool) => tool.name)));
        const attached = attachEvaluationMetadata(parsed.response, request);
        if (parsed.outputItems === undefined || (attached.outcome !== "text" && attached.outcome !== "tool_calls")) return attached;
        let encodedBody: unknown;
        try {
            encodedBody = JSON.parse(encoded.init.body) as unknown;
        } catch {
            throw providerError("MALFORMED_RESPONSE");
        }
        if (!isRecord(encodedBody) || !Array.isArray(encodedBody["input"])) throw providerError("MALFORMED_RESPONSE");
        const history = cloneContinuationHistory([
            ...encodedBody["input"].map((item) => cloneJsonObject(item, "MALFORMED_RESPONSE")),
            ...parsed.outputItems,
        ]);
        const continuation: OpenAIContinuation = {
            provider: "openai",
            codecVersion: CONVERSATION_PROVIDER_CODEC_VERSION,
            profileId: this.profile.profileId,
            profileVersion: this.profile.profileVersion,
            modelId: this.profile.modelId,
            history,
            pendingToolCalls: attached.outcome === "tool_calls" ? (attached.toolCalls ?? []) : [],
        };
        return { ...attached, continuation };
    }

    parseResponse(response: unknown, declaredToolNames?: ReadonlySet<string>): ConversationProviderResponse {
        return this.parseResponseInternal(response, declaredToolNames).response;
    }

    private parseResponseInternal(response: unknown, declaredToolNames?: ReadonlySet<string>): ParsedOpenAIResponse {
        if (!isRecord(response)) throw providerError("MALFORMED_RESPONSE");
        const usage = usageMetadata(response["usage"], { input: "input_tokens", output: "output_tokens", total: "total_tokens" });
        const metadata = responseMetadata({
            provider: "openai",
            profile: this.profile,
            responseId: response["id"],
            model: response["model"],
            finishReason: response["status"],
            usage,
        });
        const status = response["status"];
        if (isIncompleteStatus(status)) return { response: { outcome: "incomplete", metadata } };
        const output = response["output"];
        if (!Array.isArray(output)) throw providerError("MALFORMED_RESPONSE");
        if (output.length === 0) return { response: { outcome: "incomplete", metadata } };

        let text = "";
        let refusal = false;
        let missingEncryptedReasoning = false;
        const calls: Array<{ readonly id: string; readonly name: string; readonly arguments: ReturnType<typeof cloneJsonValue> }> = [];
        const outputItems: JsonObject[] = [];
        for (const rawItem of output) {
            const item = cloneJsonObject(rawItem, "MALFORMED_RESPONSE");
            const type = item["type"];
            if (type === "message") {
                if (Object.keys(item).some((key) => !new Set(["type", "id", "status", "role", "content"]).has(key))) throw providerError("MALFORMED_RESPONSE");
                if (item["id"] !== undefined) requireSafeReference(item["id"], "responseId", "MALFORMED_RESPONSE");
                if (item["role"] !== undefined && item["role"] !== "assistant") throw providerError("MALFORMED_RESPONSE");
                const parsed = parseOutputText(item["content"]);
                text += parsed.text;
                refusal = refusal || parsed.refusal;
                outputItems.push(item);
                continue;
            }
            if (type === "reasoning") {
                if (Object.keys(item).some((key) => !new Set(["type", "id", "status", "encrypted_content", "summary"]).has(key))) throw providerError("MALFORMED_RESPONSE");
                if (item["id"] !== undefined) requireSafeReference(item["id"], "responseId", "MALFORMED_RESPONSE");
                if (typeof item["encrypted_content"] !== "string" || item["encrypted_content"].length === 0 || item["encrypted_content"].length > MAX_TEXT_LENGTH) {
                    if (this.profile.reasoningContinuation) throw providerError("MISSING_CONTINUATION");
                    missingEncryptedReasoning = true;
                    continue;
                }
                if (item["summary"] !== undefined) cloneJsonValue(item["summary"], "MALFORMED_RESPONSE");
                outputItems.push(item);
                continue;
            }
            if (type === "function_call") {
                if (Object.keys(item).some((key) => !new Set(["type", "id", "status", "call_id", "name", "arguments"]).has(key))) throw providerError("MALFORMED_RESPONSE");
                if (typeof item["call_id"] !== "string" || typeof item["name"] !== "string" || typeof item["arguments"] !== "string") throw providerError("MALFORMED_RESPONSE");
                requireSafeReference(item["call_id"], "toolCallId", "MALFORMED_RESPONSE");
                requireSafeToolName(item["name"], "MALFORMED_RESPONSE");
                if (item["id"] !== undefined) requireSafeReference(item["id"], "responseId", "MALFORMED_RESPONSE");
                if (declaredToolNames !== undefined && !declaredToolNames.has(item["name"])) throw providerError("INVALID_TOOL_ARGUMENTS", { field: "toolName" });
                const args = parseJsonObject(item["arguments"], "INVALID_TOOL_ARGUMENTS");
                if (!isRecord(args)) throw providerError("INVALID_TOOL_ARGUMENTS");
                if (calls.some((existing) => existing.id === item["call_id"])) throw providerError("MALFORMED_RESPONSE");
                calls.push({ id: item["call_id"], name: item["name"], arguments: args });
                outputItems.push(item);
                continue;
            }
            throw providerError("MALFORMED_RESPONSE");
        }
        if (refusal) return { response: { outcome: "refusal", text: text || undefined, metadata } };
        if (calls.length > 0) {
            if (this.profile.reasoningContinuation && (missingEncryptedReasoning || !outputItems.some((item) => item["type"] === "reasoning" && typeof item["encrypted_content"] === "string" && item["encrypted_content"].length > 0 && item["encrypted_content"].length <= MAX_TEXT_LENGTH))) {
                throw providerError("MISSING_CONTINUATION");
            }
            return {
                response: {
                    outcome: "tool_calls",
                    text: text || undefined,
                    toolCalls: calls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
                    metadata,
                },
                outputItems,
            };
        }
        if (text.length > 0) return { response: { outcome: "text", text, metadata }, outputItems };
        return { response: { outcome: "incomplete", metadata } };
    }
}

export function createOpenAIConversationProviderAdapter(options: ConversationProviderAdapterOptions): OpenAIConversationProviderAdapter {
    return new OpenAIConversationProviderAdapter(options);
}
