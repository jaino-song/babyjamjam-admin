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
import { CONVERSATION_PROVIDER_CODEC_VERSION } from "./types";

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
const MAX_HISTORY_ITEMS = 512;
const MAX_HISTORY_BYTES = 1024 * 1024;

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
    if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) throw providerError(code);
        return value.map((item) => cloneJsonValue(item, code));
    }
    if (!isRecord(value)) throw providerError(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw providerError(code);
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

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function cloneBoundedHistory(value: unknown): readonly JsonObject[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_HISTORY_ITEMS) throw providerError("INVALID_CONTINUATION", { field: "history" });
    const history = value.map((item) => cloneJsonObject(item, "INVALID_CONTINUATION"));
    let serialized: string;
    try {
        serialized = JSON.stringify(history);
    } catch {
        throw providerError("INVALID_CONTINUATION", { field: "history" });
    }
    if (serialized === undefined || utf8ByteLength(serialized) > MAX_HISTORY_BYTES) throw providerError("INVALID_CONTINUATION", { field: "history" });
    return history;
}

export function cloneContinuationHistory(history: readonly JsonObject[]): readonly JsonObject[] {
    return cloneBoundedHistory(history);
}

function assertContinuationSize(value: unknown): void {
    let serialized: string;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw providerError("INVALID_CONTINUATION", { field: "history" });
    }
    if (serialized === undefined || utf8ByteLength(serialized) > MAX_HISTORY_BYTES) throw providerError("INVALID_CONTINUATION", { field: "history" });
}

function validateContinuationBinding(
    continuation: ConversationProviderContinuation,
    provider: ConversationProvider,
    profile: ConversationProviderProfile,
): void {
    if (continuation.provider !== provider) throw providerError("PROVIDER_MISMATCH", { provider });
    if (continuation.codecVersion !== CONVERSATION_PROVIDER_CODEC_VERSION
        || continuation.profileId !== profile.profileId
        || continuation.profileVersion !== profile.profileVersion
        || continuation.modelId !== profile.modelId) {
        throw providerError("INVALID_CONTINUATION", { field: "profile" });
    }
    requireSafeProfileId(continuation.profileId);
    requireSafeReference(continuation.profileVersion, "profileVersion", "INVALID_CONTINUATION");
    requireSafeModelId(continuation.modelId);
}

function validatePendingToolCalls(
    pendingToolCalls: unknown,
    declaredNames: ReadonlySet<string>,
): readonly ConversationToolCall[] {
    if (!Array.isArray(pendingToolCalls) || pendingToolCalls.length > 128) throw providerError("INVALID_CONTINUATION", { field: "pendingToolCalls" });
    const ids = new Set<string>();
    const normalized: ConversationToolCall[] = [];
    for (const rawCall of pendingToolCalls) {
        if (!isRecord(rawCall)) throw providerError("INVALID_CONTINUATION", { field: "pendingToolCalls" });
        const id = requireSafeReference(rawCall["id"], "toolCallId", "INVALID_CONTINUATION");
        const name = requireSafeToolName(rawCall["name"], "INVALID_CONTINUATION");
        if (!declaredNames.has(name)) throw providerError("INVALID_CONTINUATION", { field: "toolName" });
        if (ids.has(id)) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
        ids.add(id);
        normalized.push({ id, name, arguments: cloneJsonValue(rawCall["arguments"], "INVALID_CONTINUATION") });
    }
    return normalized;
}

