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
import { OPENAI_RESPONSES_ENDPOINT } from "./types";
import { ConversationProviderCodecError, providerError } from "./errors";

function mapTextContent(message: { readonly role: "system" | "user"; readonly text: string }): JsonObject {
    const type: "input_text" = "input_text";
    return { role: message.role, content: [{ type, text: message.text }] };
}

function mapMessage(message: ConversationMessage, continuationCallIds: ReadonlySet<string> = new Set()): readonly JsonObject[] {
    if (message.role === "system" || message.role === "user") return [mapTextContent({ role: message.role, text: message.text })];
    if (message.role === "tool") {
        return [{ type: "function_call_output", call_id: message.toolCallId, output: serializeJsonValue(message.output) }];
    }
    const items: JsonObject[] = [];
    if (message.text !== undefined) items.push({ role: "assistant", content: [{ type: "output_text", text: message.text }] });
    for (const call of "toolCalls" in message ? message.toolCalls : []) {
        if (continuationCallIds.has(call.id)) continue;
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
    const input: JsonObject[] = [];
    if (continuation) input.push(...continuation.outputItems.map((item) => cloneJsonObject(item)));
    const continuationCallIds = new Set((continuation?.outputItems ?? [])
        .filter((item) => item["type"] === "function_call" && typeof item["call_id"] === "string")
        .map((item) => item["call_id"] as string));
    for (const message of request.messages) input.push(...mapMessage(message, continuationCallIds));
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
    if (!Array.isArray(content)) throw providerError("MALFORMED_RESPONSE");
    let text = "";
    let refusal = false;
    for (const rawPart of content) {
        if (!isRecord(rawPart) || typeof rawPart["type"] !== "string") throw providerError("MALFORMED_RESPONSE");
        if (rawPart["type"] === "output_text") {
            if (typeof rawPart["text"] !== "string") throw providerError("MALFORMED_RESPONSE");
            text += rawPart["text"];
            continue;
        }
        if (rawPart["type"] === "refusal") {
            if (typeof rawPart["refusal"] !== "string") throw providerError("MALFORMED_RESPONSE");
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
        validateConversationRequest(request, "openai", this.profile.reasoningContinuation);
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
        return attachEvaluationMetadata(this.parseResponse(response.body, new Set((request.tools ?? []).map((tool) => tool.name))), request);
    }

    parseResponse(response: unknown, declaredToolNames?: ReadonlySet<string>): ConversationProviderResponse {
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
        if (isIncompleteStatus(status)) return { outcome: "incomplete", metadata };
        const output = response["output"];
        if (!Array.isArray(output)) throw providerError("MALFORMED_RESPONSE");
        if (output.length === 0) return { outcome: "incomplete", metadata };

        let text = "";
        let refusal = false;
        let missingEncryptedReasoning = false;
        const calls: Array<{ readonly id: string; readonly name: string; readonly arguments: ReturnType<typeof cloneJsonValue>; readonly raw: JsonObject }> = [];
        const continuationItems: JsonObject[] = [];
        for (const rawItem of output) {
            if (!isRecord(rawItem) || typeof rawItem["type"] !== "string") throw providerError("MALFORMED_RESPONSE");
            const type = rawItem["type"];
            if (type === "message") {
                const parsed = parseOutputText(rawItem["content"]);
                text += parsed.text;
                refusal = refusal || parsed.refusal;
                continue;
            }
            if (type === "reasoning") {
                if (typeof rawItem["encrypted_content"] !== "string" || rawItem["encrypted_content"].length === 0) {
                    missingEncryptedReasoning = missingEncryptedReasoning || this.profile.reasoningContinuation;
                    continue;
                }
                continuationItems.push(cloneJsonObject(rawItem));
                continue;
            }
            if (type === "function_call") {
                if (typeof rawItem["call_id"] !== "string" || typeof rawItem["name"] !== "string" || typeof rawItem["arguments"] !== "string") throw providerError("MALFORMED_RESPONSE");
                requireSafeReference(rawItem["call_id"], "toolCallId", "MALFORMED_RESPONSE");
                requireSafeToolName(rawItem["name"], "MALFORMED_RESPONSE");
                if (declaredToolNames !== undefined && !declaredToolNames.has(rawItem["name"])) throw providerError("INVALID_TOOL_ARGUMENTS", { field: "toolName" });
                const args = parseJsonObject(rawItem["arguments"], "INVALID_TOOL_ARGUMENTS");
                if (!isRecord(args)) throw providerError("INVALID_TOOL_ARGUMENTS");
                const cloned = cloneJsonObject(rawItem, "MALFORMED_RESPONSE");
                if (calls.some((existing) => existing.id === rawItem["call_id"])) throw providerError("MALFORMED_RESPONSE");
                calls.push({ id: rawItem["call_id"], name: rawItem["name"], arguments: args, raw: cloned });
                continuationItems.push(cloned);
                continue;
            }
            throw providerError("MALFORMED_RESPONSE");
        }
        if (refusal) return { outcome: "refusal", text: text || undefined, metadata };
        if (calls.length > 0) {
            if (this.profile.reasoningContinuation && (missingEncryptedReasoning || !continuationItems.some((item) => item["type"] === "reasoning" && typeof item["encrypted_content"] === "string"))) {
                throw providerError("MISSING_CONTINUATION");
            }
            const continuation: OpenAIContinuation = { provider: "openai", outputItems: continuationItems };
            return { outcome: "tool_calls", text: text || undefined, toolCalls: calls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })), continuation, metadata };
        }
        if (text.length > 0) return { outcome: "text", text, metadata };
        return { outcome: "incomplete", metadata };
    }
}

export function createOpenAIConversationProviderAdapter(options: ConversationProviderAdapterOptions): OpenAIConversationProviderAdapter {
    return new OpenAIConversationProviderAdapter(options);
}
