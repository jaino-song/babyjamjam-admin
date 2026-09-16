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
    cloneContinuationHistory,
    cloneJsonObject,
    cloneJsonValue,
    isRecord,
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
import { CONVERSATION_PROVIDER_CODEC_VERSION, GOOGLE_GENERATE_CONTENT_ENDPOINT } from "./types";

const MAX_TEXT_LENGTH = 200_000;

interface GoogleFunctionCall {
    readonly name: string;
    readonly args: JsonValue;
    readonly id?: string;
    readonly thoughtSignature?: string;
}

interface GooglePart {
    readonly text?: string;
    readonly functionCall?: GoogleFunctionCall;
    readonly thoughtSignature?: string;
    readonly thought?: boolean;
    readonly native: JsonObject;
}

function mapToolDeclaration(request: ConversationEvaluationRequest): readonly JsonObject[] {
    return (request.tools ?? []).map((declaration) => ({
        name: declaration.name,
        ...(declaration.description === undefined ? {} : { description: declaration.description }),
        ...(declaration.parameters === undefined ? {} : { parametersJsonSchema: declaration.parameters }),
    }));
}

function mapMessage(message: ConversationMessage): { readonly role: "user" | "model"; readonly parts: readonly JsonObject[] } | null {
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
        parts.push({
            functionCall: {
                name: call.name,
                args: call.arguments,
                id: call.id,
            },
        });
    }
    return { role: "model", parts };
}

function buildGoogleBody(request: ConversationEvaluationRequest): JsonObject {
    const continuation = request.continuation?.provider === "google" ? request.continuation : undefined;
    const systemParts: JsonObject[] = [];
    const contents: Array<{ readonly role: "user" | "model"; readonly parts: readonly JsonObject[] }> = continuation
        ? continuation.history.map((item) => cloneJsonObject(item)) as Array<{ readonly role: "user" | "model"; readonly parts: readonly JsonObject[] }>
        : [];
    for (const message of request.messages) {
        if (!continuation && message.role === "system") {
            systemParts.push({ text: message.text });
            continue;
        }
        const mapped = mapMessage(message);
        if (mapped) contents.push(mapped);
    }
    const body: Record<string, unknown> = { contents };
    if (continuation?.systemInstruction !== undefined) body["systemInstruction"] = cloneJsonObject(continuation.systemInstruction);
    else if (systemParts.length > 0) body["systemInstruction"] = { parts: systemParts };
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
    const source = cloneJsonObject(value, "MALFORMED_RESPONSE");
    const keys = Object.keys(source);
    const allowed = new Set(["text", "functionCall", "thoughtSignature", "thought"]);
    if (keys.some((key) => !allowed.has(key))) throw providerError("MALFORMED_RESPONSE");
    const text = source["text"];
    if (text !== undefined && (typeof text !== "string" || text.length > MAX_TEXT_LENGTH)) throw providerError("MALFORMED_RESPONSE");
    const signature = source["thoughtSignature"];
    if (signature !== undefined && (typeof signature !== "string" || signature.length === 0 || signature.length > MAX_TEXT_LENGTH)) throw providerError("MALFORMED_RESPONSE");
    const thought = source["thought"];
    if (thought !== undefined && typeof thought !== "boolean") throw providerError("MALFORMED_RESPONSE");
    const functionCall = source["functionCall"];
    if (functionCall !== undefined) {
        const call = cloneJsonObject(functionCall, "MALFORMED_RESPONSE");
        if (Object.keys(call).some((key) => !new Set(["name", "args", "id", "thoughtSignature"]).has(key))
            || typeof call["name"] !== "string"
            || !Object.prototype.hasOwnProperty.call(call, "args")) throw providerError("MALFORMED_RESPONSE");
        const callSignature = call["thoughtSignature"];
        if (callSignature !== undefined && (typeof callSignature !== "string" || callSignature.length === 0 || callSignature.length > MAX_TEXT_LENGTH)) throw providerError("MALFORMED_RESPONSE");
        const callId = call["id"] === undefined ? undefined : requireSafeReference(call["id"], "toolCallId", "MALFORMED_RESPONSE");
        const args = cloneJsonValue(call["args"], "INVALID_TOOL_ARGUMENTS");
        if (!isRecord(args)) throw providerError("INVALID_TOOL_ARGUMENTS");
        const nativeCall: Record<string, JsonValue> = {
            name: call["name"],
            args,
            ...(callId === undefined ? {} : { id: callId }),
            ...(callSignature === undefined ? {} : { thoughtSignature: callSignature }),
        };
        const native: Record<string, JsonValue> = {
            functionCall: nativeCall,
            ...(text === undefined ? {} : { text }),
            ...(signature === undefined ? {} : { thoughtSignature: signature }),
            ...(thought === undefined ? {} : { thought }),
        };
        return {
            text: text as string | undefined,
            functionCall: {
                name: call["name"],
                args,
                ...(callId === undefined ? {} : { id: callId }),
                ...(callSignature === undefined ? {} : { thoughtSignature: callSignature }),
            },
            ...(signature === undefined ? {} : { thoughtSignature: signature }),
            ...(thought === undefined ? {} : { thought }),
            native,
        };
    }
    if (source["text"] === undefined && signature === undefined && thought !== true) throw providerError("MALFORMED_RESPONSE");
    return {
        text: text as string | undefined,
        ...(signature === undefined ? {} : { thoughtSignature: signature }),
        ...(thought === undefined ? {} : { thought }),
        native: source,
    };
}