function validateOpenAIHistoryItem(item: JsonObject, declaredNames: ReadonlySet<string>): void {
    const type = item["type"];
    const role = item["role"];
    if (type === "function_call_output") {
        const keys = Object.keys(item);
        if (keys.some((key) => !new Set(["type", "call_id", "output"]).has(key))) throw providerError("INVALID_CONTINUATION");
        requireSafeReference(item["call_id"], "toolCallId", "INVALID_CONTINUATION");
        if (typeof item["output"] !== "string" || item["output"].length > MAX_JSON_LENGTH) throw providerError("INVALID_CONTINUATION");
        return;
    }
    if (type === "function_call") {
        const keys = Object.keys(item);
        if (keys.some((key) => !new Set(["type", "id", "call_id", "name", "arguments", "status"]).has(key))) throw providerError("INVALID_CONTINUATION");
        requireSafeReference(item["call_id"], "toolCallId", "INVALID_CONTINUATION");
        requireSafeToolName(item["name"], "INVALID_CONTINUATION");
        if (!declaredNames.has(item["name"] as string)) throw providerError("INVALID_CONTINUATION", { field: "toolName" });
        if (item["id"] !== undefined) requireSafeReference(item["id"], "responseId", "INVALID_CONTINUATION");
        if (typeof item["arguments"] !== "string" || item["arguments"].length === 0 || item["arguments"].length > MAX_JSON_LENGTH) throw providerError("INVALID_CONTINUATION");
        const parsed = parseJsonObject(item["arguments"], "INVALID_CONTINUATION");
        if (!isRecord(parsed)) throw providerError("INVALID_CONTINUATION");
        return;
    }
    if (type === "reasoning") {
        const keys = Object.keys(item);
        if (keys.some((key) => !new Set(["type", "id", "status", "encrypted_content", "summary"]).has(key))) throw providerError("INVALID_CONTINUATION");
        if (item["id"] !== undefined) requireSafeReference(item["id"], "responseId", "INVALID_CONTINUATION");
        if (typeof item["encrypted_content"] !== "string" || item["encrypted_content"].length === 0 || item["encrypted_content"].length > MAX_TEXT_LENGTH) throw providerError("INVALID_CONTINUATION");
        if (item["summary"] !== undefined) cloneJsonValue(item["summary"], "INVALID_CONTINUATION");
        return;
    }
    if (type === "message") {
        const keys = Object.keys(item);
        if (keys.some((key) => !new Set(["type", "id", "status", "role", "content"]).has(key))) throw providerError("INVALID_CONTINUATION");
        if (item["id"] !== undefined) requireSafeReference(item["id"], "responseId", "INVALID_CONTINUATION");
        if (item["role"] !== undefined && item["role"] !== "assistant") throw providerError("INVALID_CONTINUATION");
        validateOpenAIMessageContent(item["content"]);
        return;
    }
    if (role === "system" || role === "user" || role === "assistant") {
        const keys = Object.keys(item);
        if (keys.some((key) => !new Set(["role", "content"]).has(key))) throw providerError("INVALID_CONTINUATION");
        const content = item["content"];
        if (!Array.isArray(content) || content.length === 0) throw providerError("INVALID_CONTINUATION");
        for (const rawPart of content) {
            const part = cloneJsonObject(rawPart, "INVALID_CONTINUATION");
            if (Object.keys(part).some((key) => !new Set(["type", "text"]).has(key)) || part["type"] !== (role === "assistant" ? "output_text" : "input_text") || typeof part["text"] !== "string" || part["text"].length > MAX_TEXT_LENGTH) {
                throw providerError("INVALID_CONTINUATION");
            }
        }
        return;
    }
    throw providerError("INVALID_CONTINUATION");
}

