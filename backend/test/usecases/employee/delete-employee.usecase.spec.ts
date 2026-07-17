import { DeleteEmployeeUsecase } from "application/usecases/employee/delete-employee.usecase";
import { IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("DeleteEmployeeUsecase", () => {
    let usecase: DeleteEmployeeUsecase;
    let mockRepository: MockEmployeeRepository & Pick<Required<IEmployeeRepository>, "hasActiveAssignments">;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository() as MockEmployeeRepository & Pick<Required<IEmployeeRepository>, "hasActiveAssignments">;
        mockRepository.hasActiveAssignments = jest.fn().mockResolvedValue(false);
        usecase = new DeleteEmployeeUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should reject deletion when the employee has an active assignment", async () => {
            const employee = EmployeeFactory.create({ id: 1 });
            mockRepository.setData([employee]);
            jest.mocked(mockRepository.hasActiveAssignments!).mockResolvedValue(true);

            await expect(usecase.execute(branchId, 1)).rejects.toMatchObject({
                status: 409,
                message: "진행 중인 배정이 있는 직원은 삭제할 수 없습니다. 배정 종료 또는 교체 후 다시 시도해 주세요.",
            });
            expect(await mockRepository.findById(branchId, 1)).toBe(employee);
        });
        // ============================================
        // Successful Deletion
        // ============================================
        describe("successful deletion", () => {
            it("should delete an existing employee", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);

                // Act
                await usecase.execute(branchId, 1);

                // Assert
                const result = await mockRepository.findById(branchId, 1);
                expect(result).toBeNull();
            });

            it("should return void on successful deletion", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId, 1);

                // Assert
                expect(result).toBeUndefined();
            });

            it("should only delete specified employee", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(5);
                mockRepository.setData(employees);

                // Act
                await usecase.execute(branchId, 3);

                // Assert
                const allEmployees = mockRepository.getAllData();
                expect(allEmployees).toHaveLength(4);
                expect(allEmployees.map(e => e.id)).not.toContain(3);
                expect(allEmployees.map(e => e.id)).toContain(1);
                expect(allEmployees.map(e => e.id)).toContain(2);
                expect(allEmployees.map(e => e.id)).toContain(4);
                expect(allEmployees.map(e => e.id)).toContain(5);
            });

            it("should allow deleting first employee", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(3);
                mockRepository.setData(employees);

                // Act
                await usecase.execute(branchId, 1);

                // Assert
                expect(mockRepository.getAllData()).toHaveLength(2);
                expect(await mockRepository.findById(branchId, 1)).toBeNull();
            });

            it("should allow deleting last employee", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(3);
                mockRepository.setData(employees);

                // Act
                await usecase.execute(branchId, 3);

                // Assert
                expect(mockRepository.getAllData()).toHaveLength(2);
                expect(await mockRepository.findById(branchId, 3)).toBeNull();
            });
        });

        // ============================================
        // Error Handling
        // ============================================
        describe("error handling", () => {
            it("should throw error when employee not found", async () => {
                // Arrange - empty repository

                // Act & Assert
                await expect(usecase.execute(branchId, 999)).rejects.toThrow();
            });

            it("should throw error with correct message", async () => {
                // Arrange - empty repository

                // Act & Assert
                await expect(usecase.execute(branchId, 42)).rejects.toThrow(
                    "Employee with id 42 not found",
                );
            });

            it("should not affect other employees when deletion fails", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(3);
                mockRepository.setData(employees);
                const beforeCount = mockRepository.getAllData().length;

                // Act
                try {
                    await usecase.execute(branchId, 999);
                } catch {
                    // Expected
                }

                // Assert
                expect(mockRepository.getAllData()).toHaveLength(beforeCount);
            });
        });

        // ============================================
        // Edge Cases
        // ============================================
        describe("edge cases", () => {
            it("should handle deleting the only employee", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);

                // Act
                await usecase.execute(branchId, 1);

                // Assert
                expect(mockRepository.getAllData()).toHaveLength(0);
            });

            it("should not allow double deletion", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1 });
                mockRepository.setData([employee]);

                // Act - first deletion should succeed
                await usecase.execute(branchId, 1);

                // Assert - second deletion should fail
                await expect(usecase.execute(branchId, 1)).rejects.toThrow();
            });
        });
    });
});
