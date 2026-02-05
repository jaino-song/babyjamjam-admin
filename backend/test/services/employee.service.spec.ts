import { Test, TestingModule } from "@nestjs/testing";
import { EmployeeService } from "application/services/employee.service";
import {
    ChangeEmployeeOpenStatusUsecase,
    CreateEmployeeUsecase,
    DeleteEmployeeUsecase,
    FindEmployeeByIdUsecase,
    ListEmployeesByGradeUsecase,
    ListEmployeesByOpenStatusUsecase,
    ListEmployeesByRegisteredDateRangeUsecase,
    ListEmployeesByRegisteredDateUsecase,
    ListEmployeesByWorkAreaUsecase,
    ListEmployeesOpenToNextWorkUsecase,
    ListEmployeesUsecase,
    UpdateEmployeeUsecase,
} from "application/usecases/employee";
import { EmployeeFactory } from "../utils";

describe("EmployeeService", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================
    let service: EmployeeService;

    // Mock use cases
    let createUsecase: jest.Mocked<CreateEmployeeUsecase>;
    let findByIdUsecase: jest.Mocked<FindEmployeeByIdUsecase>;
    let updateUsecase: jest.Mocked<UpdateEmployeeUsecase>;
    let deleteUsecase: jest.Mocked<DeleteEmployeeUsecase>;
    let listUsecase: jest.Mocked<ListEmployeesUsecase>;
    let listByWorkAreaUsecase: jest.Mocked<ListEmployeesByWorkAreaUsecase>;
    let listByGradeUsecase: jest.Mocked<ListEmployeesByGradeUsecase>;
    let listByOpenStatusUsecase: jest.Mocked<ListEmployeesByOpenStatusUsecase>;
    let listByRegisteredDateUsecase: jest.Mocked<ListEmployeesByRegisteredDateUsecase>;
    let listByRegisteredDateRangeUsecase: jest.Mocked<ListEmployeesByRegisteredDateRangeUsecase>;
    let changeOpenStatusUsecase: jest.Mocked<ChangeEmployeeOpenStatusUsecase>;
    let listOpenToNextWorkUsecase: jest.Mocked<ListEmployeesOpenToNextWorkUsecase>;

    const organizationId = "org-1";

    beforeEach(async () => {
        // Create mock implementations
        const mockCreateUsecase = { execute: jest.fn() };
        const mockFindByIdUsecase = { execute: jest.fn() };
        const mockUpdateUsecase = { execute: jest.fn() };
        const mockDeleteUsecase = { execute: jest.fn() };
        const mockListUsecase = { execute: jest.fn() };
        const mockListByWorkAreaUsecase = { execute: jest.fn() };
        const mockListByGradeUsecase = { execute: jest.fn() };
        const mockListByOpenStatusUsecase = { execute: jest.fn() };
        const mockListByRegisteredDateUsecase = { execute: jest.fn() };
        const mockListByRegisteredDateRangeUsecase = { execute: jest.fn() };
        const mockChangeOpenStatusUsecase = { execute: jest.fn() };
        const mockListOpenToNextWorkUsecase = { execute: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmployeeService,
                { provide: CreateEmployeeUsecase, useValue: mockCreateUsecase },
                { provide: FindEmployeeByIdUsecase, useValue: mockFindByIdUsecase },
                { provide: UpdateEmployeeUsecase, useValue: mockUpdateUsecase },
                { provide: DeleteEmployeeUsecase, useValue: mockDeleteUsecase },
                { provide: ListEmployeesUsecase, useValue: mockListUsecase },
                { provide: ListEmployeesByWorkAreaUsecase, useValue: mockListByWorkAreaUsecase },
                { provide: ListEmployeesByGradeUsecase, useValue: mockListByGradeUsecase },
                { provide: ListEmployeesByOpenStatusUsecase, useValue: mockListByOpenStatusUsecase },
                { provide: ListEmployeesByRegisteredDateUsecase, useValue: mockListByRegisteredDateUsecase },
                { provide: ListEmployeesByRegisteredDateRangeUsecase, useValue: mockListByRegisteredDateRangeUsecase },
                { provide: ChangeEmployeeOpenStatusUsecase, useValue: mockChangeOpenStatusUsecase },
                { provide: ListEmployeesOpenToNextWorkUsecase, useValue: mockListOpenToNextWorkUsecase },
            ],
        }).compile();

        service = module.get<EmployeeService>(EmployeeService);
        createUsecase = module.get(CreateEmployeeUsecase);
        findByIdUsecase = module.get(FindEmployeeByIdUsecase);
        updateUsecase = module.get(UpdateEmployeeUsecase);
        deleteUsecase = module.get(DeleteEmployeeUsecase);
        listUsecase = module.get(ListEmployeesUsecase);
        listByWorkAreaUsecase = module.get(ListEmployeesByWorkAreaUsecase);
        listByGradeUsecase = module.get(ListEmployeesByGradeUsecase);
        listByOpenStatusUsecase = module.get(ListEmployeesByOpenStatusUsecase);
        listByRegisteredDateUsecase = module.get(ListEmployeesByRegisteredDateUsecase);
        listByRegisteredDateRangeUsecase = module.get(ListEmployeesByRegisteredDateRangeUsecase);
        changeOpenStatusUsecase = module.get(ChangeEmployeeOpenStatusUsecase);
        listOpenToNextWorkUsecase = module.get(ListEmployeesOpenToNextWorkUsecase);
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        it("should delegate to CreateEmployeeUsecase with all parameters", async () => {
            // Arrange
            const params = {
                name: "테스트 직원",
                workArea: ["인천 연수구"],
                phone: "010-1234-5678",
                grade: "1급",
                openToNextWork: true,
            };
            const mockEmployee = EmployeeFactory.create({ id: 1, ...params });
            createUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.create(organizationId, params);

            // Assert
            expect(createUsecase.execute).toHaveBeenCalledWith(
                organizationId,
                params.name,
                params.workArea,
                params.phone,
                params.grade,
                params.openToNextWork,
                undefined,
            );
            expect(result).toBe(mockEmployee);
        });

        it("should convert string registeredDate to Date", async () => {
            // Arrange
            const params = {
                name: "테스트 직원",
                workArea: ["서울"],
                phone: "010-0000-0000",
                grade: "2급",
                openToNextWork: false,
                registeredDate: "2024-06-15",
            };
            const mockEmployee = EmployeeFactory.create({ id: 1 });
            createUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            await service.create(organizationId, params);

            // Assert
            expect(createUsecase.execute).toHaveBeenCalledWith(
                organizationId,
                params.name,
                params.workArea,
                params.phone,
                params.grade,
                params.openToNextWork,
                new Date("2024-06-15"),
            );
        });

        it("should handle missing registeredDate", async () => {
            // Arrange
            const params = {
                name: "테스트 직원",
                workArea: ["서울"],
                phone: "010-0000-0000",
                grade: "2급",
                openToNextWork: false,
            };
            const mockEmployee = EmployeeFactory.create({ id: 1 });
            createUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            await service.create(organizationId, params);

            // Assert
            expect(createUsecase.execute).toHaveBeenCalledWith(
                organizationId,
                params.name,
                params.workArea,
                params.phone,
                params.grade,
                params.openToNextWork,
                undefined,
            );
        });
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        it("should delegate to FindEmployeeByIdUsecase", async () => {
            // Arrange
            const mockEmployee = EmployeeFactory.create({ id: 5 });
            findByIdUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.findById(organizationId, 5);

            // Assert
            expect(findByIdUsecase.execute).toHaveBeenCalledWith(organizationId, 5);
            expect(result).toBe(mockEmployee);
        });

        it("should return null when employee not found", async () => {
            // Arrange
            findByIdUsecase.execute.mockResolvedValue(null);

            // Act
            const result = await service.findById(organizationId, 999);

            // Assert
            expect(result).toBeNull();
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        it("should delegate to UpdateEmployeeUsecase with id and params", async () => {
            // Arrange
            const updateParams = {
                name: "수정된 이름",
                grade: "특급",
            };
            const mockEmployee = EmployeeFactory.create({ id: 3, ...updateParams });
            updateUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.update(organizationId, 3, updateParams);

            // Assert
            expect(updateUsecase.execute).toHaveBeenCalledWith(organizationId, 3, updateParams);
            expect(result).toBe(mockEmployee);
        });

        it("should handle partial update params", async () => {
            // Arrange
            const partialParams = { phone: "010-9999-0000" };
            const mockEmployee = EmployeeFactory.create({ id: 7 });
            updateUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            await service.update(organizationId, 7, partialParams);

            // Assert
            expect(updateUsecase.execute).toHaveBeenCalledWith(organizationId, 7, partialParams);
        });

        it("should handle empty update params", async () => {
            // Arrange
            const mockEmployee = EmployeeFactory.create({ id: 1 });
            updateUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            await service.update(organizationId, 1, {});

            // Assert
            expect(updateUsecase.execute).toHaveBeenCalledWith(organizationId, 1, {});
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        it("should delegate to DeleteEmployeeUsecase", async () => {
            // Arrange
            deleteUsecase.execute.mockResolvedValue(undefined);

            // Act
            await service.delete(organizationId, 10);

            // Assert
            expect(deleteUsecase.execute).toHaveBeenCalledWith(organizationId, 10);
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        it("should delegate to ListEmployeesUsecase", async () => {
            // Arrange
            const mockEmployees = EmployeeFactory.createMany(3);
            listUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findAll(organizationId);

            // Assert
            expect(listUsecase.execute).toHaveBeenCalledWith(organizationId);
            expect(result).toBe(mockEmployees);
        });

        it("should return empty array when no employees", async () => {
            // Arrange
            listUsecase.execute.mockResolvedValue([]);

            // Act
            const result = await service.findAll(organizationId);

            // Assert
            expect(result).toEqual([]);
        });
    });

    // ============================================
    // findByWorkArea
    // ============================================
    describe("findByWorkArea", () => {
        it("should delegate to ListEmployeesByWorkAreaUsecase", async () => {
            // Arrange
            const mockEmployees = EmployeeFactory.createMany(2);
            listByWorkAreaUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByWorkArea(organizationId, "인천 연수구");

            // Assert
            expect(listByWorkAreaUsecase.execute).toHaveBeenCalledWith(organizationId, "인천 연수구");
            expect(result).toBe(mockEmployees);
        });
    });

    // ============================================
    // findByGrade
    // ============================================
    describe("findByGrade", () => {
        it("should delegate to ListEmployeesByGradeUsecase", async () => {
            // Arrange
            const mockEmployees = EmployeeFactory.createMany(2);
            listByGradeUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByGrade(organizationId, "특급");

            // Assert
            expect(listByGradeUsecase.execute).toHaveBeenCalledWith(organizationId, "특급");
            expect(result).toBe(mockEmployees);
        });
    });

    // ============================================
    // findByOpenStatus
    // ============================================
    describe("findByOpenStatus", () => {
        it("should delegate to ListEmployeesByOpenStatusUsecase with true", async () => {
            // Arrange
            const mockEmployees = [EmployeeFactory.createAvailable({ id: 1 })];
            listByOpenStatusUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByOpenStatus(organizationId, true);

            // Assert
            expect(listByOpenStatusUsecase.execute).toHaveBeenCalledWith(organizationId, true);
            expect(result).toBe(mockEmployees);
        });

        it("should delegate to ListEmployeesByOpenStatusUsecase with false", async () => {
            // Arrange
            const mockEmployees = [EmployeeFactory.createUnavailable({ id: 1 })];
            listByOpenStatusUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByOpenStatus(organizationId, false);

            // Assert
            expect(listByOpenStatusUsecase.execute).toHaveBeenCalledWith(organizationId, false);
            expect(result).toBe(mockEmployees);
        });
    });

    // ============================================
    // findByRegisteredDate
    // ============================================
    describe("findByRegisteredDate", () => {
        it("should delegate to ListEmployeesByRegisteredDateUsecase", async () => {
            // Arrange
            const date = new Date("2024-01-15");
            const mockEmployees = EmployeeFactory.createMany(2);
            listByRegisteredDateUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByRegisteredDate(organizationId, date);

            // Assert
            expect(listByRegisteredDateUsecase.execute).toHaveBeenCalledWith(organizationId, date);
            expect(result).toBe(mockEmployees);
        });
    });

    // ============================================
    // findByRegisteredDateRange
    // ============================================
    describe("findByRegisteredDateRange", () => {
        it("should delegate to ListEmployeesByRegisteredDateRangeUsecase", async () => {
            // Arrange
            const start = new Date("2024-01-01");
            const end = new Date("2024-01-31");
            const mockEmployees = EmployeeFactory.createMany(3);
            listByRegisteredDateRangeUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByRegisteredDateRange(organizationId, start, end);

            // Assert
            expect(listByRegisteredDateRangeUsecase.execute).toHaveBeenCalledWith(organizationId, start, end);
            expect(result).toBe(mockEmployees);
        });
    });

    // ============================================
    // changeOpenStatus
    // ============================================
    describe("changeOpenStatus", () => {
        it("should delegate to ChangeEmployeeOpenStatusUsecase", async () => {
            // Arrange
            const mockEmployee = EmployeeFactory.create({ id: 5, openToNextWork: false });
            changeOpenStatusUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.changeOpenStatus(organizationId, 5, false);

            // Assert
            expect(changeOpenStatusUsecase.execute).toHaveBeenCalledWith(organizationId, 5, false);
            expect(result).toBe(mockEmployee);
        });

        it("should change status to true", async () => {
            // Arrange
            const mockEmployee = EmployeeFactory.createAvailable({ id: 3 });
            changeOpenStatusUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.changeOpenStatus(organizationId, 3, true);

            // Assert
            expect(changeOpenStatusUsecase.execute).toHaveBeenCalledWith(organizationId, 3, true);
            expect(result.openToNextWork).toBe(true);
        });
    });

    // ============================================
    // findAllOpenToNextWork
    // ============================================
    describe("findAllOpenToNextWork", () => {
        it("should delegate to ListEmployeesOpenToNextWorkUsecase", async () => {
            // Arrange
            const mockEmployees = [
                EmployeeFactory.createAvailable({ id: 1 }),
                EmployeeFactory.createAvailable({ id: 2 }),
            ];
            listOpenToNextWorkUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findAllOpenToNextWork(organizationId);

            // Assert
            expect(listOpenToNextWorkUsecase.execute).toHaveBeenCalledWith(organizationId);
            expect(result).toBe(mockEmployees);
        });

        it("should return empty array when no available employees", async () => {
            // Arrange
            listOpenToNextWorkUsecase.execute.mockResolvedValue([]);

            // Act
            const result = await service.findAllOpenToNextWork(organizationId);

            // Assert
            expect(result).toEqual([]);
        });
    });
});