function validateOpenAIMessageContent(value: unknown): void {
    if (!Array.isArray(value) || value.length === 0) throw providerError("INVALID_CONTINUATION");
    for (const rawPart of value) {
        const part = cloneJsonObject(rawPart, "INVALID_CONTINUATION");
        const type = part["type"];
        if (type === "output_text") {
            if (Object.keys(part).some((key) => !new Set(["type", "text", "annotations", "logprobs"]).has(key))) throw providerError("INVALID_CONTINUATION");
            if (typeof part["text"] !== "string" || part["text"].length > MAX_TEXT_LENGTH) throw providerError("INVALID_CONTINUATION");
            if (part["annotations"] !== undefined) cloneJsonValue(part["annotations"], "INVALID_CONTINUATION");
            if (part["logprobs"] !== undefined) cloneJsonValue(part["logprobs"], "INVALID_CONTINUATION");
            continue;
        }
        if (type === "refusal") {
            if (Object.keys(part).some((key) => !new Set(["type", "refusal"]).has(key))) throw providerError("INVALID_CONTINUATION");
            if (typeof part["refusal"] !== "string" || part["refusal"].length > MAX_TEXT_LENGTH) throw providerError("INVALID_CONTINUATION");
            continue;
        }
        throw providerError("INVALID_CONTINUATION");
    }
}

function validateGooglePart(part: JsonObject, declaredNames: ReadonlySet<string>): void {
    const keys = Object.keys(part);
    if (keys.some((key) => !new Set(["text", "functionCall", "functionResponse", "thoughtSignature", "thought"]).has(key))) throw providerError("INVALID_CONTINUATION");
    if (part["text"] !== undefined && (typeof part["text"] !== "string" || part["text"].length > MAX_TEXT_LENGTH)) throw providerError("INVALID_CONTINUATION");
    if (part["thoughtSignature"] !== undefined && (typeof part["thoughtSignature"] !== "string" || part["thoughtSignature"].length === 0 || part["thoughtSignature"].length > MAX_TEXT_LENGTH)) throw providerError("INVALID_CONTINUATION");
    if (part["thought"] !== undefined && typeof part["thought"] !== "boolean") throw providerError("INVALID_CONTINUATION");
    if (part["functionCall"] !== undefined) {
        const call = cloneJsonObject(part["functionCall"], "INVALID_CONTINUATION");
        if (Object.keys(call).some((key) => !new Set(["name", "args", "id", "thoughtSignature"]).has(key))) throw providerError("INVALID_CONTINUATION");
        const name = requireSafeToolName(call["name"], "INVALID_CONTINUATION");
        if (!declaredNames.has(name) || !Object.prototype.hasOwnProperty.call(call, "args")) throw providerError("INVALID_CONTINUATION", { field: "toolName" });
        cloneJsonValue(call["args"], "INVALID_CONTINUATION");
        if (call["id"] !== undefined) requireSafeReference(call["id"], "toolCallId", "INVALID_CONTINUATION");
        if (call["thoughtSignature"] !== undefined && (typeof call["thoughtSignature"] !== "string" || call["thoughtSignature"].length === 0 || call["thoughtSignature"].length > MAX_TEXT_LENGTH)) throw providerError("INVALID_CONTINUATION");
    }
    if (part["functionResponse"] !== undefined) {
        const response = cloneJsonObject(part["functionResponse"], "INVALID_CONTINUATION");
        if (Object.keys(response).some((key) => !new Set(["name", "response", "id"]).has(key))) throw providerError("INVALID_CONTINUATION");
        const name = requireSafeToolName(response["name"], "INVALID_CONTINUATION");
        if (!declaredNames.has(name) || !Object.prototype.hasOwnProperty.call(response, "response")) throw providerError("INVALID_CONTINUATION", { field: "toolName" });
        cloneJsonValue(response["response"], "INVALID_CONTINUATION");
        if (response["id"] !== undefined) requireSafeReference(response["id"], "toolCallId", "INVALID_CONTINUATION");
    }
    if (part["functionCall"] !== undefined && part["functionResponse"] !== undefined) throw providerError("INVALID_CONTINUATION");
    if (part["text"] === undefined && part["functionCall"] === undefined && part["functionResponse"] === undefined && part["thoughtSignature"] === undefined && part["thought"] !== true) {
        throw providerError("INVALID_CONTINUATION");
    }
}

