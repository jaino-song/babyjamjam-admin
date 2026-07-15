import { ListEmployeesUsecase } from "application/usecases/employee/list-employees.usecase";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("ListEmployeesUsecase", () => {
    let usecase: ListEmployeesUsecase;
    let mockRepository: MockEmployeeRepository;
    const branchId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new ListEmployeesUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        // ============================================
        // Basic Functionality
        // ============================================
        describe("basic functionality", () => {
            it("should return empty array when no employees exist", async () => {
                // Arrange - empty repository

                // Act
                const result = await usecase.execute(branchId);

                // Assert
                expect(result).toEqual([]);
            });

            it("should return single employee when one exists", async () => {
                // Arrange
                const employee = EmployeeFactory.create({ id: 1, name: "유일한 직원" });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId);

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.name).toBe("유일한 직원");
            });

            it("should return all employees when multiple exist", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(5);
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(branchId);

                // Assert
                expect(result).toHaveLength(5);
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
                    name: "풀 데이터 직원",
                    workArea: ["인천 연수구", "인천 남동구"],
                    phone: "010-1234-5678",
                    grade: "특급",
                    openToNextWork: true,
                    registeredDate: new Date("2024-01-15"),
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(branchId);

                // Assert
                expect(result).toHaveLength(1);
                const firstEmployee = result[0];
                expect(firstEmployee).toBeDefined();
                expect(firstEmployee?.id).toBe(1);
                expect(firstEmployee?.name).toBe("풀 데이터 직원");
                expect(firstEmployee?.workArea).toEqual(["인천 연수구", "인천 남동구"]);
                expect(firstEmployee?.phone).toBe("010-1234-5678");
                expect(firstEmployee?.grade).toBe("특급");
                expect(firstEmployee?.openToNextWork).toBe(true);
            });

            it("should return employees with different statuses", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createAvailable({ id: 1, name: "가용 직원" }),
                    EmployeeFactory.createUnavailable({ id: 2, name: "비가용 직원" }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(branchId);

                // Assert
                expect(result).toHaveLength(2);
                const available = result.find(e => e.name === "가용 직원");
                const unavailable = result.find(e => e.name === "비가용 직원");
                expect(available?.openToNextWork).toBe(true);
                expect(unavailable?.openToNextWork).toBe(false);
            });

            it("should return employees with different work areas", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createForArea("서울", { id: 1 }),
                    EmployeeFactory.createForArea("부산", { id: 2 }),
                    EmployeeFactory.createForArea("대구", { id: 3 }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(branchId);

                // Assert
                expect(result).toHaveLength(3);
                expect(result.map(e => e.workArea[0])).toContain("서울");
                expect(result.map(e => e.workArea[0])).toContain("부산");
                expect(result.map(e => e.workArea[0])).toContain("대구");
            });
        });

        // ============================================
        // Large Dataset
        // ============================================
        describe("large dataset", () => {
            it("should handle large number of employees", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(100);
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(branchId);

                // Assert
                expect(result).toHaveLength(100);
            });
        });
    });
});
