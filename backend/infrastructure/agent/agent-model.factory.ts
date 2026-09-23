import { createGoogleGenerativeAI, type GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { LanguageModel } from "ai";

import { DeterministicAgentLanguageModel } from "./deterministic-agent-language-model";

export const DEFAULT_AGENT_MODEL = "gemini-3.5-flash-lite";

const AGENT_THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number];

function isAgentThinkingLevel(value: string): value is AgentThinkingLevel {
    return (AGENT_THINKING_LEVELS as readonly string[]).includes(value);
}

@Injectable()
export class AgentModelFactory {
    private readonly logger = new Logger(AgentModelFactory.name);
    private warnedInvalidThinkingLevel = false;

    constructor(private readonly configService: ConfigService) {}

    create(): LanguageModel {
        if (this.configService.get<string>("E2E_VENDOR_STUBS") === "1") {
            return new DeterministicAgentLanguageModel([
                { type: "tool-call", toolName: "clients_search", input: { query: "홍길동" } },
                { type: "text", text: "[agent-e2e-stub] 조회 결과를 확인했습니다." },
            ]) as LanguageModel;
        }

        const apiKey = this.configService.get<string>("GEMINI_API_KEY");
        if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

        const google = createGoogleGenerativeAI({ apiKey });
        return google(this.modelId);
    }

    get modelId(): string {
        return this.configService.get<string>("AGENT_MODEL") || DEFAULT_AGENT_MODEL;
    }

    /**
     * `AGENT_THINKING_LEVEL` is an opt-in hint to Gemini 3's
     * `thinkingConfig.thinkingLevel`. Gemini 3 models already reason by
     * default, so unset/empty means "no opinion" — `null` here, never a
     * default level — rather than silently forcing a (possibly lower)
     * reasoning depth. An unrecognized value degrades to the same `null`
     * after logging exactly one warning; it never throws at request time.
     */
    get thinkingLevel(): AgentThinkingLevel | null {
        const raw = this.configService.get<string>("AGENT_THINKING_LEVEL")?.trim();
        if (!raw) return null;
        if (isAgentThinkingLevel(raw)) return raw;
        if (!this.warnedInvalidThinkingLevel) {
            this.warnedInvalidThinkingLevel = true;
            this.logger.warn(`Invalid AGENT_THINKING_LEVEL "${raw}"; using the model default (no thinkingLevel sent).`);
        }
        return null;
    }

    /**
     * Provider options for the runtime `streamText` call only — never for
     * `capability-router.service.ts`'s `generateText` call via `create()`,
     * which stays on its existing plain model. Deterministic E2E stub mode
     * returns no options so the fixture model stays fully deterministic.
     */
    providerOptions(): { google?: GoogleGenerativeAIProviderOptions } {
        if (this.configService.get<string>("E2E_VENDOR_STUBS") === "1") return {};
        const level = this.thinkingLevel;
        return {
            google: {
                thinkingConfig: {
                    includeThoughts: false,
                    ...(level ? { thinkingLevel: level } : {}),
                },
            },
        };
    }

    /**
     * `maxOutputTokens` for the runtime `streamText` call. Thinking tokens
     * count against this cap on Gemini, so `high` gets a larger budget, and so
     * does the unset default, where the model picks its own thinking depth.
     */
    maxOutputTokens(): number {
        return this.thinkingLevel === null || this.thinkingLevel === "high" ? 8192 : 4096;
    }
}