function validateGoogleHistoryItem(item: JsonObject, declaredNames: ReadonlySet<string>): void {
    if (Object.keys(item).some((key) => !new Set(["role", "parts"]).has(key)) || (item["role"] !== "user" && item["role"] !== "model")) throw providerError("INVALID_CONTINUATION");
    const parts = item["parts"];
    if (!Array.isArray(parts) || parts.length === 0) throw providerError("INVALID_CONTINUATION");
    for (const rawPart of parts) validateGooglePart(cloneJsonObject(rawPart, "INVALID_CONTINUATION"), declaredNames);
}

function validateGoogleSystemInstruction(value: unknown): void {
    const system = cloneJsonObject(value, "INVALID_CONTINUATION");
    if (Object.keys(system).some((key) => key !== "parts") || !Array.isArray(system["parts"]) || system["parts"].length === 0) throw providerError("INVALID_CONTINUATION", { field: "systemInstruction" });
    for (const rawPart of system["parts"] as readonly JsonValue[]) {
        const part = cloneJsonObject(rawPart, "INVALID_CONTINUATION");
        if (Object.keys(part).some((key) => key !== "text") || typeof part["text"] !== "string" || part["text"].length > MAX_TEXT_LENGTH) throw providerError("INVALID_CONTINUATION", { field: "systemInstruction" });
    }
}

function validateOpenAIPendingConsistency(history: readonly JsonObject[], pending: readonly ConversationToolCall[]): void {
    const calls = new Map<string, { readonly name: string; readonly arguments: string }>();
    const outputs = new Set<string>();
    for (const item of history) {
        if (item["type"] === "function_call") {
            const id = item["call_id"] as string;
            if (calls.has(id)) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
            calls.set(id, { name: item["name"] as string, arguments: item["arguments"] as string });
            continue;
        }
        if (item["type"] === "function_call_output") {
            const id = item["call_id"] as string;
            if (!calls.has(id) || outputs.has(id)) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
            outputs.add(id);
        }
    }
    const unpaired = [...calls.entries()].filter(([id]) => !outputs.has(id));
    if (unpaired.length !== pending.length) throw providerError("INVALID_CONTINUATION", { field: "pendingToolCalls" });
    const pendingById = new Map(pending.map((call) => [call.id, call]));
    for (const [id, call] of unpaired) {
        const expected = pendingById.get(id);
        if (!expected || expected.name !== call.name) throw providerError("INVALID_CONTINUATION", { field: "pendingToolCalls" });
        const args = parseJsonObject(call.arguments, "INVALID_CONTINUATION");
        if (serializeJsonValue(args, "INVALID_CONTINUATION") !== serializeJsonValue(expected.arguments, "INVALID_CONTINUATION")) {
            throw providerError("INVALID_CONTINUATION", { field: "pendingToolCalls" });
        }
    }
}

function validateGooglePendingConsistency(history: readonly JsonObject[], pending: readonly ConversationToolCall[]): void {
    const calls = new Map<string, string>();
    const outputs = new Set<string>();
    // Google does not require functionCall.id. The adapter assigns a local ID
    // while normalizing such calls; reconstruct the same deterministic ID from
    // the retained item/part position so the continuation can pair its later
    // functionResponse without mutating the native part.
    const usedIds = new Set<string>();
    for (let itemIndex = 0; itemIndex < history.length; itemIndex += 1) {
        const item = history[itemIndex]!;
        const parts = item["parts"];
        if (!Array.isArray(parts)) continue;
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
            const rawPart = parts[partIndex];
            const part = cloneJsonObject(rawPart, "INVALID_CONTINUATION");
            const call = isRecord(part["functionCall"]) ? part["functionCall"] : undefined;
            if (call) {
                const nativeId = typeof call["id"] === "string" ? call["id"] : undefined;
                const base = `local-call-${itemIndex}-${partIndex + 1}`;
                let id = nativeId ?? base;
                let suffix = 1;
                while (nativeId === undefined && usedIds.has(id)) id = `${base}-${suffix++}`;
                if (usedIds.has(id)) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
                calls.set(id, call["name"] as string);
                usedIds.add(id);
            }
            const response = isRecord(part["functionResponse"]) ? part["functionResponse"] : undefined;
            if (response) {
                if (typeof response["id"] !== "string") throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
                const id = response["id"];
                if (calls.has(id)) {
                    if (outputs.has(id)) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
                    if (calls.get(id) !== response["name"]) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
                    outputs.add(id);
                } else {
                    throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
                }
            }
        }
    }
    const explicitUnpaired = [...calls.entries()].filter(([id]) => !outputs.has(id));
    const pendingExplicit = pending.filter((call) => calls.has(call.id));
    if (explicitUnpaired.length !== pendingExplicit.length) throw providerError("INVALID_CONTINUATION", { field: "pendingToolCalls" });
    for (const [id, name] of explicitUnpaired) {
        const expected = pending.find((call) => call.id === id);
        if (!expected || expected.name !== name) throw providerError("INVALID_CONTINUATION", { field: "pendingToolCalls" });
    }
    if (pending.length !== explicitUnpaired.length) throw providerError("INVALID_CONTINUATION", { field: "pendingToolCalls" });
}

