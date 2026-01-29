import { GeminiChatGateway } from "infrastructure/api/gemini-chat.gateway";

function createMockReader(chunks: string[]) {
    const encoder = new TextEncoder();
    let idx = 0;
    return {
        read: async () => {
            if (idx >= chunks.length) {
                return { done: true, value: undefined } as const;
            }
            const value = encoder.encode(chunks[idx]);
            idx++;
            return { done: false, value } as const;
        },
        releaseLock: jest.fn(),
    };
}

describe("GeminiChatGateway.chatStream", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("emits done exactly once when finishReason STOP appears", async () => {
        const configService = {
            get: jest.fn((key: string) => {
                if (key === "GEMINI_API_KEY") return "test-key";
                if (key === "GEMINI_CHAT_MODEL") return "test-model";
                return undefined;
            }),
        } as any;

        const gateway = new GeminiChatGateway(configService);

        const sseLines = [
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hello\"}]},\"finishReason\":\"STOP\"}]}\n",
        ];

        const mockResponse = {
            ok: true,
            body: {
                getReader: () => createMockReader(sseLines),
            },
        };

        (global as any).fetch = jest.fn().mockResolvedValue(mockResponse);

        const events: Array<{ type: string; content?: string }> = [];
        for await (const evt of gateway.chatStream(
            [
                { role: "system", content: "sys" },
                { role: "user", content: "hi" },
            ],
            []
        )) {
            events.push(evt as any);
        }

        const doneCount = events.filter((e) => e.type === "done").length;
        expect(doneCount).toBe(1);
    });

    test("emits done exactly once when stream ends without STOP", async () => {
        const configService = {
            get: jest.fn((key: string) => {
                if (key === "GEMINI_API_KEY") return "test-key";
                if (key === "GEMINI_CHAT_MODEL") return "test-model";
                return undefined;
            }),
        } as any;

        const gateway = new GeminiChatGateway(configService);

        const sseLines = [
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hello\"}]}}]}\n",
        ];

        const mockResponse = {
            ok: true,
            body: {
                getReader: () => createMockReader(sseLines),
            },
        };

        (global as any).fetch = jest.fn().mockResolvedValue(mockResponse);

        const events: Array<{ type: string; content?: string }> = [];
        for await (const evt of gateway.chatStream(
            [
                { role: "system", content: "sys" },
                { role: "user", content: "hi" },
            ],
            []
        )) {
            events.push(evt as any);
        }

        const doneCount = events.filter((e) => e.type === "done").length;
        expect(doneCount).toBe(1);
    });
});
