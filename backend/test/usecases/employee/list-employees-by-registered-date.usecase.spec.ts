import { ListEmployeesByRegisteredDateUsecase } from "application/usecases/employee/list-employees-by-registered-date.usecase";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("ListEmployeesByRegisteredDateUsecase", () => {
    let usecase: ListEmployeesByRegisteredDateUsecase;
    let mockRepository: MockEmployeeRepository;

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new ListEmployeesByRegisteredDateUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        // ============================================
        // Basic Filtering
        // ============================================
        describe("basic filtering", () => {
            it("should return employees registered on specific date", async () => {
                // Arrange
                const targetDate = new Date("2024-01-15");
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-15") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-16") }),
                    EmployeeFactory.create({ id: 3, registeredDate: new Date("2024-01-15") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(targetDate);

                // Assert
                expect(result).toHaveLength(2);
                expect(result.map(e => e.id)).toContain(1);
                expect(result.map(e => e.id)).toContain(3);
            });

            it("should return empty array when no employees registered on date", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-15") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-16") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(new Date("2024-01-20"));

                // Assert
                expect(result).toEqual([]);
            });

            it("should return empty array when repository is empty", async () => {
                // Arrange - empty repository

                // Act
                const result = await usecase.execute(new Date("2024-01-15"));

                // Assert
                expect(result).toEqual([]);
            });
        });

        // ============================================
        // Date Matching Behavior
        // ============================================
        describe("date matching", () => {
            it("should match dates regardless of time component", async () => {
                // Arrange - employees registered at different times on same day
                const employees = [
                    EmployeeFactory.create({
                        id: 1,
                        registeredDate: new Date("2024-01-15T00:00:00"),
                    }),
                    EmployeeFactory.create({
                        id: 2,
                        registeredDate: new Date("2024-01-15T12:30:00"),
                    }),
                    EmployeeFactory.create({
                        id: 3,
                        registeredDate: new Date("2024-01-15T23:59:59"),
                    }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(new Date("2024-01-15T10:00:00"));

                // Assert - all three should match
                expect(result).toHaveLength(3);
            });

            it("should not match adjacent dates", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2024-01-14T23:59:59") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-15T00:00:00") }),
                    EmployeeFactory.create({ id: 3, registeredDate: new Date("2024-01-16T00:00:00") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(new Date("2024-01-15"));

                // Assert - only the one from Jan 15 should match
                expect(result).toHaveLength(1);
                expect(result[0]?.id).toBe(2);
            });
        });

        // ============================================
        // Various Date Formats
        // ============================================
        describe("date format handling", () => {
            it("should handle dates at beginning of month", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    registeredDate: new Date("2024-02-01"),
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(new Date("2024-02-01"));

                // Assert
                expect(result).toHaveLength(1);
            });

            it("should handle dates at end of month", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    registeredDate: new Date("2024-01-31"),
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(new Date("2024-01-31"));

                // Assert
                expect(result).toHaveLength(1);
            });

            it("should handle leap year dates", async () => {
                // Arrange
                const employee = EmployeeFactory.create({
                    id: 1,
                    registeredDate: new Date("2024-02-29"),
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(new Date("2024-02-29"));

                // Assert
                expect(result).toHaveLength(1);
            });

            it("should handle year boundaries", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, registeredDate: new Date("2023-12-31") }),
                    EmployeeFactory.create({ id: 2, registeredDate: new Date("2024-01-01") }),
                ];
                mockRepository.setData(employees);

                // Act
                const result2023 = await usecase.execute(new Date("2023-12-31"));
                const result2024 = await usecase.execute(new Date("2024-01-01"));

                // Assert
                expect(result2023).toHaveLength(1);
                expect(result2023[0]?.id).toBe(1);
                expect(result2024).toHaveLength(1);
                expect(result2024[0]?.id).toBe(2);
            });
        });

        // ============================================
        // Data Integrity
        // ============================================
        describe("data integrity", () => {
            it("should return employees with all fields intact", async () => {
                // Arrange
                const registeredDate = new Date("2024-01-15");
                const employee = EmployeeFactory.create({
                    id: 1,
                    name: "테스트 직원",
                    workArea: ["서울"],
                    phone: "010-1234-5678",
                    grade: "특급",
                    openToNextWork: true,
                    registeredDate,
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(registeredDate);

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
