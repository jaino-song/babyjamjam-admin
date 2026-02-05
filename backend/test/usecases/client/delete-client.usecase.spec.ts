import { NotFoundException } from "@nestjs/common";
import { DeleteClientUsecase } from "application/usecases/client/delete-client.usecase";
import { MockClientRepository, ClientFactory } from "../../utils";

describe("DeleteClientUsecase", () => {
    let usecase: DeleteClientUsecase;
    let mockRepository: MockClientRepository;
    const organizationId = "org-1";

    beforeEach(() => {
        mockRepository = new MockClientRepository();
        usecase = new DeleteClientUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should delete existing client", async () => {
            // Arrange
            const existingClient = ClientFactory.create({ id: 1 });
            mockRepository.setData([existingClient]);

            // Act
            await usecase.execute(organizationId, 1);

            // Assert
            const result = await mockRepository.findById(organizationId, 1);
            expect(result).toBeNull();
        });

        it("should throw NotFoundException when client not found", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(usecase.execute(organizationId, 999)).rejects.toThrow(NotFoundException);
        });

        it("should throw NotFoundException with correct message", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(usecase.execute(organizationId, 42)).rejects.toThrow(
                "Client with id 42 not found",
            );
        });

        it("should not affect other clients when deleting", async () => {
            // Arrange
            const clients = ClientFactory.createMany(3);
            mockRepository.setData(clients);

            // Act
            await usecase.execute(organizationId, 2);

            // Assert
            const remaining = mockRepository.getAllData();
            expect(remaining).toHaveLength(2);
            expect(remaining.map(c => c.id)).toEqual([1, 3]);
        });

        it("should allow deleting all clients one by one", async () => {
            // Arrange
            const clients = ClientFactory.createMany(2);
            mockRepository.setData(clients);

            // Act
            await usecase.execute(organizationId, 1);
            await usecase.execute(organizationId, 2);

            // Assert
            const remaining = mockRepository.getAllData();
            expect(remaining).toHaveLength(0);
        });
    });
});
