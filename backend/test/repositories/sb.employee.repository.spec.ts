import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeEntity } from "domain/entities/employee.entity";

describe("SbEmployeeRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockPrismaEmployee = () => ({
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    });

    const createEmployeeRow = (overrides = {}) => ({
        id: 1,
        name: "Alice",
        work_area: ["Incheon"],
        phone: "010-1234-5678",
        grade: "A",
        open_to_next_work: true,
        company_registered_date: new Date("2024-01-01T00:00:00.000Z"),
        ...overrides,
    });

    interface EmployeeParams {
        id?: number;
        name?: string;
        workArea?: string[];
        phone?: string;
        grade?: string;
        openToNextWork?: boolean;
        registeredDate?: Date;
    }

    const createEmployeeEntity = (overrides: EmployeeParams = {}) => {
        return new EmployeeEntity(
            overrides.id ?? 0,
            overrides.name ?? "Test Employee",
            overrides.workArea ?? ["Seoul"],
            overrides.phone ?? "010-0000-0000",
            overrides.grade ?? "B",
            overrides.openToNextWork ?? false,
            overrides.registeredDate ?? new Date("2024-02-01T00:00:00.000Z"),
        );
    };

    let employeeModel: ReturnType<typeof createMockPrismaEmployee>;
    let prisma: PrismaService;
    let repository: SbEmployeeRepository;

    beforeEach(() => {
        employeeModel = createMockPrismaEmployee();
        prisma = { employee: employeeModel } as unknown as PrismaService;
        repository = new SbEmployeeRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        describe("given an employee exists with the specified id", () => {
            it("should return the mapped EmployeeEntity", async () => {
                // Arrange
                const row = createEmployeeRow();
                employeeModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findById(1);

                // Assert
                expect(employeeModel.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
                expect(result).toBeInstanceOf(EmployeeEntity);
                expect(result).toMatchObject({
                    id: 1,
                    name: "Alice",
                    workArea: ["Incheon"],
                    phone: "010-1234-5678",
                    grade: "A",
                    openToNextWork: true,
                });
            });
        });

        describe("given no employee exists with the specified id", () => {
            it("should return null", async () => {
                // Arrange
                employeeModel.findUnique.mockResolvedValue(null);

                // Act
                const result = await repository.findById(999);

                // Assert
                expect(employeeModel.findUnique).toHaveBeenCalledWith({ where: { id: 999 } });
                expect(result).toBeNull();
            });
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        describe("given employees exist in the database", () => {
            it("should return all employees as EmployeeEntity array", async () => {
                // Arrange
                const rows = [
                    createEmployeeRow({ id: 1, name: "Alice" }),
                    createEmployeeRow({ id: 2, name: "Bob" }),
                ];
                employeeModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findAll();

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith();
                expect(result).toHaveLength(2);
                expect(result[0]).toMatchObject({ id: 1, name: "Alice" });
                expect(result[1]).toMatchObject({ id: 2, name: "Bob" });
            });
        });

        describe("given no employees exist", () => {
            it("should return an empty array", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([]);

                // Act
                const result = await repository.findAll();

                // Assert
                expect(result).toEqual([]);
            });
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        describe("given a valid EmployeeEntity", () => {
            it("should persist employee and return created entity", async () => {
                // Arrange
                const entity = createEmployeeEntity();
                const createdRow = createEmployeeRow({
                    id: 5,
                    name: "Test Employee",
                    work_area: ["Seoul"],
                    phone: "010-0000-0000",
                    grade: "B",
                    open_to_next_work: false,
                });
                employeeModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(entity);

                // Assert
                expect(employeeModel.create).toHaveBeenCalledWith({
                    data: {
                        id: 0,
                        name: "Test Employee",
                        work_area: ["Seoul"],
                        phone: "010-0000-0000",
                        grade: "B",
                        open_to_next_work: false,
                        company_registered_date: new Date("2024-02-01T00:00:00.000Z"),
                    },
                });
                expect(result).toMatchObject({ id: 5, name: "Test Employee" });
            });
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given an existing EmployeeEntity with changes", () => {
            it("should update employee with correct data", async () => {
                // Arrange
                const entity = new EmployeeEntity(
                    7,
                    "Charlie",
                    ["Busan"],
                    "010-2222-0000",
                    "C",
                    true,
                    new Date("2023-12-31T00:00:00.000Z"),
                );
                const updatedRow = createEmployeeRow({
                    id: 7,
                    name: "Charlie",
                    work_area: ["Busan"],
                    phone: "010-2222-0000",
                    grade: "C",
                });
                employeeModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(employeeModel.update).toHaveBeenCalledWith({
                    where: { id: 7 },
                    data: {
                        name: "Charlie",
                        work_area: ["Busan"],
                        phone: "010-2222-0000",
                        grade: "C",
                        open_to_next_work: true,
                    },
                });
                expect(result).toMatchObject({ id: 7, workArea: ["Busan"] });
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        describe("given a valid employee id", () => {
            it("should delete the employee", async () => {
                // Arrange
                employeeModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete(3);

                // Assert
                expect(employeeModel.delete).toHaveBeenCalledWith({ where: { id: 3 } });
            });
        });
    });

    // ============================================
    // Filter Methods
    // ============================================
    describe("findByWorkArea", () => {
        describe("given a work area filter", () => {
            it("should query with correct where clause", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);

                // Act
                await repository.findByWorkArea("Incheon");

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { work_area: { has: "Incheon" } },
                });
            });
        });
    });

    describe("findByGrade", () => {
        describe("given a grade filter", () => {
            it("should query with correct where clause", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);

                // Act
                await repository.findByGrade("A");

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { grade: "A" },
                });
            });
        });

        describe("given different grades", () => {
            it.each(["A", "B", "C", "D"])("should filter by grade %s", async (grade) => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findByGrade(grade);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { grade },
                });
            });
        });
    });

    describe("findByOpenToNextWork", () => {
        describe("given openToNextWork is true", () => {
            it("should filter employees available for work", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);

                // Act
                await repository.findByOpenToNextWork(true);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { open_to_next_work: true },
                });
            });
        });

        describe("given openToNextWork is false", () => {
            it("should filter employees not available for work", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findByOpenToNextWork(false);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { open_to_next_work: false },
                });
            });
        });
    });

    describe("findByRegisteredDate", () => {
        describe("given a specific date", () => {
            it("should query with date range for that day", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);
                const date = new Date("2024-05-05T12:00:00.000Z");

                // Act
                await repository.findByRegisteredDate(date);

                // Assert
                const call = employeeModel.findMany.mock.calls[0][0];
                expect(call.where.company_registered_date.gte).toBeInstanceOf(Date);
                expect(call.where.company_registered_date.lte).toBeInstanceOf(Date);
                expect(call.where.company_registered_date.gte.getTime())
                    .toBeLessThanOrEqual(call.where.company_registered_date.lte.getTime());
            });
        });
    });

    describe("findByRegisteredDateRange", () => {
        describe("given a date range", () => {
            it("should query with correct date bounds", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);
                const start = new Date("2024-01-01T00:00:00.000Z");
                const end = new Date("2024-01-31T23:59:59.000Z");

                // Act
                await repository.findByRegisteredDateRange(start, end);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: {
                        company_registered_date: {
                            gte: start,
                            lte: end,
                        },
                    },
                });
            });
        });
    });

    // ============================================
    // Status Update Methods
    // ============================================
    describe("changeOpenToNextWork", () => {
        describe("given an employee id and new status", () => {
            it("should update the open_to_next_work field", async () => {
                // Arrange
                employeeModel.update.mockResolvedValue(createEmployeeRow());

                // Act
                await repository.changeOpenToNextWork(10, false);

                // Assert
                expect(employeeModel.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { open_to_next_work: false },
                });
            });
        });

        describe("given toggling status to true", () => {
            it("should set open_to_next_work to true", async () => {
                // Arrange
                employeeModel.update.mockResolvedValue(createEmployeeRow({ open_to_next_work: true }));

                // Act
                await repository.changeOpenToNextWork(15, true);

                // Assert
                expect(employeeModel.update).toHaveBeenCalledWith({
                    where: { id: 15 },
                    data: { open_to_next_work: true },
                });
            });
        });
    });

    describe("findAllOpenToNextWork", () => {
        describe("when called", () => {
            it("should return all employees available for next work", async () => {
                // Arrange
                const rows = [
                    createEmployeeRow({ id: 1, open_to_next_work: true }),
                    createEmployeeRow({ id: 2, open_to_next_work: true }),
                ];
                employeeModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findAllOpenToNextWork();

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { open_to_next_work: true },
                });
                expect(result).toHaveLength(2);
            });
        });
    });
});
