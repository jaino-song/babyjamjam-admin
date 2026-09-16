import type {
    ConversationMessage,
    ConversationProviderAdapter,
    ConversationProviderAdapterOptions,
    ConversationProviderResponse,
    ConversationEvaluationRequest,
    ConversationProviderProfile,
    ConversationToolCall,
    EncodedProviderRequest,
    GoogleContinuation,
    JsonObject,
    JsonValue,
} from "./types";
import { ConversationProviderCodecError, providerError } from "./errors";
import {
    assertProviderProfile,
    attachEvaluationMetadata,
    cloneJsonObject,
    cloneJsonValue,
    isRecord,
    outcomeMetadata,
    readTransportResult,
    responseMetadata,
    requireSafeReference,
    requireSafeToolName,
    throwForHttpStatus,
    transportError,
    usageMetadata,
    validateConversationProviderProfile,
    validateConversationRequest,
} from "./shared";
import { GOOGLE_GENERATE_CONTENT_ENDPOINT } from "./types";

interface GoogleFunctionCall {
    readonly name: string;
    readonly args: JsonValue;
    readonly id: string;
    readonly thoughtSignature?: string;
}

interface GooglePart {
    readonly text?: string;
    readonly functionCall?: GoogleFunctionCall;
    readonly functionResponse?: { readonly name: string; readonly response: unknown; readonly id: string };
    readonly thoughtSignature?: string;
    readonly thought?: boolean;
}

function mapToolDeclaration(request: ConversationEvaluationRequest): readonly JsonObject[] {
    return (request.tools ?? []).map((declaration) => ({
        name: declaration.name,
        ...(declaration.description === undefined ? {} : { description: declaration.description }),
        ...(declaration.parameters === undefined ? {} : { parametersJsonSchema: declaration.parameters }),
    }));
}

function mapMessage(message: ConversationMessage, signatures: Readonly<Record<string, string>>): { readonly role: "user" | "model"; readonly parts: readonly JsonObject[] } | null {
    if (message.role === "system") return null;
    if (message.role === "user") return { role: "user", parts: [{ text: message.text }] };
    if (message.role === "tool") {
        return {
            role: "user",
            parts: [{
                functionResponse: {
                    name: message.name,
                    response: message.output,
                    id: message.toolCallId,
                },
            }],
        };
    }
    const parts: JsonObject[] = [];
    if (message.text !== undefined) parts.push({ text: message.text });
    for (const call of "toolCalls" in message ? message.toolCalls : []) {
        const signature = signatures[call.id];
        parts.push({
            functionCall: {
                name: call.name,
                args: call.arguments,
                id: call.id,
            },
            ...(signature === undefined ? {} : { thoughtSignature: signature }),
        });
    }
    return { role: "model", parts };
}

function buildGoogleBody(request: ConversationEvaluationRequest): JsonObject {
    const continuation = request.continuation?.provider === "google" ? request.continuation : undefined;
    const signatures = continuation?.thoughtSignatures ?? {};
    const usedSignatures = new Set<string>();
    const systemParts: JsonObject[] = [];
    const contents: Array<{ readonly role: "user" | "model"; readonly parts: readonly JsonObject[] }> = [];
    for (const message of request.messages) {
        if (message.role === "system") {
            systemParts.push({ text: message.text });
            continue;
        }
        if (message.role === "assistant" && "toolCalls" in message) {
            for (const call of message.toolCalls) {
                if (signatures[call.id] !== undefined) usedSignatures.add(call.id);
            }
        }
        const mapped = mapMessage(message, signatures);
        if (mapped) contents.push(mapped);
    }
    if (Object.keys(signatures).some((id) => !usedSignatures.has(id))) throw providerError("INVALID_CONTINUATION");
    const body: Record<string, unknown> = { contents };
    if (systemParts.length > 0) body["systemInstruction"] = { parts: systemParts };
    if (request.tools !== undefined) body["tools"] = request.tools.length === 0 ? [] : [{ functionDeclarations: mapToolDeclaration(request) }];
    return cloneJsonObject(body);
}

function isBlockedFinishReason(reason: unknown): boolean {
    return reason === "SAFETY" || reason === "BLOCKLIST" || reason === "PROHIBITED_CONTENT" || reason === "SPII" || reason === "IMAGE_SAFETY";
}

function isIncompleteFinishReason(reason: unknown): boolean {
    return reason === "MAX_TOKENS" || reason === "RECITATION" || reason === "OTHER" || reason === "MALFORMED_FUNCTION_CALL";
}

