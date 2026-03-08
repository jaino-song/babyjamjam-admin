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
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    });

    const createEmployeeRow = (overrides = {}) => ({
        id: 1,
        name: "Alice",
        workArea: ["Incheon"],
        phone: "010-1234-5678",
        grade: "프리미엄",
        openToNextWork: true,
        companyRegisteredDate: new Date("2024-01-01T00:00:00.000Z"),
        primaryEmployeeSchedules: [],
        secondaryEmployeeSchedules: [],
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
            overrides.grade ?? "베스트",
            overrides.openToNextWork ?? false,
            overrides.registeredDate ?? new Date("2024-02-01T00:00:00.000Z"),
        );
    };

    const organizationId = "org-1";

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
                employeeModel.findFirst.mockResolvedValue(row);

                // Act
                const result = await repository.findById(organizationId, 1);

                // Assert
                expect(employeeModel.findFirst).toHaveBeenCalledWith({
                    where: { id: 1, organizationId: organizationId },
                });
                expect(result).toBeInstanceOf(EmployeeEntity);
                expect(result).toMatchObject({
                    id: 1,
                    name: "Alice",
                    workArea: ["Incheon"],
                    phone: "010-1234-5678",
                    grade: "프리미엄",
                    openToNextWork: true,
                });
            });

        });

        describe("given no employee exists with the specified id", () => {
            it("should return null", async () => {
                // Arrange
                employeeModel.findFirst.mockResolvedValue(null);

                // Act
                const result = await repository.findById(organizationId, 999);

                // Assert
                expect(employeeModel.findFirst).toHaveBeenCalledWith({
                    where: { id: 999, organizationId: organizationId },
                });
                expect(result).toBeNull();
            });
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        describe("given employees exist in the database", () => {
            it("should return all employees as EmployeeEntity array with status", async () => {
                // Arrange
                const rows = [
                    createEmployeeRow({ id: 1, name: "Alice", openToNextWork: true }),
                    createEmployeeRow({ id: 2, name: "Bob", openToNextWork: true }),
                ];
                employeeModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findAll(organizationId);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        include: expect.objectContaining({
                            primaryEmployeeSchedules: expect.any(Object),
                            secondaryEmployeeSchedules: expect.any(Object),
                        }),
                        where: { organizationId: organizationId },
                    }),
                );
                expect(result).toHaveLength(2);
                expect(result[0]).toMatchObject({ id: 1, name: "Alice", status: "available" });
                expect(result[1]).toMatchObject({ id: 2, name: "Bob", status: "available" });
            });
        });

        describe("given no employees exist", () => {
            it("should return an empty array", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([]);

                // Act
                const result = await repository.findAll(organizationId);

                // Assert
                expect(result).toEqual([]);
            });
        });

        describe("status computation", () => {
            it("should return status = 'unavailable' when openToNextWork is false", async () => {
                // Arrange
                const row = createEmployeeRow({
                    openToNextWork: false,
                    primaryEmployeeSchedules: [{ id: 1 }],
                });
                employeeModel.findMany.mockResolvedValue([row]);

                // Act
                const result = await repository.findAll(organizationId);

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.status).toBe("unavailable");
            });

            it("should return status = 'working' when has active primary schedule", async () => {
                // Arrange
                const row = createEmployeeRow({
                    openToNextWork: true,
                    primaryEmployeeSchedules: [{ id: 1 }],
                });
                employeeModel.findMany.mockResolvedValue([row]);

                // Act
                const result = await repository.findAll(organizationId);

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.status).toBe("working");
            });

            it("should return status = 'working' when has active secondary schedule", async () => {
                // Arrange
                const row = createEmployeeRow({
                    openToNextWork: true,
                    secondaryEmployeeSchedules: [{ id: 1 }],
                });
                employeeModel.findMany.mockResolvedValue([row]);

                // Act
                const result = await repository.findAll(organizationId);

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.status).toBe("working");
            });

            it("should return status = 'available' when openToNextWork is true and no schedules", async () => {
                // Arrange
                const row = createEmployeeRow({
                    openToNextWork: true,
                });
                employeeModel.findMany.mockResolvedValue([row]);

                // Act
                const result = await repository.findAll(organizationId);

                // Assert
                expect(result).toHaveLength(1);
                expect(result[0]?.status).toBe("available");
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
                    workArea: ["Seoul"],
                    phone: "010-0000-0000",
                    grade: "베스트",
                    openToNextWork: false,
                });
                // Mock findFirst for ID generation (returns last employee with id: 4)
                employeeModel.findFirst.mockResolvedValue({ id: 4 });
                employeeModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(organizationId, entity);

                // Assert
                expect(employeeModel.findFirst).toHaveBeenCalledWith({
                    orderBy: { id: "desc" },
                    select: { id: true },
                });
                expect(employeeModel.create).toHaveBeenCalledWith({
                    data: {
                        id: 5, // Next ID after 4
                        name: "Test Employee",
                        workArea: ["Seoul"],
                        phone: "010-0000-0000",
                        grade: "베스트",
                        openToNextWork: false,
                        companyRegisteredDate: new Date("2024-02-01T00:00:00.000Z"),
                        organizationId: organizationId,
                    },
                });
                expect(result).toMatchObject({ id: 5, name: "Test Employee" });
            });
        });

        describe("given no employees exist yet", () => {
            it("should start with id 1", async () => {
                // Arrange
                const entity = createEmployeeEntity();
                const createdRow = createEmployeeRow({ id: 1, name: "Test Employee" });
                employeeModel.findFirst.mockResolvedValue(null); // No employees
                employeeModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(organizationId, entity);

                // Assert
                expect(employeeModel.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({ id: 1 }),
                });
                expect(result.id).toBe(1);
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
                    "스탠다드",
                    true,
                    new Date("2023-12-31T00:00:00.000Z"),
                );
                const updatedRow = createEmployeeRow({
                    id: 7,
                    name: "Charlie",
                    workArea: ["Busan"],
                    phone: "010-2222-0000",
                    grade: "스탠다드",
                });
                employeeModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(organizationId, entity);

                // Assert
                expect(employeeModel.update).toHaveBeenCalledWith({
                    where: { id: 7, organizationId: organizationId },
                    data: {
                        name: "Charlie",
                        workArea: ["Busan"],
                        phone: "010-2222-0000",
                        grade: "스탠다드",
                        openToNextWork: true,
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
                await repository.delete(organizationId, 3);

                // Assert
                expect(employeeModel.delete).toHaveBeenCalledWith({
                    where: { id: 3, organizationId: organizationId },
                });
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
                await repository.findByWorkArea(organizationId, "Incheon");

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { workArea: { has: "Incheon" }, organizationId: organizationId },
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
                await repository.findByGrade(organizationId, "프리미엄");

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { grade: "프리미엄", organizationId: organizationId },
                });
            });

        });

        describe("given different grades", () => {
            it.each(["프리미엄", "베스트", "스탠다드", "D"])("should filter by grade %s", async (grade) => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findByGrade(organizationId, grade);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { grade, organizationId: organizationId },
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
                await repository.findByOpenToNextWork(organizationId, true);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { openToNextWork: true, organizationId: organizationId },
                });
            });
        });

        describe("given openToNextWork is false", () => {
            it("should filter employees not available for work", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findByOpenToNextWork(organizationId, false);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { openToNextWork: false, organizationId: organizationId },
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
                await repository.findByRegisteredDate(organizationId, date);

                // Assert
                const call = employeeModel.findMany.mock.calls[0][0];
                expect(call.where.companyRegisteredDate.gte).toBeInstanceOf(Date);
                expect(call.where.companyRegisteredDate.lte).toBeInstanceOf(Date);
                expect(call.where.companyRegisteredDate.gte.getTime())
                    .toBeLessThanOrEqual(call.where.companyRegisteredDate.lte.getTime());
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
                await repository.findByRegisteredDateRange(organizationId, start, end);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: {
                        companyRegisteredDate: {
                            gte: start,
                            lte: end,
                        },
                        organizationId: organizationId,
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
            it("should update the openToNextWork field", async () => {
                // Arrange
                employeeModel.update.mockResolvedValue(createEmployeeRow());

                // Act
                await repository.changeOpenToNextWork(organizationId, 10, false);

                // Assert
                expect(employeeModel.update).toHaveBeenCalledWith({
                    where: { id: 10, organizationId: organizationId },
                    data: { openToNextWork: false },
                });
            });
        });

        describe("given toggling status to true", () => {
            it("should set openToNextWork to true", async () => {
                // Arrange
                employeeModel.update.mockResolvedValue(createEmployeeRow({ openToNextWork: true }));

                // Act
                await repository.changeOpenToNextWork(organizationId, 15, true);

                // Assert
                expect(employeeModel.update).toHaveBeenCalledWith({
                    where: { id: 15, organizationId: organizationId },
                    data: { openToNextWork: true },
                });
            });
        });
    });

    describe("findAllOpenToNextWork", () => {
        describe("when called", () => {
            it("should return all employees available for next work", async () => {
                // Arrange
                const rows = [
                    createEmployeeRow({ id: 1, openToNextWork: true }),
                    createEmployeeRow({ id: 2, openToNextWork: true }),
                ];
                employeeModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findAllOpenToNextWork(organizationId);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { openToNextWork: true, organizationId: organizationId },
                });
                expect(result).toHaveLength(2);
            });
        });
    });
});
