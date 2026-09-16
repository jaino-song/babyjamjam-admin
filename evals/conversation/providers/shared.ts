import {
    ConversationProviderCodecError,
    ConversationProviderErrorCode,
    providerError,
} from "./errors";
import type {
    ConversationEvaluationRequest,
    ConversationMessage,
    ConversationProvider,
    ConversationProviderContinuation,
    ConversationProviderMetadata,
    ConversationProviderProfile,
    ConversationProviderProfileRegistry,
    ConversationProviderResponse,
    ConversationToolCall,
    ConversationToolDeclaration,
    JsonObject,
    JsonValue,
    UnavailableNumber,
} from "./types";

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SAFE_JSON_KEY = /^[^\u0000-\u001F\u007F]{1,128}$/;
const SAFE_RESPONSE_ID = /^(?:resp|response|chatcmpl)[A-Za-z0-9_.:-]{1,96}$/;
const SAFE_FINISH_REASONS = new Set([
    "STOP",
    "MAX_TOKENS",
    "SAFETY",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "IMAGE_SAFETY",
    "RECITATION",
    "OTHER",
    "MALFORMED_FUNCTION_CALL",
    "completed",
    "incomplete",
    "failed",
    "cancelled",
]);
const MAX_TEXT_LENGTH = 200_000;
const MAX_JSON_LENGTH = 200_000;
const MAX_STEPS = 100;

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is null | boolean | number | string {
    return value === null
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
        || (typeof value === "string" && value.length <= MAX_JSON_LENGTH);
}

export function cloneJsonValue(value: unknown, code: ConversationProviderErrorCode = "INVALID_REQUEST"): JsonValue {
    if (isJsonPrimitive(value)) return value;
    if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item, code));
    if (!isRecord(value)) throw providerError(code);
    const clone: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!SAFE_JSON_KEY.test(key)) throw providerError(code, { field: "json_key" });
        clone[key] = cloneJsonValue(item, code);
    }
    return clone;
}

export function cloneJsonObject(value: unknown, code: ConversationProviderErrorCode = "INVALID_CONTINUATION"): JsonObject {
    const clone = cloneJsonValue(value, code);
    if (!isRecord(clone)) throw providerError(code);
    return clone;
}

export function parseJsonObject(value: unknown, code: ConversationProviderErrorCode): JsonValue {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_JSON_LENGTH) throw providerError(code);
    let parsed: unknown;
    try {
        parsed = JSON.parse(value) as unknown;
    } catch {
        throw providerError(code);
    }
    return cloneJsonValue(parsed, code);
}

export function serializeJsonValue(value: JsonValue, code: ConversationProviderErrorCode = "INVALID_REQUEST"): string {
    let serialized: string;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw providerError(code);
    }
    if (serialized.length > MAX_JSON_LENGTH) throw providerError(code);
    return serialized;
}

export function requireSafeReference(value: unknown, field: string, code: ConversationProviderErrorCode = "INVALID_REQUEST"): string {
    if (typeof value !== "string" || !SAFE_REFERENCE.test(value)) throw providerError(code, { field });
    return value;
}

export function requireSafeProfileId(value: unknown): string {
    if (typeof value !== "string" || !SAFE_PROFILE.test(value)) throw providerError("INVALID_PROFILE", { field: "profileId" });
    return value;
}

export function requireSafeModelId(value: unknown): string {
    if (typeof value !== "string" || !SAFE_MODEL.test(value)) throw providerError("INVALID_PROFILE", { field: "modelId" });
    return value;
}

export function requireSafeToolName(value: unknown, code: ConversationProviderErrorCode = "INVALID_REQUEST"): string {
    if (typeof value !== "string" || !SAFE_TOOL_NAME.test(value)) throw providerError(code, { field: "toolName" });
    return value;
}

function requireText(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) throw providerError("INVALID_REQUEST", { field });
    return value;
}

function validateToolDeclaration(tool: ConversationToolDeclaration): void {
    if (!isRecord(tool)) throw providerError("INVALID_REQUEST", { field: "tool" });
    requireSafeToolName(tool?.name);
    if (tool.description !== undefined) requireText(tool.description, "toolDescription");
    if (tool.parameters !== undefined) cloneJsonObject(tool.parameters);
    if (tool.strict !== undefined && typeof tool.strict !== "boolean") throw providerError("INVALID_REQUEST", { field: "toolStrict" });
}

