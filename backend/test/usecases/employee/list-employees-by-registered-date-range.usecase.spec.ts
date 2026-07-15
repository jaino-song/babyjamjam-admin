import { ListEmployeesByRegisteredDateRangeUsecase } from "application/usecases/employee/list-employees-by-registered-date-range.usecase";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("ListEmployeesByRegisteredDateRangeUsecase", () => {
    let usecase: ListEmployeesByRegisteredDateRangeUsecase;
    let mockRepository: MockEmployeeRepository;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new ListEmployeesByRegisteredDateRangeUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        // ============================================
        // Basic Filtering
        // ============================================
        describe("basic filtering", () => {
            it("should return employees within date range", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-10") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-15") }),
                    EmployeeFactory.create({ id: 3, registeredDate: new Date("2024-01-20") }),
                    EmployeeFactory.create({ id: 4, registeredDate: new Date("2024-01-25") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-12"),
                    new Date("2024-01-22"),
                );

                // Assert
                expect(result).toHaveLength(2);
                expect(result.map(e => e.id)).toContain(2);
                expect(result.map(e => e.id)).toContain(3);
            });

            it("should return empty array when no employees in range", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-01") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-31") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-02-01"),
                    new Date("2024-02-28"),
                );

                // Assert
                expect(result).toEqual([]);
            });

            it("should return empty array when repository is empty", async () => {
                // Arrange - empty repository

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-01"),
                    new Date("2024-01-31"),
                );

                // Assert
                expect(result).toEqual([]);
            });
        });

        // ============================================
        // Boundary Dates
        // ============================================
        describe("boundary dates", () => {
            it("should include employees on start date (inclusive)", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    registeredDate: new Date("2024-01-15"),
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-15"), // start = same as registeredDate
                    new Date("2024-01-20"),
                );

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.id).toBe(1);
            });

            it("should include employees on end date (inclusive)", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    registeredDate: new Date("2024-01-20"),
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-15"),
                    new Date("2024-01-20"), // end = same as registeredDate
                );

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.id).toBe(1);
            });

            it("should handle same start and end date", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-15") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-16") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-15"),
                    new Date("2024-01-15"), // single day range
                );

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.id).toBe(1);
            });
        });

        // ============================================
        // Month and Year Spanning
        // ============================================
        describe("month and year spanning", () => {
            it("should span across multiple months", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-15") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-02-15") }),
                    EmployeeFactory.create({ id: 3, registeredDate: new Date("2024-03-15") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-01"),
                    new Date("2024-03-31"),
                );

                // Assert
                expect(result).toHaveLength(3);
            });

            it("should span across year boundary", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2023-12-15") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-15") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2023-12-01"),
                    new Date("2024-01-31"),
                );

                // Assert
                expect(result).toHaveLength(2);
            });
        });

        // ============================================
        // Various Range Sizes
        // ============================================
        describe("various range sizes", () => {
            it("should handle week-long range", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-08") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-10") }),
                    EmployeeFactory.create({ id: 3, registeredDate: new Date("2024-01-15") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-08"),
                    new Date("2024-01-14"), // One week
                );

                // Assert
                expect(result).toHaveLength(2);
                expect(result.map(e => e.id)).toContain(1);
                expect(result.map(e => e.id)).toContain(2);
            });

            it("should handle month-long range", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-01") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-15") }),
                    EmployeeFactory.create({ id: 3, registeredDate: new Date("2024-01-31") }),
                    EmployeeFactory.create({ id: 4, registeredDate: new Date("2024-02-01") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-01"),
                    new Date("2024-01-31"),
                );

                // Assert
                expect(result).toHaveLength(3);
            });

            it("should handle year-long range", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-15") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-06-15") }),
                    EmployeeFactory.create({ id: 3, registeredDate: new Date("2024-12-15") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-01"),
                    new Date("2024-12-31"),
                );

                // Assert
                expect(result).toHaveLength(3);
            });
        });

        // ============================================
        // Data Integrity
        // ============================================
        describe("data integrity", () => {
            it("should return employees with all fields intact", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    name: "테스트 직원",
                    workArea: ["서울"],
                    phone: "010-1234-5678",
                    grade: "특급",
                    openToNextWork: true,
                    registeredDate: new Date("2024-01-15"),
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(
                    branchId,
                    new Date("2024-01-01"),
                    new Date("2024-01-31"),
                );

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]).toMatchObject({
                    id: 1,
                    name: "테스트 직원",
                    workArea: ["서울"],
                    phone: "010-1234-5678",
                    grade: "특급",
                    openToNextWork: true,
                });
            });
        });
    });
});
