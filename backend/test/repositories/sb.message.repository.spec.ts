import { SbMessageRepository } from "infrastructure/database/repositories/sb.message.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageEntity } from "domain/entities/message.entity";

describe("SbMessageRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockPrismaMessage = () => ({
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    });

    const createMessageRow = (overrides = {}) => ({
        id: 1,
        title: "Hello",
        text: "World",
        created_at: new Date("2024-01-01T00:00:00.000Z"),
        edited_at: null,
        ...overrides,
    });

    const organizationId = "org-1";

    let messageModel: ReturnType<typeof createMockPrismaMessage>;
    let prisma: PrismaService;
    let repository: SbMessageRepository;

    beforeEach(() => {
        messageModel = createMockPrismaMessage();
        prisma = { message: messageModel } as unknown as PrismaService;
        repository = new SbMessageRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        describe("given a message exists with the specified id", () => {
            it("should return the mapped MessageEntity", async () => {
                // Arrange
                const now = new Date();
                const row = createMessageRow({ created_at: now });
                messageModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findById(organizationId, 1);

                // Assert
                expect(messageModel.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
                expect(result).toBeInstanceOf(MessageEntity);
                expect(result).toMatchObject({
                    id: 1,
                    title: "Hello",
                    text: "World",
                    createdAt: now,
                    editedAt: null,
                });
            });
        });

        describe("given a message with edited_at set", () => {
            it("should map editedAt correctly", async () => {
                // Arrange
                const createdAt = new Date("2024-01-01T00:00:00.000Z");
                const editedAt = new Date("2024-01-02T00:00:00.000Z");
                const row = createMessageRow({ created_at: createdAt, edited_at: editedAt });
                messageModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findById(organizationId, 1);

                // Assert
                expect(result?.editedAt).toEqual(editedAt);
            });
        });

        describe("given no message exists with the specified id", () => {
            it("should return null", async () => {
                // Arrange
                messageModel.findUnique.mockResolvedValue(null);

                // Act
                const result = await repository.findById(organizationId, 999);

                // Assert
                expect(messageModel.findUnique).toHaveBeenCalledWith({ where: { id: 999 } });
                expect(result).toBeNull();
            });
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        describe("given a valid MessageEntity", () => {
            it("should persist message and return created entity", async () => {
                // Arrange
                const entity = MessageEntity.create("Title", "Text");
                const createdRow = createMessageRow({
                    id: 2,
                    title: "Title",
                    text: "Text",
                });
                messageModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(organizationId, entity);

                // Assert
                expect(messageModel.create).toHaveBeenCalledWith({
                    data: {
                        title: "Title",
                        text: "Text",
                    },
                });
                expect(result).toMatchObject({ id: 2, title: "Title" });
            });
        });

        describe("given a message with long text content", () => {
            it("should persist the full content", async () => {
                // Arrange
                const longText = "A".repeat(1000);
                const entity = MessageEntity.create("Long Message", longText);
                const createdRow = createMessageRow({
                    id: 3,
                    title: "Long Message",
                    text: longText,
                });
                messageModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(organizationId, entity);

                // Assert
                expect(messageModel.create).toHaveBeenCalledWith({
                    data: {
                        title: "Long Message",
                        text: longText,
                    },
                });
                expect(result.text).toBe(longText);
            });
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given an existing MessageEntity with changes", () => {
            it("should update message with correct data", async () => {
                // Arrange
                const createdAt = new Date("2024-01-01T00:00:00.000Z");
                const editedAt = new Date("2024-01-02T00:00:00.000Z");
                const entity = new MessageEntity(3, "Updated", "Message updated", createdAt, editedAt);
                const updatedRow = createMessageRow({
                    id: 3,
                    title: "Updated",
                    text: "Message updated",
                    created_at: createdAt,
                    edited_at: editedAt,
                });
                messageModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(organizationId, entity);

                // Assert
                expect(messageModel.update).toHaveBeenCalledWith({
                    where: { id: 3 },
                    data: {
                        title: "Updated",
                        text: "Message updated",
                        edited_at: editedAt,
                    },
                });
                expect(result).toMatchObject({ id: 3, title: "Updated" });
            });
        });

        describe("given only title is changed", () => {
            it("should update with new title preserving text", async () => {
                // Arrange
                const createdAt = new Date("2024-01-01T00:00:00.000Z");
                const editedAt = new Date("2024-01-03T00:00:00.000Z");
                const entity = new MessageEntity(4, "New Title", "Original text", createdAt, editedAt);
                const updatedRow = createMessageRow({
                    id: 4,
                    title: "New Title",
                    text: "Original text",
                    edited_at: editedAt,
                });
                messageModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(organizationId, entity);

                // Assert
                expect(result.title).toBe("New Title");
                expect(result.text).toBe("Original text");
            });
        });

        describe("given only text is changed", () => {
            it("should update with new text preserving title", async () => {
                // Arrange
                const createdAt = new Date("2024-01-01T00:00:00.000Z");
                const editedAt = new Date("2024-01-04T00:00:00.000Z");
                const entity = new MessageEntity(5, "Original Title", "New text", createdAt, editedAt);
                const updatedRow = createMessageRow({
                    id: 5,
                    title: "Original Title",
                    text: "New text",
                    edited_at: editedAt,
                });
                messageModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(organizationId, entity);

                // Assert
                expect(result.title).toBe("Original Title");
                expect(result.text).toBe("New text");
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        describe("given a valid message id", () => {
            it("should delete the message", async () => {
                // Arrange
                messageModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete(organizationId, 4);

                // Assert
                expect(messageModel.delete).toHaveBeenCalledWith({ where: { id: 4 } });
            });
        });

        describe("given different message ids", () => {
            it.each([1, 10, 100, 999])("should delete message with id %i", async (id) => {
                // Arrange
                messageModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete(organizationId, id);

                // Assert
                expect(messageModel.delete).toHaveBeenCalledWith({ where: { id } });
            });
        });
    });
});