function validateToolCall(call: ConversationToolCall): void {
    if (typeof call?.id !== "string" || call.id.length === 0 || call.id.length > 128 || !SAFE_REFERENCE.test(call.id)) {
        throw providerError("INVALID_REQUEST", { field: "toolCallId" });
    }
    requireSafeToolName(call.name);
    cloneJsonValue(call.arguments);
}

function validateMessage(message: ConversationMessage): void {
    if (!isRecord(message) || typeof message.role !== "string") throw providerError("INVALID_REQUEST", { field: "message" });
    if (message.role === "system" || message.role === "user") {
        requireText(message.text, "messageText");
        return;
    }
    if (message.role === "assistant") {
        if (message.text !== undefined) requireText(message.text, "messageText");
        if (!Array.isArray(message.toolCalls) || message.toolCalls.length === 0) {
            if (message.text === undefined) throw providerError("INVALID_REQUEST", { field: "assistantMessage" });
            return;
        }
        for (const call of message.toolCalls) validateToolCall(call);
        return;
    }
    if (message.role === "tool") {
        if (typeof message.toolCallId !== "string" || message.toolCallId.length === 0 || message.toolCallId.length > 128 || !SAFE_REFERENCE.test(message.toolCallId)) {
            throw providerError("INVALID_REQUEST", { field: "toolCallId" });
        }
        requireSafeToolName(message.name);
        cloneJsonValue(message.output);
        return;
    }
    throw providerError("INVALID_REQUEST", { field: "messageRole" });
}

function validateGoogleContinuation(continuation: Extract<ConversationProviderContinuation, { provider: "google" }>): void {
    if (!isRecord(continuation.thoughtSignatures)) throw providerError("INVALID_CONTINUATION");
    for (const [callId, signature] of Object.entries(continuation.thoughtSignatures)) {
        if (!SAFE_REFERENCE.test(callId) || typeof signature !== "string" || signature.length === 0 || signature.length > MAX_TEXT_LENGTH) {
            throw providerError("INVALID_CONTINUATION");
        }
    }
}

/**
 * A stateless continuation request carries the provider's opaque output items
 * and exactly one normalized tool result for each returned function call. New
 * user/system messages may accompany that round; prior assistant call items
 * with matching call IDs are retained by the opaque continuation and omitted
 * from the rebuilt input.
 */
function validateOpenAIContinuation(
    continuation: Extract<ConversationProviderContinuation, { provider: "openai" }>,
    declaredNames: ReadonlySet<string>,
    messages: readonly ConversationMessage[],
): void {
    if (!Array.isArray(continuation.outputItems) || continuation.outputItems.length > 32) throw providerError("INVALID_CONTINUATION");
    const continuationCalls = new Map<string, string>();
    for (const item of continuation.outputItems) {
        const clone = cloneJsonObject(item);
        const type = clone["type"];
        if (type !== "reasoning" && type !== "function_call") throw providerError("INVALID_CONTINUATION");
        if (type === "reasoning" && (typeof clone["encrypted_content"] !== "string" || clone["encrypted_content"].length === 0 || clone["encrypted_content"].length > MAX_TEXT_LENGTH)) {
            throw providerError("INVALID_CONTINUATION");
        }
        if (type === "function_call" && (typeof clone["call_id"] !== "string" || typeof clone["name"] !== "string" || typeof clone["arguments"] !== "string")) {
            throw providerError("INVALID_CONTINUATION");
        }
        if (type === "function_call") {
            const callId = requireSafeReference(clone["call_id"], "toolCallId", "INVALID_CONTINUATION");
            const name = requireSafeToolName(clone["name"], "INVALID_CONTINUATION");
            if (!declaredNames.has(name)) throw providerError("INVALID_CONTINUATION", { field: "toolName" });
            if (continuationCalls.has(callId)) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
            continuationCalls.set(callId, name);
        }
    }

    const toolOutputs = new Map<string, string>();
    for (const message of messages) {
        if (message.role !== "tool") continue;
        if (toolOutputs.has(message.toolCallId)) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
        const continuationName = continuationCalls.get(message.toolCallId);
        if (continuationName === undefined || continuationName !== message.name) {
            throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
        }
        toolOutputs.set(message.toolCallId, message.name);
    }
    if (continuationCalls.size !== toolOutputs.size) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
}

