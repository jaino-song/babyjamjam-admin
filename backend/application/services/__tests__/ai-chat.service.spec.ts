import { AIChatService } from "application/services/ai-chat.service";
import type { GeminiStreamChunk } from "infrastructure/api/gemini-chat.gateway";
import { ChatSessionEntity } from "domain/entities/chat-session.entity";

describe("AIChatService.chatStream", () => {
    test("does not persist duplicate assistant message when done arrives twice", async () => {
        const geminiGateway = {
            chatStream: jest.fn(),
        } as any;

        geminiGateway.chatStream.mockReturnValue(
            (async function* (): AsyncGenerator<GeminiStreamChunk> {
                yield { type: "text", content: "죄송합니다." };
                yield { type: "done" };
                yield { type: "done" };
            })()
        );

        const toolExecutor = {
            execute: jest.fn(),
        } as any;

        let storedSession: ChatSessionEntity | null = null;
        const sessionRepository = {
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async (session: ChatSessionEntity) => {
                (session as any).id = "test-session";
                storedSession = session;
                return session;
            }),
            update: jest.fn().mockImplementation(async (session: ChatSessionEntity) => {
                storedSession = session;
                return session;
            }),
        } as any;

        const service = new AIChatService(geminiGateway, toolExecutor, sessionRepository);

        const events = [] as any[];
        for await (const evt of service.chatStream(undefined, "user-1", "hello")) {
            events.push(evt);
        }

        expect(events.some((e) => e.type === "done")).toBe(true);
        expect(storedSession).not.toBeNull();

        const assistantMessages = storedSession!.messages.filter((m) => m.role === "assistant");
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]?.content).toBe("죄송합니다.");
    });
});
