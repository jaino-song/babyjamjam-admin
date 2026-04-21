import { ListClientsUsecase } from "application/usecases/client/list-clients.usecase";
import { MockClientRepository, ClientFactory } from "../../utils";

describe("ListClientsUsecase", () => {
    let usecase: ListClientsUsecase;
    let mockRepository: MockClientRepository;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockClientRepository();
        usecase = new ListClientsUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should return empty array when no clients exist", async () => {
            // Arrange - empty repository

            // Act
            const result = await usecase.execute(branchId);

            // Assert
            expect(result).toEqual([]);
        });

        it("should return all clients", async () => {
            // Arrange
            const clients = ClientFactory.createMany(3);
            mockRepository.setData(clients);

            // Act
            const result = await usecase.execute(branchId);

            // Assert
            expect(result).toHaveLength(3);
            expect(result[0]!.name).toBe("Test Client 1");
            expect(result[1]!.name).toBe("Test Client 2");
            expect(result[2]!.name).toBe("Test Client 3");
        });

        it("should return clients with different types", async () => {
            // Arrange
            const voucherClient = ClientFactory.createVoucherClient({ id: 1 });
            const careCenterClient = ClientFactory.createCareCenterClient({ id: 2 });
            mockRepository.setData([voucherClient, careCenterClient]);

            // Act
            const result = await usecase.execute(branchId);

            // Assert
            expect(result).toHaveLength(2);
            expect(result.some(c => c.voucherClient)).toBe(true);
            expect(result.some(c => c.careCenter)).toBe(true);
        });
    });
});
