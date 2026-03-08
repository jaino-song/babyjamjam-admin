import { NotFoundException } from "@nestjs/common";
import { ChangeEmployeeOpenStatusUsecase } from "application/usecases/employee/change-employee-open-status.usecase";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("ChangeEmployeeOpenStatusUsecase", () => {
    let usecase: ChangeEmployeeOpenStatusUsecase;
    let mockRepository: MockEmployeeRepository;
    const organizationId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new ChangeEmployeeOpenStatusUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should change status from true to false", async () => {
            // Arrange
            const employee = EmployeeFactory.createAvailable({ id: 1 });
            mockRepository.setData([employee]);

            // Act
            const result = await usecase.execute(organizationId, 1, false);

            // Assert
            expect(result.openToNextWork).toBe(false);
        });

        it("should change status from false to true", async () => {
            // Arrange
            const employee = EmployeeFactory.createUnavailable({ id: 1 });
            mockRepository.setData([employee]);

            // Act
            const result = await usecase.execute(organizationId, 1, true);

            // Assert
            expect(result.openToNextWork).toBe(true);
        });

        it("should persist the status change", async () => {
            // Arrange
            const employee = EmployeeFactory.createAvailable({ id: 1 });
            mockRepository.setData([employee]);

            // Act
            await usecase.execute(organizationId, 1, false);

            // Assert - verify persistence
            const persisted = await mockRepository.findById(organizationId, 1);
            expect(persisted?.openToNextWork).toBe(false);
        });

        it("should throw NotFoundException when employee not found", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(usecase.execute(organizationId, 999, true)).rejects.toThrow(
                NotFoundException,
            );
        });

        it("should throw NotFoundException with correct message", async () => {
            // Arrange - empty repository

            // Act & Assert
            await expect(usecase.execute(organizationId, 42, false)).rejects.toThrow(
                "Employee with id 42 not found",
            );
        });

        it("should not affect other employee fields", async () => {
            // Arrange
            const employee = EmployeeFactory.create({
                id: 1,
                name: "원본 이름",
                grade: "프리미엄",
                openToNextWork: true,
            });
            mockRepository.setData([employee]);

            // Act
            const result = await usecase.execute(organizationId, 1, false);

            // Assert
            expect(result.name).toBe("원본 이름");
            expect(result.grade).toBe("프리미엄");
            expect(result.openToNextWork).toBe(false);
        });

        it("should allow toggling status multiple times", async () => {
            // Arrange
            const employee = EmployeeFactory.createAvailable({ id: 1 });
            mockRepository.setData([employee]);

            // Act & Assert
            let result = await usecase.execute(organizationId, 1, false);
            expect(result.openToNextWork).toBe(false);

            result = await usecase.execute(organizationId, 1, true);
            expect(result.openToNextWork).toBe(true);

            result = await usecase.execute(organizationId, 1, false);
            expect(result.openToNextWork).toBe(false);
        });
    });
});
