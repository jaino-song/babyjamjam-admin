import { CreateEmployeeUsecase } from "application/usecases/employee/create-employee.usecase";
import { MockEmployeeRepository } from "../../utils/mocks";

describe("CreateEmployeeUsecase", () => {
    let usecase: CreateEmployeeUsecase;
    let mockRepository: MockEmployeeRepository;

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new CreateEmployeeUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should create a new employee with all fields", async () => {
            // Arrange
            const name = "테스트 직원";
            const workArea = ["인천 연수구", "인천 남동구"];
            const phone = "010-1234-5678";
            const grade = "1급";
            const openToNextWork = true;
            const registeredDate = new Date("2024-01-15");

            // Act
            const result = await usecase.execute(
                name,
                workArea,
                phone,
                grade,
                openToNextWork,
                registeredDate,
            );

            // Assert
            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(result.name).toBe("테스트 직원");
            expect(result.workArea).toEqual(["인천 연수구", "인천 남동구"]);
            expect(result.phone).toBe("010-1234-5678");
            expect(result.grade).toBe("1급");
            expect(result.openToNextWork).toBe(true);
        });

        it("should create employee without registeredDate (defaults to now)", async () => {
            // Arrange
            const name = "신규 직원";
            const workArea = ["서울 강남구"];
            const phone = "010-9999-8888";
            const grade = "2급";
            const openToNextWork = false;

            // Act
            const result = await usecase.execute(
                name,
                workArea,
                phone,
                grade,
                openToNextWork,
            );

            // Assert
            expect(result).toBeDefined();
            expect(result.name).toBe("신규 직원");
            expect(result.registeredDate).toBeDefined();
        });

        it("should auto-increment employee id for multiple creates", async () => {
            // Arrange & Act
            const emp1 = await usecase.execute("직원1", ["지역A"], "010-0000-0001", "1급", true);
            const emp2 = await usecase.execute("직원2", ["지역B"], "010-0000-0002", "2급", false);
            const emp3 = await usecase.execute("직원3", ["지역C"], "010-0000-0003", "3급", true);

            // Assert
            expect(emp1.id).toBe(1);
            expect(emp2.id).toBe(2);
            expect(emp3.id).toBe(3);
        });

        it("should handle multiple work areas", async () => {
            // Arrange
            const workAreas = ["인천 연수구", "인천 남동구", "인천 미추홀구", "인천 서구"];

            // Act
            const result = await usecase.execute(
                "다지역 담당",
                workAreas,
                "010-1111-2222",
                "1급",
                true,
            );

            // Assert
            expect(result.workArea).toHaveLength(4);
            expect(result.workArea).toContain("인천 연수구");
            expect(result.workArea).toContain("인천 서구");
        });
    });
});
