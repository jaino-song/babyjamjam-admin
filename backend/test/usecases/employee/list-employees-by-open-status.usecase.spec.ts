import { ListEmployeesByOpenStatusUsecase } from "application/usecases/employee/list-employees-by-open-status.usecase";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("ListEmployeesByOpenStatusUsecase", () => {
    let usecase: ListEmployeesByOpenStatusUsecase;
    let mockRepository: MockEmployeeRepository;
    const organizationId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new ListEmployeesByOpenStatusUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        // ============================================
        // Filter by Available (openToNextWork = true)
        // ============================================
        describe("filter available employees", () => {
            it("should return only available employees when true", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createAvailable({ id: 1, name: "가용1" }),
                    EmployeeFactory.createUnavailable({ id: 2, name: "비가용1" }),
                    EmployeeFactory.createAvailable({ id: 3, name: "가용2" }),
                    EmployeeFactory.createUnavailable({ id: 4, name: "비가용2" }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, true);

                // Assert
                expect(result).toHaveLength(2);
                expect(result.every(e => e.openToNextWork === true)).toBe(true);
                expect(result.map(e => e.name)).toContain("가용1");
                expect(result.map(e => e.name)).toContain("가용2");
            });

            it("should return all employees when all are available", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createAvailable({ id: 1 }),
                    EmployeeFactory.createAvailable({ id: 2 }),
                    EmployeeFactory.createAvailable({ id: 3 }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, true);

                // Assert
                expect(result).toHaveLength(3);
            });

            it("should return empty when no available employees", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createUnavailable({ id: 1 }),
                    EmployeeFactory.createUnavailable({ id: 2 }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, true);

                // Assert
                expect(result).toEqual([]);
            });
        });

        // ============================================
        // Filter by Unavailable (openToNextWork = false)
        // ============================================
        describe("filter unavailable employees", () => {
            it("should return only unavailable employees when false", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createAvailable({ id: 1, name: "가용1" }),
                    EmployeeFactory.createUnavailable({ id: 2, name: "비가용1" }),
                    EmployeeFactory.createAvailable({ id: 3, name: "가용2" }),
                    EmployeeFactory.createUnavailable({ id: 4, name: "비가용2" }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, false);

                // Assert
                expect(result).toHaveLength(2);
                expect(result.every(e => e.openToNextWork === false)).toBe(true);
                expect(result.map(e => e.name)).toContain("비가용1");
                expect(result.map(e => e.name)).toContain("비가용2");
            });

            it("should return all employees when all are unavailable", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createUnavailable({ id: 1 }),
                    EmployeeFactory.createUnavailable({ id: 2 }),
                    EmployeeFactory.createUnavailable({ id: 3 }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, false);

                // Assert
                expect(result).toHaveLength(3);
            });

            it("should return empty when no unavailable employees", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.createAvailable({ id: 1 }),
                    EmployeeFactory.createAvailable({ id: 2 }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, false);

                // Assert
                expect(result).toEqual([]);
            });
        });

        // ============================================
        // Empty Repository
        // ============================================
        describe("empty repository", () => {
            it("should return empty array when filtering available in empty repo", async () => {
                // Arrange - empty repository

                // Act
                const result = await usecase.execute(organizationId, true);

                // Assert
                expect(result).toEqual([]);
            });

            it("should return empty array when filtering unavailable in empty repo", async () => {
                // Arrange - empty repository

                // Act
                const result = await usecase.execute(organizationId, false);

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
                    workArea: ["서울"],
                    phone: "010-1234-5678",
                    grade: "특급",
                    openToNextWork: true,
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(organizationId, true);

                // Assert
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
