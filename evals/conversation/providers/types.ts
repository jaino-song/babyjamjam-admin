import type { ConversationTransport } from "../evaluation-policy";

export const CONVERSATION_PROVIDER_CODEC_VERSION = "conversation-provider-codec-v1" as const;
export const GOOGLE_GENERATE_CONTENT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models" as const;
export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses" as const;

export type ConversationProvider = "google" | "openai";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
    readonly [key: string]: JsonValue;
}

export interface ConversationToolDeclaration {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: JsonObject;
    readonly strict?: boolean;
}

export interface ConversationToolCall {
    readonly id: string;
    readonly name: string;
    readonly arguments: JsonValue;
}

export interface ConversationTextMessage {
    readonly role: "system" | "user" | "assistant";
    readonly text: string;
}

export interface ConversationAssistantToolCallMessage {
    readonly role: "assistant";
    readonly text?: string;
    readonly toolCalls: readonly ConversationToolCall[];
}

export interface ConversationToolResultMessage {
    readonly role: "tool";
    readonly toolCallId: string;
    readonly name: string;
    readonly output: JsonValue;
}

export type ConversationMessage =
    | ConversationTextMessage
    | ConversationAssistantToolCallMessage
    | ConversationToolResultMessage;

/**
 * A continuation is an untrusted, provider-bound snapshot of the complete
 * native conversation. The adapter only returns one after `run()` has paired
 * the encoded request with a successful provider response. `parseResponse()`
 * deliberately does not expose this shape because a response fragment alone
 * cannot resume a stateless conversation.
 */
export interface GoogleContinuation {
    readonly provider: "google";
    readonly codecVersion: typeof CONVERSATION_PROVIDER_CODEC_VERSION;
    readonly profileId: string;
    readonly profileVersion: string;
    readonly modelId: string;
    /** Native `contents` in chronological order, including model output. */
    readonly history: readonly JsonObject[];
    /** Native systemInstruction retained separately from `contents`. */
    readonly systemInstruction?: JsonObject;
    /** Tool calls in the latest model output that still await results. */
    readonly pendingToolCalls: readonly ConversationToolCall[];
}

export interface OpenAIContinuation {
    readonly provider: "openai";
    readonly codecVersion: typeof CONVERSATION_PROVIDER_CODEC_VERSION;
    readonly profileId: string;
    readonly profileVersion: string;
    readonly modelId: string;
    /** Native Responses `input` items in chronological order. */
    readonly history: readonly JsonObject[];
    /** Function calls in the latest response that still await outputs. */
    readonly pendingToolCalls: readonly ConversationToolCall[];
}

export type ConversationProviderContinuation = GoogleContinuation | OpenAIContinuation;

/**
 * The normalized request is shared by both codecs. Version references are
 * evaluator metadata and are deliberately not copied into provider prompts.
 */
export interface ConversationEvaluationRequest {
    readonly fixtureVersion: string;
    readonly promptVersion: string;
    readonly contextVersion: string;
    readonly maxSteps: number;
    readonly messages: readonly ConversationMessage[];
    readonly tools?: readonly ConversationToolDeclaration[];
    readonly continuation?: ConversationProviderContinuation;
}

export type ConversationProviderOutcome = "text" | "tool_calls" | "refusal" | "blocked" | "incomplete";

export type UnavailableNumber = number | "unavailable";

export interface ConversationUsageMetadata {
    readonly inputTokens: UnavailableNumber;
    readonly outputTokens: UnavailableNumber;
    readonly totalTokens: UnavailableNumber;
    readonly cost: "unavailable";
}

export interface ConversationProviderMetadata {
    readonly codecVersion: typeof CONVERSATION_PROVIDER_CODEC_VERSION;
    readonly provider: ConversationProvider;
    readonly profileId: string;
    readonly profileVersion: string;
    readonly model: string;
    readonly responseId?: string;
    readonly modelVersion?: string;
    readonly finishReason?: string;
    readonly usage: ConversationUsageMetadata;
    readonly fixtureVersion?: string;
    readonly promptVersion?: string;
    readonly contextVersion?: string;
    readonly maxSteps?: number;
}

export interface ConversationProviderResponse {
    readonly outcome: ConversationProviderOutcome;
    readonly text?: string;
    readonly toolCalls?: readonly ConversationToolCall[];
    readonly continuation?: ConversationProviderContinuation;
    readonly metadata: ConversationProviderMetadata;
}

export interface ConversationProviderProfile {
    readonly provider: ConversationProvider;
    readonly profileId: string;
    readonly modelId: string;
    readonly profileVersion: string;
    /** OpenAI reasoning profiles require encrypted continuation on tool rounds. */
    readonly reasoningContinuation: boolean;
    /** Mock-only IDs must be visibly test-only and can never be implicit defaults. */
    readonly testOnly: boolean;
}

export interface ConversationProviderProfileRegistry {
    readonly profiles: readonly ConversationProviderProfile[];
    resolve(profileId: string): ConversationProviderProfile;
}

export interface ConversationProviderAdapterOptions {
    readonly registry: ConversationProviderProfileRegistry;
    readonly profileId: string;
    readonly transport: ConversationTransport;
    /** An explicit ephemeral key may be supplied by a caller; adapters never read env. */
    readonly apiKey?: string;
}

export interface ConversationProviderAdapter {
    readonly provider: ConversationProvider;
    readonly profile: ConversationProviderProfile;
    run(request: ConversationEvaluationRequest): Promise<ConversationProviderResponse>;
    encodeRequest(request: ConversationEvaluationRequest): EncodedProviderRequest;
    parseResponse(response: unknown, declaredToolNames?: ReadonlySet<string>): ConversationProviderResponse;
}

export interface EncodedProviderRequest {
    readonly url: string;
    readonly init: {
        readonly method: "POST";
        readonly headers: Readonly<Record<string, string>>;
        readonly body: string;
        readonly redirect: "error";
    };
}

export interface SafeProviderEvaluationReport {
    readonly outcome: ConversationProviderOutcome;
    readonly provider: ConversationProvider;
    readonly profileId: string;
    readonly profileVersion: string;
    readonly model: string;
    readonly textLength: number;
    readonly toolCallCount: number;
    readonly usage: ConversationUsageMetadata;
    readonly fixtureVersion?: string;
    readonly promptVersion?: string;
    readonly contextVersion?: string;
    readonly maxSteps?: number;
    readonly responseId?: string;
    readonly modelVersion?: string;
    readonly finishReason?: string;
}
