import { NotFoundException } from "@nestjs/common";
import { MessageService } from "application/services/message.service";
import {
    CreateMessageUsecase,
    DeleteMessageUsecase,
    FindMessageByIdUsecase,
    ListMessagesUsecase,
    UpdateMessageUsecase,
} from "application/usecases/message";
import { MessageEntity } from "domain/entities/message.entity";

// MessageService is a thin branch-scoped facade over the message CRUD usecases.
// It performs no dispatch/paid-send logic itself (that lives in the aligo /
// alimtalk* / message-sender-approval services). The behaviours worth locking
// down here are therefore: (1) every call is forwarded to the correct usecase
// with the branchId and arguments intact — a mis-wired delegation would read or
// mutate the wrong tenant's data — (2) the usecase result is passed through
// untouched, and (3) errors from the usecase propagate rather than being
// swallowed.

describe("MessageService", () => {
    const branchId = "branch-1";
    const otherBranchId = "branch-2";

    const createMessage = (overrides: Partial<{ id: number; title: string; text: string }> = {}): MessageEntity =>
        MessageEntity.reconstitute(
            overrides.id ?? 1,
            overrides.title ?? "공지",
            overrides.text ?? "본문",
            new Date("2026-05-01T00:00:00.000Z"),
            null,
        );

    const createMockUsecase = () => ({ execute: jest.fn() });

    let createMessageUsecase: ReturnType<typeof createMockUsecase>;
    let listMessagesUsecase: ReturnType<typeof createMockUsecase>;
    let findMessageByIdUsecase: ReturnType<typeof createMockUsecase>;
    let updateMessageUsecase: ReturnType<typeof createMockUsecase>;
    let deleteMessageUsecase: ReturnType<typeof createMockUsecase>;
    let service: MessageService;

    beforeEach(() => {
        createMessageUsecase = createMockUsecase();
        listMessagesUsecase = createMockUsecase();
        findMessageByIdUsecase = createMockUsecase();
        updateMessageUsecase = createMockUsecase();
        deleteMessageUsecase = createMockUsecase();

        service = new MessageService(
            createMessageUsecase as unknown as CreateMessageUsecase,
            listMessagesUsecase as unknown as ListMessagesUsecase,
            findMessageByIdUsecase as unknown as FindMessageByIdUsecase,
            updateMessageUsecase as unknown as UpdateMessageUsecase,
            deleteMessageUsecase as unknown as DeleteMessageUsecase,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("findAll", () => {
        it("should forward the branchId to the list usecase and return its result", async () => {
            const messages = [createMessage({ id: 1 }), createMessage({ id: 2 })];
            listMessagesUsecase.execute.mockResolvedValue(messages);

            await expect(service.findAll(branchId)).resolves.toBe(messages);

            expect(listMessagesUsecase.execute).toHaveBeenCalledTimes(1);
            expect(listMessagesUsecase.execute).toHaveBeenCalledWith(branchId);
        });

        it("should scope the list to the branch it is asked for", async () => {
            listMessagesUsecase.execute.mockResolvedValue([]);

            await service.findAll(otherBranchId);

            expect(listMessagesUsecase.execute).toHaveBeenCalledWith(otherBranchId);
            expect(listMessagesUsecase.execute).not.toHaveBeenCalledWith(branchId);
        });

        it("should not touch any other usecase", async () => {
            listMessagesUsecase.execute.mockResolvedValue([]);

            await service.findAll(branchId);

            expect(createMessageUsecase.execute).not.toHaveBeenCalled();
            expect(findMessageByIdUsecase.execute).not.toHaveBeenCalled();
            expect(updateMessageUsecase.execute).not.toHaveBeenCalled();
            expect(deleteMessageUsecase.execute).not.toHaveBeenCalled();
        });

        it("should propagate errors from the list usecase", async () => {
            listMessagesUsecase.execute.mockRejectedValue(new Error("db down"));

            await expect(service.findAll(branchId)).rejects.toThrow("db down");
        });
    });

    describe("create", () => {
        it("should forward branchId, title and text in order to the create usecase", async () => {
            const created = createMessage({ id: 7, title: "제목", text: "내용" });
            createMessageUsecase.execute.mockResolvedValue(created);

            await expect(service.create(branchId, "제목", "내용")).resolves.toBe(created);

            expect(createMessageUsecase.execute).toHaveBeenCalledTimes(1);
            expect(createMessageUsecase.execute).toHaveBeenCalledWith(branchId, "제목", "내용");
        });

        it("should create against the branch it is asked for", async () => {
            createMessageUsecase.execute.mockResolvedValue(createMessage());

            await service.create(otherBranchId, "t", "b");

            expect(createMessageUsecase.execute).toHaveBeenCalledWith(otherBranchId, "t", "b");
            expect(createMessageUsecase.execute).not.toHaveBeenCalledWith(branchId, "t", "b");
        });

        it("should not invoke the mutating sibling usecases", async () => {
            createMessageUsecase.execute.mockResolvedValue(createMessage());

            await service.create(branchId, "t", "b");

            expect(updateMessageUsecase.execute).not.toHaveBeenCalled();
            expect(deleteMessageUsecase.execute).not.toHaveBeenCalled();
        });

        it("should propagate errors from the create usecase", async () => {
            createMessageUsecase.execute.mockRejectedValue(new Error("insert failed"));

            await expect(service.create(branchId, "t", "b")).rejects.toThrow("insert failed");
        });
    });

    describe("findById", () => {
        it("should forward branchId and id and return the found message", async () => {
            const message = createMessage({ id: 42 });
            findMessageByIdUsecase.execute.mockResolvedValue(message);

            await expect(service.findById(branchId, 42)).resolves.toBe(message);

            expect(findMessageByIdUsecase.execute).toHaveBeenCalledTimes(1);
            expect(findMessageByIdUsecase.execute).toHaveBeenCalledWith(branchId, 42);
        });

        it("should pass through a null result when the message is missing", async () => {
            findMessageByIdUsecase.execute.mockResolvedValue(null);

            await expect(service.findById(branchId, 999)).resolves.toBeNull();
        });

        it("should scope the lookup to the branch it is asked for", async () => {
            findMessageByIdUsecase.execute.mockResolvedValue(null);

            await service.findById(otherBranchId, 42);

            expect(findMessageByIdUsecase.execute).toHaveBeenCalledWith(otherBranchId, 42);
            expect(findMessageByIdUsecase.execute).not.toHaveBeenCalledWith(branchId, 42);
        });

        it("should propagate errors from the find usecase", async () => {
            findMessageByIdUsecase.execute.mockRejectedValue(new Error("lookup failed"));

            await expect(service.findById(branchId, 42)).rejects.toThrow("lookup failed");
        });
    });

    describe("update", () => {
        it("should forward branchId, id, title and text in order and return the result", async () => {
            const updated = createMessage({ id: 5, title: "새 제목", text: "새 본문" });
            updateMessageUsecase.execute.mockResolvedValue(updated);

            await expect(service.update(branchId, 5, "새 제목", "새 본문")).resolves.toBe(updated);

            expect(updateMessageUsecase.execute).toHaveBeenCalledTimes(1);
            expect(updateMessageUsecase.execute).toHaveBeenCalledWith(branchId, 5, "새 제목", "새 본문");
        });

        it("should scope the update to the branch it is asked for", async () => {
            updateMessageUsecase.execute.mockResolvedValue(createMessage({ id: 5 }));

            await service.update(otherBranchId, 5, "t", "b");

            expect(updateMessageUsecase.execute).toHaveBeenCalledWith(otherBranchId, 5, "t", "b");
            expect(updateMessageUsecase.execute).not.toHaveBeenCalledWith(branchId, 5, "t", "b");
        });

        it("should propagate NotFoundException from the update usecase", async () => {
            updateMessageUsecase.execute.mockRejectedValue(new NotFoundException("Message with id 5 not found"));

            await expect(service.update(branchId, 5, "t", "b")).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe("delete", () => {
        it("should forward branchId and id to the delete usecase", async () => {
            deleteMessageUsecase.execute.mockResolvedValue(undefined);

            await expect(service.delete(branchId, 3)).resolves.toBeUndefined();

            expect(deleteMessageUsecase.execute).toHaveBeenCalledTimes(1);
            expect(deleteMessageUsecase.execute).toHaveBeenCalledWith(branchId, 3);
        });

        it("should scope the delete to the branch it is asked for", async () => {
            deleteMessageUsecase.execute.mockResolvedValue(undefined);

            await service.delete(otherBranchId, 3);

            expect(deleteMessageUsecase.execute).toHaveBeenCalledWith(otherBranchId, 3);
            expect(deleteMessageUsecase.execute).not.toHaveBeenCalledWith(branchId, 3);
        });

        it("should not invoke any other usecase when deleting", async () => {
            deleteMessageUsecase.execute.mockResolvedValue(undefined);

            await service.delete(branchId, 3);

            expect(createMessageUsecase.execute).not.toHaveBeenCalled();
            expect(updateMessageUsecase.execute).not.toHaveBeenCalled();
            expect(findMessageByIdUsecase.execute).not.toHaveBeenCalled();
            expect(listMessagesUsecase.execute).not.toHaveBeenCalled();
        });

        it("should propagate errors from the delete usecase", async () => {
            deleteMessageUsecase.execute.mockRejectedValue(new Error("delete failed"));

            await expect(service.delete(branchId, 3)).rejects.toThrow("delete failed");
        });
    });
});