function fallbackCallId(history: readonly JsonObject[], currentIds: ReadonlySet<string>, index: number): string {
    const used = new Set<string>(currentIds);
    for (const item of history) {
        const parts = item["parts"];
        if (!Array.isArray(parts)) continue;
        for (const rawPart of parts) {
            if (!isRecord(rawPart)) continue;
            for (const field of ["functionCall", "functionResponse"] as const) {
                const value = rawPart[field];
                if (isRecord(value) && typeof value["id"] === "string") used.add(value["id"]);
            }
        }
    }
    const base = `local-call-${history.length}-${index + 1}`;
    let candidate = base;
    let suffix = 1;
    while (used.has(candidate)) candidate = `${base}-${suffix++}`;
    return candidate;
}

interface ParsedGoogleResponse {
    readonly response: ConversationProviderResponse;
    readonly modelContent?: JsonObject;
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
        validateConversationRequest(request, "google", this.profile);
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
        let encodedBody: unknown;
        try {
            encodedBody = JSON.parse(encoded.init.body) as unknown;
        } catch {
            throw providerError("MALFORMED_RESPONSE");
        }
        const priorHistory = isRecord(encodedBody) && Array.isArray(encodedBody["contents"])
            ? encodedBody["contents"].map((item) => cloneJsonObject(item, "MALFORMED_RESPONSE"))
            : [];
        const parsed = this.parseResponseInternal(response.body, new Set((request.tools ?? []).map((tool) => tool.name)), priorHistory);
        const attached = attachEvaluationMetadata(parsed.response, request);
        if (parsed.modelContent === undefined || (attached.outcome !== "text" && attached.outcome !== "tool_calls")) return attached;
        const history = cloneContinuationHistory([...priorHistory, parsed.modelContent]);
        const continuation: GoogleContinuation = {
            provider: "google",
            codecVersion: CONVERSATION_PROVIDER_CODEC_VERSION,
            profileId: this.profile.profileId,
            profileVersion: this.profile.profileVersion,
            modelId: this.profile.modelId,
            history,
            ...(isRecord(encodedBody) && encodedBody["systemInstruction"] !== undefined
                ? { systemInstruction: cloneJsonObject(encodedBody["systemInstruction"], "MALFORMED_RESPONSE") }
                : {}),
            pendingToolCalls: attached.outcome === "tool_calls" ? (attached.toolCalls ?? []) : [],
        };
        return { ...attached, continuation };
    }

    parseResponse(response: unknown, declaredToolNames?: ReadonlySet<string>): ConversationProviderResponse {
        return this.parseResponseInternal(response, declaredToolNames, []).response;
    }

    private parseResponseInternal(response: unknown, declaredToolNames: ReadonlySet<string> | undefined, priorHistory: readonly JsonObject[]): ParsedGoogleResponse {
        if (!isRecord(response)) throw providerError("MALFORMED_RESPONSE");
        const usage = usageMetadata(response["usageMetadata"], { input: "promptTokenCount", output: "candidatesTokenCount", total: "totalTokenCount" });
        const candidates = response["candidates"];
        const promptFeedback = response["promptFeedback"];
        if (!Array.isArray(candidates) || candidates.length === 0) {
            if (isRecord(promptFeedback) && typeof promptFeedback["blockReason"] === "string") {
                const metadata = responseMetadata({ provider: "google", profile: this.profile, modelVersion: response["modelVersion"], finishReason: promptFeedback["blockReason"], usage });
                return { response: { outcome: "blocked", metadata } };
            }
            throw providerError("MALFORMED_RESPONSE");
        }
        const candidate = candidates[0];
        if (!isRecord(candidate)) throw providerError("MALFORMED_RESPONSE");
        const finishReason = candidate["finishReason"];
        const metadata = responseMetadata({ provider: "google", profile: this.profile, modelVersion: response["modelVersion"], finishReason, usage });
        if (isBlockedFinishReason(finishReason)) return { response: { outcome: "blocked", metadata } };
        if (isIncompleteFinishReason(finishReason)) return { response: { outcome: "incomplete", metadata } };
        const content = candidate["content"];
        if (!isRecord(content) || !Array.isArray(content["parts"]) || content["role"] !== "model") throw providerError("MALFORMED_RESPONSE");
        let text = "";
        const toolCalls: ConversationToolCall[] = [];
        const nativeParts: JsonObject[] = [];
        const currentIds = new Set<string>();
        for (let index = 0; index < content["parts"].length; index += 1) {
            const part = safePart(content["parts"][index]);
            nativeParts.push(part.native);
            if (part.text !== undefined && part.thought !== true) text += part.text;
            if (part.functionCall) {
                if (declaredToolNames !== undefined && !declaredToolNames.has(part.functionCall.name)) throw providerError("INVALID_TOOL_ARGUMENTS", { field: "toolName" });
                const id = part.functionCall.id ?? fallbackCallId(priorHistory, currentIds, index);
                requireSafeReference(id, "toolCallId", "MALFORMED_RESPONSE");
                if (currentIds.has(id)) throw providerError("MALFORMED_RESPONSE");
                currentIds.add(id);
                toolCalls.push({ id, name: part.functionCall.name, arguments: part.functionCall.args });
            }
        }
        const modelContent: JsonObject = { role: "model", parts: nativeParts };
        if (toolCalls.length > 0) return {
            response: { outcome: "tool_calls", text: text || undefined, toolCalls, metadata },
            modelContent,
        };
        if (text.length > 0) return { response: { outcome: "text", text, metadata }, modelContent };
        return { response: { outcome: "incomplete", metadata } };
    }
}

export function createGoogleConversationProviderAdapter(options: ConversationProviderAdapterOptions): GoogleConversationProviderAdapter {
    return new GoogleConversationProviderAdapter(options);
}

export type GoogleConversationProviderError = ConversationProviderCodecError;