function validateContinuation(
    continuation: ConversationProviderContinuation,
    provider: ConversationProvider,
    profile: ConversationProviderProfile,
    declaredNames: ReadonlySet<string>,
    messages: readonly ConversationMessage[],
): void {
    validateContinuationBinding(continuation, provider, profile);
    const pending = validatePendingToolCalls(continuation.pendingToolCalls, declaredNames);
    const history = cloneBoundedHistory(continuation.history);
    if (provider === "openai") {
        for (const item of history) validateOpenAIHistoryItem(item, declaredNames);
        validateOpenAIPendingConsistency(history, pending);
        if (profile.reasoningContinuation && pending.length > 0 && !history.some((item) => item["type"] === "reasoning" && typeof item["encrypted_content"] === "string" && item["encrypted_content"].length > 0 && item["encrypted_content"].length <= MAX_TEXT_LENGTH)) {
            throw providerError("MISSING_CONTINUATION");
        }
    } else {
        for (const item of history) validateGoogleHistoryItem(item, declaredNames);
        validateGooglePendingConsistency(history, pending);
        const googleContinuation = continuation.provider === "google" ? continuation : undefined;
        if (googleContinuation?.systemInstruction !== undefined) validateGoogleSystemInstruction(googleContinuation.systemInstruction);
    }
    assertContinuationSize({
        provider: continuation.provider,
        codecVersion: continuation.codecVersion,
        profileId: continuation.profileId,
        profileVersion: continuation.profileVersion,
        modelId: continuation.modelId,
        history,
        pendingToolCalls: pending,
        ...(continuation.provider === "google" && continuation.systemInstruction === undefined ? {} : continuation.provider === "google" ? { systemInstruction: continuation.systemInstruction } : {}),
    });
    if (pending.length > 0) {
        const outputs = new Map<string, string>();
        for (const message of messages) {
            if (message.role !== "tool") throw providerError("INVALID_CONTINUATION", { field: "messages" });
            if (outputs.has(message.toolCallId)) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
            const expected = pending.find((call) => call.id === message.toolCallId);
            if (!expected || expected.name !== message.name) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
            outputs.set(message.toolCallId, message.name);
        }
        if (outputs.size !== pending.length) throw providerError("INVALID_CONTINUATION", { field: "toolCallId" });
    } else {
        for (const message of messages) {
            if (message.role !== "user") throw providerError("INVALID_CONTINUATION", { field: "messages" });
        }
    }
}

export function validateConversationRequest(request: ConversationEvaluationRequest, provider: ConversationProvider, profile: ConversationProviderProfile): void {
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
    if (request.continuation !== undefined) validateContinuation(request.continuation, provider, profile, declaredNames, request.messages);
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