export function validateConversationRequest(request: ConversationEvaluationRequest, provider: ConversationProvider, reasoningContinuation: boolean): void {
    if (!isRecord(request)) throw providerError("INVALID_REQUEST");
    requireSafeReference(request.fixtureVersion, "fixtureVersion");
    requireSafeReference(request.promptVersion, "promptVersion");
    requireSafeReference(request.contextVersion, "contextVersion");
    if (!Number.isInteger(request.maxSteps) || request.maxSteps < 1 || request.maxSteps > MAX_STEPS) throw providerError("INVALID_REQUEST", { field: "maxSteps" });
    if (!Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > 256) throw providerError("INVALID_REQUEST", { field: "messages" });
    for (const message of request.messages) validateMessage(message);
    if (request.tools !== undefined) {
        if (!Array.isArray(request.tools) || request.tools.length > 128) throw providerError("INVALID_REQUEST", { field: "tools" });
        const names = new Set<string>();
        for (const tool of request.tools) {
            validateToolDeclaration(tool);
            const canonicalName = tool.name.toLowerCase();
            if (names.has(canonicalName)) throw providerError("INVALID_REQUEST", { field: "toolName" });
            names.add(canonicalName);
        }
    }
    const declaredNames = new Set((request.tools ?? []).map((tool) => tool.name));
    for (const message of request.messages) {
        if (message.role === "assistant" && "toolCalls" in message) {
            for (const call of message.toolCalls) {
                if (!declaredNames.has(call.name)) throw providerError("INVALID_REQUEST", { field: "toolName" });
            }
        }
        if (message.role === "tool" && !declaredNames.has(message.name)) throw providerError("INVALID_REQUEST", { field: "toolName" });
    }
    if (request.continuation !== undefined) {
        if (request.continuation.provider !== provider) throw providerError("PROVIDER_MISMATCH", { provider });
        if (request.continuation.provider === "google") validateGoogleContinuation(request.continuation);
        else validateOpenAIContinuation(request.continuation, declaredNames, request.messages);
    } else if (provider === "openai" && request.messages.some((message) => message.role === "tool")) {
        throw providerError(reasoningContinuation ? "MISSING_CONTINUATION" : "INVALID_CONTINUATION");
    }
    if (provider === "openai" && reasoningContinuation && request.messages.some((message) => message.role === "tool")) {
        if (request.continuation?.provider !== "openai") throw providerError("MISSING_CONTINUATION");
        if (!request.continuation.outputItems.some((item) => item["type"] === "reasoning" && typeof item["encrypted_content"] === "string" && item["encrypted_content"].length > 0 && item["encrypted_content"].length <= MAX_TEXT_LENGTH)) {
            throw providerError("MISSING_CONTINUATION");
        }
    }
}

function profileClone(profile: ConversationProviderProfile): ConversationProviderProfile {
    if (!isRecord(profile)) throw providerError("INVALID_PROFILE", { field: "profile" });
    requireSafeProfileId(profile.profileId);
    requireSafeModelId(profile.modelId);
    requireSafeReference(profile.profileVersion, "profileVersion");
    if (typeof profile.testOnly !== "boolean" || typeof profile.reasoningContinuation !== "boolean") throw providerError("INVALID_PROFILE");
    if (profile.provider !== "google" && profile.provider !== "openai") throw providerError("INVALID_PROFILE", { field: "provider" });
    if (profile.provider === "google" && profile.reasoningContinuation) throw providerError("INVALID_PROFILE", { field: "reasoningContinuation" });
    if (/(?:^|[-_.])(?:mock|test)(?:[-_.]|$)/i.test(profile.modelId) && !profile.testOnly) throw providerError("INVALID_PROFILE", { field: "testOnly" });
    return { ...profile };
}

export function validateConversationProviderProfile(profile: ConversationProviderProfile): ConversationProviderProfile {
    return profileClone(profile);
}

export function createConversationProviderRegistry(profiles: readonly ConversationProviderProfile[]): ConversationProviderProfileRegistry {
    if (!Array.isArray(profiles)) throw providerError("INVALID_PROFILE");
    const normalized = profiles.map(validateConversationProviderProfile);
    const ids = new Set<string>();
    const models = new Set<string>();
    for (const profile of normalized) {
        if (ids.has(profile.profileId) || models.has(`${profile.provider}:${profile.modelId}`)) throw providerError("INVALID_PROFILE");
        ids.add(profile.profileId);
        models.add(`${profile.provider}:${profile.modelId}`);
    }
    const frozenProfiles = Object.freeze(normalized.map((profile) => Object.freeze(profile)));
    return {
        profiles: frozenProfiles,
        resolve(profileId: string): ConversationProviderProfile {
            const profile = frozenProfiles.find((candidate) => candidate.profileId === profileId);
            if (!profile) throw providerError("UNSUPPORTED_MODEL", { field: "profileId" });
            return profile;
        },
    };
}

