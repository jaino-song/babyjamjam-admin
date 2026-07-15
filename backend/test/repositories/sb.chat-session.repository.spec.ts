import { SbChatSessionRepository } from "../../infrastructure/database/repositories/sb.chat-session.repository";
import { PrismaService } from "../../infrastructure/database/prisma.service";

describe("SbChatSessionRepository", () => {
    const createMockPrismaChatSession = () => ({
        deleteMany: jest.fn(),
    });

    let chatSessionModel: ReturnType<typeof createMockPrismaChatSession>;
    let prismaService: PrismaService;
    let repository: SbChatSessionRepository;

    beforeEach(() => {
        chatSessionModel = createMockPrismaChatSession();
        prismaService = {
            chat_session: chatSessionModel,
        } as unknown as PrismaService;

        repository = new SbChatSessionRepository(prismaService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("deleteOlderThan", () => {
        it("should delete sessions with createdAt < cutoffDate and return deleted count", async () => {
            // Arrange
            const cutoffDate = new Date("2024-01-01T00:00:00.000Z");
            chatSessionModel.deleteMany.mockResolvedValue({ count: 3 });

            // Act
            const deletedCount = await repository.deleteOlderThan(cutoffDate);

            // Assert
            expect(chatSessionModel.deleteMany).toHaveBeenCalledWith({
                where: { createdAt: { lt: cutoffDate } },
            });
            expect(deletedCount).toBe(3);
        });
    });
});
