export * from "./errors";
export * from "./types";
export { createGoogleConversationProviderAdapter, GoogleConversationProviderAdapter } from "./google";
export { createOpenAIConversationProviderAdapter, OpenAIConversationProviderAdapter } from "./openai";
export { createConversationProviderRegistry, validateConversationProviderProfile } from "./shared";

import type {
    ConversationProviderResponse,
    SafeProviderEvaluationReport,
} from "./types";

/**
 * Convert an adapter result into a report-safe summary. Opaque continuation,
 * provider bodies, prompts, headers, and keys intentionally do not cross this boundary.
 */
export function serializeProviderEvaluationReport(response: ConversationProviderResponse): SafeProviderEvaluationReport {
    return {
        outcome: response.outcome,
        provider: response.metadata.provider,
        profileId: response.metadata.profileId,
        profileVersion: response.metadata.profileVersion,
        model: response.metadata.model,
        textLength: response.text?.length ?? 0,
        toolCallCount: response.toolCalls?.length ?? 0,
        usage: response.metadata.usage,
        ...(response.metadata.fixtureVersion === undefined ? {} : { fixtureVersion: response.metadata.fixtureVersion }),
        ...(response.metadata.promptVersion === undefined ? {} : { promptVersion: response.metadata.promptVersion }),
        ...(response.metadata.contextVersion === undefined ? {} : { contextVersion: response.metadata.contextVersion }),
        ...(response.metadata.maxSteps === undefined ? {} : { maxSteps: response.metadata.maxSteps }),
        ...(response.metadata.responseId === undefined ? {} : { responseId: response.metadata.responseId }),
        ...(response.metadata.modelVersion === undefined ? {} : { modelVersion: response.metadata.modelVersion }),
        ...(response.metadata.finishReason === undefined ? {} : { finishReason: response.metadata.finishReason }),
    };
}