export function readTransportResult(value: unknown): { readonly body: unknown; readonly status?: number } {
    if (isRecord(value) && typeof value["status"] === "number" && Object.prototype.hasOwnProperty.call(value, "body")) {
        const status = value["status"];
        if (!Number.isInteger(status) || status < 100 || status > 599) throw providerError("HTTP_FAILURE");
        return { body: value["body"], status };
    }
    return { body: value };
}

export function throwForHttpStatus(status: number | undefined): void {
    if (status !== undefined && (status < 200 || status >= 300)) throw providerError("HTTP_FAILURE", { status }, status);
}

export function readNonNegativeInteger(value: unknown): UnavailableNumber {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : "unavailable";
}

export function usageMetadata(input: unknown, keys: { readonly input: string; readonly output: string; readonly total: string }): ConversationProviderMetadata["usage"] {
    const source = isRecord(input) ? input : {};
    return {
        inputTokens: readNonNegativeInteger(source[keys.input]),
        outputTokens: readNonNegativeInteger(source[keys.output]),
        totalTokens: readNonNegativeInteger(source[keys.total]),
        cost: "unavailable",
    };
}

export function responseMetadata(input: {
    readonly provider: ConversationProvider;
    readonly profile: ConversationProviderProfile;
    readonly responseId?: unknown;
    readonly model?: unknown;
    readonly modelVersion?: unknown;
    readonly finishReason?: unknown;
    readonly usage: ConversationProviderMetadata["usage"];
}): ConversationProviderMetadata {
    const safeId = typeof input.responseId === "string" && SAFE_RESPONSE_ID.test(input.responseId) ? input.responseId : undefined;
    const safeModel = input.profile.modelId;
    const safeModelVersion = typeof input.modelVersion === "string"
        && SAFE_MODEL.test(input.modelVersion)
        && input.modelVersion.startsWith(input.profile.modelId)
        ? input.modelVersion
        : undefined;
    const safeFinish = typeof input.finishReason === "string" && SAFE_FINISH_REASONS.has(input.finishReason) ? input.finishReason : undefined;
    return {
        codecVersion: "conversation-provider-codec-v1",
        provider: input.provider,
        profileId: input.profile.profileId,
        profileVersion: input.profile.profileVersion,
        model: safeModel,
        ...(safeId === undefined ? {} : { responseId: safeId }),
        ...(safeModelVersion === undefined ? {} : { modelVersion: safeModelVersion }),
        ...(safeFinish === undefined ? {} : { finishReason: safeFinish }),
        usage: input.usage,
    };
}

export function assertProviderProfile(profile: ConversationProviderProfile, provider: ConversationProvider): void {
    if (profile.provider !== provider) throw providerError("PROVIDER_MISMATCH", { provider });
}

export function transportError(error: unknown): ConversationProviderCodecError {
    const status = isRecord(error)
        ? (typeof error["status"] === "number" ? error["status"] : error["statusCode"])
        : undefined;
    return new ConversationProviderCodecError({ code: "TRANSPORT_FAILURE", status });
}

export function outcomeMetadata(
    response: ConversationProviderResponse,
    outcome: ConversationProviderResponse["outcome"],
    fields: { readonly text?: string; readonly toolCalls?: readonly ConversationToolCall[]; readonly continuation?: ConversationProviderContinuation },
): ConversationProviderResponse {
    return {
        outcome,
        ...(fields.text === undefined ? {} : { text: fields.text }),
        ...(fields.toolCalls === undefined ? {} : { toolCalls: fields.toolCalls }),
        ...(fields.continuation === undefined ? {} : { continuation: fields.continuation }),
        metadata: response.metadata,
    };
}

export function attachEvaluationMetadata(response: ConversationProviderResponse, request: ConversationEvaluationRequest): ConversationProviderResponse {
    return {
        ...response,
        metadata: {
            ...response.metadata,
            fixtureVersion: request.fixtureVersion,
            promptVersion: request.promptVersion,
            contextVersion: request.contextVersion,
            maxSteps: request.maxSteps,
        },
    };
}
