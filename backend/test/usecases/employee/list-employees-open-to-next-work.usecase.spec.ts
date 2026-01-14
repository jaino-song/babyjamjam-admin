import { ListEmployeesOpenToNextWorkUsecase } from "application/usecases/employee/list-employees-open-to-next-work.usecase";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("ListEmployeesOpenToNextWorkUsecase", () => {
    let usecase: ListEmployeesOpenToNextWorkUsecase;
    let mockRepository: MockEmployeeRepository;

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new ListEmployeesOpenToNextWorkUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        // ============================================
        // Basic Functionality
        // ============================================
        describe("basic functionality", () => {
            it("should return all available employees", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createAvailable({ id: 1, name: "가용1" }),
                    EmployeeFactory.createUnavailable({ id: 2, name: "비가용1" }),
                    EmployeeFactory.createAvailable({ id: 3, name: "가용2" }),
                    EmployeeFactory.createUnavailable({ id: 4, name: "비가용2" }),
                    EmployeeFactory.createAvailable({ id: 5, name: "가용3" }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toHaveLength(3);
                expect(result.every(e => e.openToNextWork === true)).toBe(true);
                expect(result.map(e => e.name)).toEqual(
                    expect.arrayContaining(["가용1", "가용2", "가용3"]),
                );
            });

            it("should return all employees when everyone is available", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createAvailable({ id: 1 }),
                    EmployeeFactory.createAvailable({ id: 2 }),
                    EmployeeFactory.createAvailable({ id: 3 }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toHaveLength(3);
            });

            it("should return empty array when no one is available", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createUnavailable({ id: 1 }),
                    EmployeeFactory.createUnavailable({ id: 2 }),
                    EmployeeFactory.createUnavailable({ id: 3 }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toEqual([]);
            });

            it("should return empty array when repository is empty", async () => {
                // Arrange - empty repository

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toEqual([]);
            });
        });

        // ============================================
        // Single Employee Cases
        // ============================================
        describe("single employee cases", () => {
            it("should return single available employee", async () => {
                // Arrange
                const employee = EmployeeFactory.createAvailable({ id: 1, name: "유일한 가용 직원" });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.name).toBe("유일한 가용 직원");
            });

            it("should return empty for single unavailable employee", async () => {
                // Arrange
                const employee = EmployeeFactory.createUnavailable({ id: 1 });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toEqual([]);
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
                    workArea: ["인천 연수구", "인천 남동구"],
                    phone: "010-1234-5678",
                    grade: "특급",
                    openToNextWork: true,
                    registeredDate: new Date("2024-01-15"),
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]).toMatchObject({
                    id: 1,
                    name: "테스트 직원",
                    workArea: ["인천 연수구", "인천 남동구"],
                    phone: "010-1234-5678",
                    grade: "특급",
                    openToNextWork: true,
                });
            });

            it("should preserve different grades among available employees", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createAvailable({ id: 1, grade: "1급" }),
                    EmployeeFactory.createAvailable({ id: 2, grade: "2급" }),
                    EmployeeFactory.createAvailable({ id: 3, grade: "특급" }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toHaveLength(3);
                expect(result.map(e => e.grade)).toContain("1급");
                expect(result.map(e => e.grade)).toContain("2급");
                expect(result.map(e => e.grade)).toContain("특급");
            });

            it("should preserve different work areas among available employees", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createAvailable({ id: 1, workArea: ["서울"] }),
                    EmployeeFactory.createAvailable({ id: 2, workArea: ["부산"] }),
                    EmployeeFactory.createAvailable({ id: 3, workArea: ["대구", "광주"] }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toHaveLength(3);
            });
        });

        // ============================================
        // Large Dataset
        // ============================================
        describe("large dataset", () => {
            it("should handle large number of available employees", async () => {
                // Arrange - 50 available employees
                const employees = Array.from({ length: 50 }, (_, i) =>
                    EmployeeFactory.createAvailable({ id: i + 1 }),
                );
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toHaveLength(50);
            });

            it("should filter correctly in large mixed dataset", async () => {
                // Arrange - 100 employees: 60 available, 40 unavailable
                const available = Array.from({ length: 60 }, (_, i) =>
                    EmployeeFactory.createAvailable({ id: i + 1 }),
                );
                const unavailable = Array.from({ length: 40 }, (_, i) =>
                    EmployeeFactory.createUnavailable({ id: i + 61 }),
                );
                mockRepository.setData([...available, ...unavailable]);

                // Act
                const result = await usecase.execute();

                // Assert
                expect(result).toHaveLength(60);
                expect(result.every(e => e.openToNextWork === true)).toBe(true);
            });
        });
    });
});
