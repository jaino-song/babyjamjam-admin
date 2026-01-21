import { GetChatHistoryUsecase } from "../../../application/usecases/ai-chat/get-chat-history.usecase";
import { ChatMessage, ChatSessionEntity } from "../../../domain/entities/chat-session.entity";
import { IChatSessionRepository } from "../../../domain/repositories/chat-session.repository.interface";

describe("GetChatHistoryUsecase", () => {
    const createRepository = (): jest.Mocked<IChatSessionRepository> => ({
        findById: jest.fn(),
        findByUserId: jest.fn(),
        findActiveByUserId: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteExpired: jest.fn(),
        deleteOlderThan: jest.fn(),
    });

    const createMessages = (count: number): ChatMessage[] => {
        return Array.from({ length: count }).map((_, i) => ({
            role: i % 2 === 0 ? "user" : "assistant",
            content: `m${i}`,
            timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        }));
    };

    describe("execute", () => {
        it("should return empty result when no session exists", async () => {
            const repo = createRepository();
            repo.findByUserId.mockResolvedValue(null);
            const usecase = new GetChatHistoryUsecase(repo);

            const result = await usecase.execute("user-1", 0, 20);

            expect(repo.findByUserId).toHaveBeenCalledWith("user-1");
            expect(result).toEqual({
                messages: [],
                total: 0,
                hasMore: false,
                sessionId: null,
                isSessionActive: false,
            });
        });

        it("should paginate messages and include expired sessions", async () => {
            const repo = createRepository();
            const session = ChatSessionEntity.reconstitute(
                "session-1",
                "user-1",
                createMessages(5),
                new Date("2026-01-01T00:00:00.000Z"),
                new Date("2025-01-01T00:00:00.000Z"), // expired
            );
            repo.findByUserId.mockResolvedValue(session);

            const usecase = new GetChatHistoryUsecase(repo);
            const result = await usecase.execute("user-1", 1, 2);

            expect(repo.findByUserId).toHaveBeenCalledWith("user-1");
            expect(repo.findActiveByUserId).not.toHaveBeenCalled();
            expect(result.total).toBe(5);
            expect(result.messages.map((m: ChatMessage) => m.content)).toEqual(["m2", "m3"]);
            expect(result.hasMore).toBe(true);
            expect(result.sessionId).toBe("session-1");
            expect(result.isSessionActive).toBe(false);
        });
    });
});