function safePart(value: unknown): GooglePart {
    if (!isRecord(value)) throw providerError("MALFORMED_RESPONSE");
    const keys = Object.keys(value);
    const allowed = new Set(["text", "functionCall", "functionResponse", "thoughtSignature", "thought"]);
    if (keys.some((key) => !allowed.has(key))) throw providerError("MALFORMED_RESPONSE");
    const text = value["text"];
    if (text !== undefined && typeof text !== "string") throw providerError("MALFORMED_RESPONSE");
    const signature = value["thoughtSignature"];
    if (signature !== undefined && (typeof signature !== "string" || signature.length === 0)) throw providerError("MALFORMED_RESPONSE");
    const thought = value["thought"];
    if (thought !== undefined && typeof thought !== "boolean") throw providerError("MALFORMED_RESPONSE");
    const functionCall = value["functionCall"];
    if (functionCall !== undefined) {
        if (!isRecord(functionCall)
            || typeof functionCall["name"] !== "string"
            || typeof functionCall["id"] !== "string"
            || functionCall["id"].length === 0
            || !Object.prototype.hasOwnProperty.call(functionCall, "args")) {
            throw providerError("MALFORMED_RESPONSE");
        }
        requireSafeReference(functionCall["id"], "toolCallId", "MALFORMED_RESPONSE");
        requireSafeToolName(functionCall["name"], "MALFORMED_RESPONSE");
        const callSignature = functionCall["thoughtSignature"];
        if (callSignature !== undefined && (typeof callSignature !== "string" || callSignature.length === 0)) throw providerError("MALFORMED_RESPONSE");
        const args = cloneJsonValue(functionCall["args"], "INVALID_TOOL_ARGUMENTS");
        if (!isRecord(args)) throw providerError("INVALID_TOOL_ARGUMENTS");
        return {
            text: text as string | undefined,
            functionCall: {
                name: functionCall["name"],
                args,
                id: functionCall["id"],
                ...(callSignature === undefined ? {} : { thoughtSignature: callSignature }),
            },
            ...(signature === undefined ? (callSignature === undefined ? {} : { thoughtSignature: callSignature }) : { thoughtSignature: signature }),
            ...(thought === undefined ? {} : { thought }),
        };
    }
    const functionResponse = value["functionResponse"];
    if (functionResponse !== undefined) throw providerError("MALFORMED_RESPONSE");
    if (text === undefined && signature === undefined && thought !== true) throw providerError("MALFORMED_RESPONSE");
    return {
        text: text as string | undefined,
        ...(signature === undefined ? {} : { thoughtSignature: signature }),
        ...(thought === undefined ? {} : { thought }),
    };
}

export class GoogleConversationProviderAdapter implements ConversationProviderAdapter {
    readonly provider = "google" as const;
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
        assertProviderProfile(validatedProfile, "google");
        this.profile = validatedProfile;
        this.transport = options.transport;
        this.apiKey = options.apiKey;
    }

    encodeRequest(request: ConversationEvaluationRequest): EncodedProviderRequest {
        validateConversationRequest(request, "google", this.profile.reasoningContinuation);
        const body = buildGoogleBody(request);
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (this.apiKey !== undefined) headers["x-goog-api-key"] = this.apiKey;
        return {
            url: `${GOOGLE_GENERATE_CONTENT_ENDPOINT}/${encodeURIComponent(this.profile.modelId)}:generateContent`,
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
        const usage = usageMetadata(response["usageMetadata"], { input: "promptTokenCount", output: "candidatesTokenCount", total: "totalTokenCount" });
        const candidates = response["candidates"];
        const promptFeedback = response["promptFeedback"];
        if (!Array.isArray(candidates) || candidates.length === 0) {
            if (isRecord(promptFeedback) && typeof promptFeedback["blockReason"] === "string") {
                const metadata = responseMetadata({ provider: "google", profile: this.profile, modelVersion: response["modelVersion"], finishReason: promptFeedback["blockReason"], usage });
                return { outcome: "blocked", metadata };
            }
            throw providerError("MALFORMED_RESPONSE");
        }
        const candidate = candidates[0];
        if (!isRecord(candidate)) throw providerError("MALFORMED_RESPONSE");
        const finishReason = candidate["finishReason"];
        const metadata = responseMetadata({ provider: "google", profile: this.profile, modelVersion: response["modelVersion"], finishReason, usage });
        if (isBlockedFinishReason(finishReason)) return { outcome: "blocked", metadata };
        if (isIncompleteFinishReason(finishReason)) return { outcome: "incomplete", metadata };
        const content = candidate["content"];
        if (!isRecord(content) || !Array.isArray(content["parts"])) throw providerError("MALFORMED_RESPONSE");
        if (content["role"] !== "model") throw providerError("MALFORMED_RESPONSE");
        let text = "";
        const toolCalls: ConversationToolCall[] = [];
        const signatures: Record<string, string> = {};
        for (const rawPart of content["parts"]) {
            const part = safePart(rawPart);
            if (part.text !== undefined && part.thought !== true) text += part.text;
            if (part.functionCall) {
                if (declaredToolNames !== undefined && !declaredToolNames.has(part.functionCall.name)) throw providerError("INVALID_TOOL_ARGUMENTS", { field: "toolName" });
                const call = {
                    id: part.functionCall.id,
                    name: part.functionCall.name,
                    arguments: part.functionCall.args,
                };
                if (toolCalls.some((existing) => existing.id === call.id)) throw providerError("MALFORMED_RESPONSE");
                toolCalls.push(call);
                const signature = part.thoughtSignature ?? part.functionCall.thoughtSignature;
                if (signature !== undefined) signatures[call.id] = signature;
            } else if (part.thoughtSignature !== undefined && part.thought !== true) {
                throw providerError("MALFORMED_RESPONSE");
            }
        }
        if (toolCalls.length > 0) {
            const continuation: GoogleContinuation | undefined = Object.keys(signatures).length > 0
                ? { provider: "google", thoughtSignatures: signatures }
                : undefined;
            return outcomeMetadata({ outcome: "tool_calls", metadata, toolCalls, continuation }, "tool_calls", { text: text || undefined, toolCalls, continuation });
        }
        if (text.length > 0) return { outcome: "text", text, metadata };
        return { outcome: "incomplete", metadata };
    }
}

export function createGoogleConversationProviderAdapter(options: ConversationProviderAdapterOptions): GoogleConversationProviderAdapter {
    return new GoogleConversationProviderAdapter(options);
}

export type GoogleConversationProviderError = ConversationProviderCodecError;
