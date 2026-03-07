import { ListEmployeesByWorkAreaUsecase } from "application/usecases/employee/list-employees-by-work-area.usecase";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("ListEmployeesByWorkAreaUsecase", () => {
    let usecase: ListEmployeesByWorkAreaUsecase;
    let mockRepository: MockEmployeeRepository;
    const organizationId = "org-1";

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new ListEmployeesByWorkAreaUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        // ============================================
        // Basic Filtering
        // ============================================
        describe("basic filtering", () => {
            it("should return employees with matching work area", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, workArea: ["인천 연수구"] }),
                    EmployeeFactory.create({ id: 2, workArea: ["인천 남동구"] }),
                    EmployeeFactory.create({ id: 3, workArea: ["인천 연수구", "인천 남동구"] }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, "인천 연수구");

                // Assert
                expect(result).toHaveLength(2);
                expect(result.map(e => e.id)).toContain(1);
                expect(result.map(e => e.id)).toContain(3);
            });

            it("should return empty array when no matching work area", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, workArea: ["서울"] }),
                    EmployeeFactory.create({ id: 2, workArea: ["부산"] }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, "인천");

                // Assert
                expect(result).toEqual([]);
            });

            it("should return empty array when repository is empty", async () => {
                // Arrange - empty repository

                // Act
                const result = await usecase.execute(organizationId, "서울");

                // Assert
                expect(result).toEqual([]);
            });
        });

        // ============================================
        // Multiple Work Areas
        // ============================================
        describe("multiple work areas", () => {
            it("should find employees with multiple work areas containing the search term", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({
                        id: 1,
                        name: "다지역 담당",
                        workArea: ["인천 연수구", "인천 남동구", "인천 미추홀구"],
                    }),
                ];
                mockRepository.setData(employees);

                // Act
                const result1 = await usecase.execute(organizationId, "인천 연수구");
                const result2 = await usecase.execute(organizationId, "인천 남동구");
                const result3 = await usecase.execute(organizationId, "인천 미추홀구");

                // Assert
                expect(result1).toHaveLength(1);
                expect(result2).toHaveLength(1);
                expect(result3).toHaveLength(1);
            });

            it("should correctly filter when searching different areas", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, workArea: ["서울 강남구"] }),
                    EmployeeFactory.create({ id: 2, workArea: ["서울 서초구"] }),
                    EmployeeFactory.create({ id: 3, workArea: ["서울 강남구", "서울 서초구"] }),
                    EmployeeFactory.create({ id: 4, workArea: ["부산 해운대구"] }),
                ];
                mockRepository.setData(employees);

                // Act
                const gangnam = await usecase.execute(organizationId, "서울 강남구");
                const seocho = await usecase.execute(organizationId, "서울 서초구");
                const busan = await usecase.execute(organizationId, "부산 해운대구");

                // Assert
                expect(gangnam).toHaveLength(2); // id 1, 3
                expect(seocho).toHaveLength(2);  // id 2, 3
                expect(busan).toHaveLength(1);   // id 4
            });
        });

        // ============================================
        // Korean Character Handling
        // ============================================
        describe("korean character handling", () => {
            it("should correctly filter Korean work area names", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, workArea: ["인천광역시 연수구"] }),
                    EmployeeFactory.create({ id: 2, workArea: ["인천광역시 남동구"] }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, "인천광역시 연수구");

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.id).toBe(1);
            });

            it("should handle special Korean characters correctly", async () => {
                // Arrange
                const employees = [
                    EmployeeFactory.create({ id: 1, workArea: ["강원도 속초시"] }),
                    EmployeeFactory.create({ id: 2, workArea: ["제주특별자치도"] }),
                ];
                mockRepository.setData(employees);

                // Act
                const result = await usecase.execute(organizationId, "제주특별자치도");

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.id).toBe(2);
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
                    workArea: ["인천 연수구"],
                    phone: "010-1234-5678",
                    grade: "프리미엄",
                    openToNextWork: true,
                });
                mockRepository.setData([employee]);

                // Act
                const result = await usecase.execute(organizationId, "인천 연수구");

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]).toMatchObject({
                    id: 1,
                    name: "테스트 직원",
                    phone: "010-1234-5678",
                    grade: "프리미엄",
                    openToNextWork: true,
                });
            });
        });
    });
});
