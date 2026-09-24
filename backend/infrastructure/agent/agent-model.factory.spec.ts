import { ConfigService } from "@nestjs/config";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { AgentModelFactory, DEFAULT_AGENT_MODEL } from "./agent-model.factory";
import { DeterministicAgentLanguageModel } from "./deterministic-agent-language-model";

describe("AgentModelFactory", () => {
    it("uses the new runtime model without changing the legacy gateway default", () => {
        const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test" }));
        expect(factory.modelId).toBe(DEFAULT_AGENT_MODEL);
    });

    it("drives a real streamText tool loop deterministically", async () => {
        const execute = jest.fn(async ({ query }: { query: string }) => ({ id: "client-1", query }));
        const model = new DeterministicAgentLanguageModel([
            { type: "tool-call", toolName: "clients_search", input: { query: "홍길동" } },
            { type: "text", text: "홍길동 산모를 찾았습니다." },
        ]);

        const result = streamText({
            model,
            prompt: "홍길동 산모 찾아줘",
            stopWhen: stepCountIs(2),
            tools: {
                clients_search: tool({
                    inputSchema: z.object({ query: z.string() }),
                    execute,
                }),
            },
        });

        await expect(result.text).resolves.toBe("홍길동 산모를 찾았습니다.");
        expect(execute).toHaveBeenCalledWith(
            { query: "홍길동" },
            expect.objectContaining({ toolCallId: "deterministic-tool-1" }),
        );
    });

    describe("thinkingLevel", () => {
        it("is null when AGENT_THINKING_LEVEL is unset", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test" }));
            expect(factory.thinkingLevel).toBeNull();
        });

        it("is null when AGENT_THINKING_LEVEL is an empty string", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test", AGENT_THINKING_LEVEL: "" }));
            expect(factory.thinkingLevel).toBeNull();
        });

        it("accepts a valid override", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test", AGENT_THINKING_LEVEL: "medium" }));
            expect(factory.thinkingLevel).toBe("medium");
        });

        it("falls back to null and logs one warning for an invalid value", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test", AGENT_THINKING_LEVEL: "extreme" }));
            const logger = { warn: jest.fn() };
            (factory as unknown as { logger: { warn: (message: string) => void } }).logger = logger;
            expect(factory.thinkingLevel).toBeNull();
            expect(factory.thinkingLevel).toBeNull();
            expect(logger.warn).toHaveBeenCalledTimes(1);
        });
    });

    describe("providerOptions", () => {
        it("returns no thinkingLevel when AGENT_THINKING_LEVEL is unset (model default)", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test" }));
            expect(factory.providerOptions()).toEqual({
                google: { thinkingConfig: { includeThoughts: false } },
            });
        });

        it("passes through a valid override", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test", AGENT_THINKING_LEVEL: "high" }));
            expect(factory.providerOptions()).toEqual({
                google: { thinkingConfig: { includeThoughts: false, thinkingLevel: "high" } },
            });
        });

        it("returns no thinkingLevel for an invalid value (same as unset)", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test", AGENT_THINKING_LEVEL: "bogus" }));
            expect(factory.providerOptions()).toEqual({
                google: { thinkingConfig: { includeThoughts: false } },
            });
        });

        it("returns no provider options at all in E2E stub mode", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test", E2E_VENDOR_STUBS: "1", AGENT_THINKING_LEVEL: "high" }));
            expect(factory.providerOptions()).toEqual({});
        });
    });

    describe("maxOutputTokens", () => {
        it("is 8192 when thinkingLevel is unset, since the model then picks its own thinking depth", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test" }));
            expect(factory.maxOutputTokens()).toBe(8192);
        });

        it("is 4096 for low/medium", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test", AGENT_THINKING_LEVEL: "medium" }));
            expect(factory.maxOutputTokens()).toBe(4096);
        });

        it("is 8192 when thinkingLevel is high", () => {
            const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test", AGENT_THINKING_LEVEL: "high" }));
            expect(factory.maxOutputTokens()).toBe(8192);
        });
    });
});
