import { FindEmployeeByIdUsecase } from "application/usecases/employee/find-employee-by-id.usecase";
import { MockEmployeeRepository, EmployeeFactory } from "../../utils";

describe("FindEmployeeByIdUsecase", () => {
    let usecase: FindEmployeeByIdUsecase;
    let mockRepository: MockEmployeeRepository;

    beforeEach(() => {
        mockRepository = new MockEmployeeRepository();
        usecase = new FindEmployeeByIdUsecase(mockRepository);
    });

    afterEach(() => {
        mockRepository.reset();
    });

    describe("execute", () => {
        it("should return employee when found", async () => {
            // Arrange
            const existingEmployee = EmployeeFactory.create({
                id: 1,
                name: "테스트 직원",
            });
            mockRepository.setData([existingEmployee]);

            // Act
            const result = await usecase.execute(1);

            // Assert
            expect(result).not.toBeNull();
            expect(result?.id).toBe(1);
            expect(result?.name).toBe("테스트 직원");
        });

        it("should return null when employee not found", async () => {
            // Arrange - empty repository

            // Act
            const result = await usecase.execute(999);

            // Assert
            expect(result).toBeNull();
        });

        it("should find specific employee among multiple", async () => {
            // Arrange
            const employees = EmployeeFactory.createMany(5);
            mockRepository.setData(employees);

            // Act
            const result = await usecase.execute(3);

            // Assert
            expect(result).not.toBeNull();
            expect(result?.id).toBe(3);
            expect(result?.name).toBe("Test Employee 3");
        });

        it("should return employee with all fields intact", async () => {
            // Arrange
            const employee = EmployeeFactory.create({
                id: 10,
                name: "풀 데이터 직원",
                workArea: ["인천 연수구", "인천 남동구"],
                phone: "010-5555-6666",
                grade: "특급",
                openToNextWork: true,
            });
            mockRepository.setData([employee]);

            // Act
            const result = await usecase.execute(10);

            // Assert
            expect(result?.workArea).toEqual(["인천 연수구", "인천 남동구"]);
            expect(result?.phone).toBe("010-5555-6666");
            expect(result?.grade).toBe("특급");
            expect(result?.openToNextWork).toBe(true);
        });
    });
});
