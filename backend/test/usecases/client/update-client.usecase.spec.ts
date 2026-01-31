import { NotFoundException } from "@nestjs/common";
import { UpdateClientUsecase } from "application/usecases/client/update-client.usecase";
import { MockClientRepository, ClientFactory } from "../../utils";

describe("UpdateClientUsecase", () => {
    let usecase: UpdateClientUsecase;
    let mockRepository: MockClientRepository;

    beforeEach(() => {
        mockRepository = new MockClientRepository();
        usecase = new UpdateClientUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should update client name", async () => {
            // Arrange
            const existingClient = ClientFactory.create({ id: 1, name: "기존 이름" });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(1, { name: "변경된 이름" });

            // Assert
            expect(result.name).toBe("변경된 이름");
        });

        it("should update multiple fields", async () => {
            // Arrange
            const existingClient = ClientFactory.create({
                id: 1,
                name: "고객",
                address: "기존 주소",
                phone: "010-0000-0000",
            });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(1, {
                address: "새 주소",
                phone: "010-1111-1111",
                serviceStatus: "completed",
            });

            // Assert
            expect(result.address).toBe("새 주소");
            expect(result.phone).toBe("010-1111-1111");
            expect(result.serviceStatus).toBe("completed");
            expect(result.name).toBe("고객"); // 변경 안 됨
        });

        it("should update dueDate", async () => {
            // Arrange
            const existingClient = ClientFactory.create({ id: 1, name: "고객", dueDate: null });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(1, {
                dueDate: new Date("2024-03-01"),
            });

            // Assert
            expect(result.dueDate).toEqual(new Date("2024-03-01"));
        });

        it("should throw NotFoundException when client not found", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(
                usecase.execute(999, { name: "새 이름" }),
            ).rejects.toThrow(NotFoundException);
        });

        it("should throw NotFoundException with correct message", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(
                usecase.execute(123, { name: "새 이름" }),
            ).rejects.toThrow("Client with id 123 not found");
        });

        it("should persist changes to repository", async () => {
            // Arrange
            const existingClient = ClientFactory.create({ id: 1, name: "원본" });
            mockRepository.setData([existingClient]);

            // Act
            await usecase.execute(1, { name: "수정됨" });

            // Assert - verify persistence
            const persisted = await mockRepository.findById(1);
            expect(persisted?.name).toBe("수정됨");
        });
    });
});
