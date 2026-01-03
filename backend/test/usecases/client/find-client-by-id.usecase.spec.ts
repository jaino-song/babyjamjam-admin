import { FindClientByIdUsecase } from "application/usecases/client/find-client-by-id.usecase";
import { MockClientRepository, ClientFactory } from "../../utils";

describe("FindClientByIdUsecase", () => {
    let usecase: FindClientByIdUsecase;
    let mockRepository: MockClientRepository;

    beforeEach(() => {
        mockRepository = new MockClientRepository();
        usecase = new FindClientByIdUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should return client when found", async () => {
            // Arrange
            const existingClient = ClientFactory.create({ id: 1, name: "테스트 고객" });
            mockRepository.setData([existingClient]);

            // Act
            const result = await usecase.execute(1);

            // Assert
            expect(result).not.toBeNull();
            expect(result?.id).toBe(1);
            expect(result?.name).toBe("테스트 고객");
        });

        it("should return null when client not found", async () => {
            // Arrange - empty repository

            // Act
            const result = await usecase.execute(999);

            // Assert
            expect(result).toBeNull();
        });

        it("should find specific client among multiple clients", async () => {
            // Arrange
            const clients = ClientFactory.createMany(5);
            mockRepository.setData(clients);

            // Act
            const result = await usecase.execute(3);

            // Assert
            expect(result).not.toBeNull();
            expect(result?.id).toBe(3);
            expect(result?.name).toBe("Test Client 3");
        });
    });
});
