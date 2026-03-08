import { ListEmployeesByGradeUsecase } from "application/usecases/employee/list-employees-by-grade.usecase";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("ListEmployeesByGradeUsecase", () => {
    let usecase: ListEmployeesByGradeUsecase;
    let mockRepository: MockEmployeeRepository;
    const organizationId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new ListEmployeesByGradeUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        // ============================================
        // Basic Filtering
        // ============================================
        describe("basic filtering", () => {
            it("should return employees with matching grade", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, grade: "프리미엄" }),
                    EmployeeFactory.create({ id: 2, grade: "베스트" }),
                    EmployeeFactory.create({ id: 3, grade: "프리미엄" }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, "프리미엄");

                // Assert
                expect(result).toHaveLength(2);
                expect(result.map(e => e.id)).toContain(1);
                expect(result.map(e => e.id)).toContain(3);
            });

            it("should return empty array when no matching grade", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, grade: "프리미엄" }),
                    EmployeeFactory.create({ id: 2, grade: "베스트" }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, "특급");

                // Assert
                expect(result).toEqual([]);
            });

            it("should return empty array when repository is empty", async () => {
                // Arrange - empty repository

                // Act
                const result = await usecase.execute(organizationId, "프리미엄");

                // Assert
                expect(result).toEqual([]);
            });
        });

        // ============================================
        // Different Grade Types
        // ============================================
        describe("different grade types", () => {
            it.each(["프리미엄", "베스트", "스탠다드", "특급"])("should correctly filter grade %s", async (grade) => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, grade: "프리미엄" }),
                    EmployeeFactory.create({ id: 2, grade: "베스트" }),
                    EmployeeFactory.create({ id: 3, grade: "스탠다드" }),
                    EmployeeFactory.create({ id: 4, grade: "특급" }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, grade);

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.grade).toBe(grade);
            });

            it("should handle all employees having same grade", async () => {
                // Arrange
                const employees = EmployeeFactory.createMany(5, { grade: "특급" });
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, "특급");

                // Assert
                expect(result).toHaveLength(5);
                expect(result.every(e => e.grade === "특급")).toBe(true);
            });
        });

        // ============================================
        // Case Sensitivity
        // ============================================
        describe("exact matching", () => {
            it("should require exact grade match", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, grade: "A" }),
                    EmployeeFactory.create({ id: 2, grade: "a" }),
                ];
                mockRepository.setData(employees);

                // Act
                const resultA = await usecase.execute(organizationId, "A");
                const resultSmallA = await usecase.execute(organizationId, "a");

                // Assert
                expect(resultA).toHaveLength(1);
                expect(resultA[0]?.id).toBe(1);
                expect(resultSmallA).toHaveLength(1);
                expect(resultSmallA[0]?.id).toBe(2);
            });

            it("should not perform partial matching", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, grade: "프리미엄" }),
                    EmployeeFactory.create({ id: 2, grade: "특프리미엄" }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, "1");

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
                const result = await usecase.execute(organizationId, "특급");

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
