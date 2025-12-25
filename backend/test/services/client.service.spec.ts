import { ClientService } from "application/services/client.service";
import { CreateClientUsecase, UpdateClientUsecase, FindClientByIdUsecase, ListClientsUsecase, ListClientsPaginatedUsecase, DeleteClientUsecase } from "application/usecases/client";
import { ClientEntity } from "domain/entities/client.entity";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("ClientService", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================
    
    const createMockCreateClientUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockUpdateClientUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockFindClientByIdUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockListClientsUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockListClientsPaginatedUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockDeleteClientUsecase = () => ({
        execute: jest.fn(),
    });

    const createMockPrismaService = () => ({
        employee_schedule: {
            create: jest.fn(),
            update: jest.fn(),
            findUnique: jest.fn(),
        },
    });

    const createClientEntity = (): ClientEntity => new ClientEntity(
        1,
        "Test Client",
        1, // primaryScheduleId
        null, // secondaryScheduleId
        "Test Address",
        "010-1234-5678",
        "A형",
        15,
        "100000",
        "50000",
        "50000",
        new Date("2024-01-01"),
        new Date("2024-06-01"),
        false,
        true,
        "900101",
        "pending",
        false,
    );

    let service: ClientService;
    let createClientUsecase: ReturnType<typeof createMockCreateClientUsecase>;
    let updateClientUsecase: ReturnType<typeof createMockUpdateClientUsecase>;
    let findClientByIdUsecase: ReturnType<typeof createMockFindClientByIdUsecase>;
    let listClientsUsecase: ReturnType<typeof createMockListClientsUsecase>;
    let listClientsPaginatedUsecase: ReturnType<typeof createMockListClientsPaginatedUsecase>;
    let deleteClientUsecase: ReturnType<typeof createMockDeleteClientUsecase>;
    let prismaService: ReturnType<typeof createMockPrismaService>;

    beforeEach(() => {
        createClientUsecase = createMockCreateClientUsecase();
        updateClientUsecase = createMockUpdateClientUsecase();
        findClientByIdUsecase = createMockFindClientByIdUsecase();
        listClientsUsecase = createMockListClientsUsecase();
        listClientsPaginatedUsecase = createMockListClientsPaginatedUsecase();
        deleteClientUsecase = createMockDeleteClientUsecase();
        prismaService = createMockPrismaService();

        service = new ClientService(
            createClientUsecase as unknown as CreateClientUsecase,
            findClientByIdUsecase as unknown as FindClientByIdUsecase,
            listClientsUsecase as unknown as ListClientsUsecase,
            listClientsPaginatedUsecase as unknown as ListClientsPaginatedUsecase,
            updateClientUsecase as unknown as UpdateClientUsecase,
            deleteClientUsecase as unknown as DeleteClientUsecase,
            prismaService as unknown as PrismaService,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        describe("given valid client data with primary employee", () => {
            it("should create employee_schedule and then create client", async () => {
                // Arrange
                const mockSchedule = { id: 10 };
                const mockClient = createClientEntity();
                prismaService.employee_schedule.create.mockResolvedValue(mockSchedule);
                createClientUsecase.execute.mockResolvedValue(mockClient);

                const params = {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    address: "123 Main St",
                    phone: "010-1234-5678",
                    startDate: "2024-01-01",
                    endDate: "2024-06-01",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                };

                // Act
                const result = await service.create(params);

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledTimes(1);
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        employee_id: 5,
                        work_address: "123 Main St",
                        replaced: false,
                    }),
                });
                expect(createClientUsecase.execute).toHaveBeenCalledWith(
                    expect.objectContaining({
                        name: "New Client",
                        primaryScheduleId: 10,
                        secondaryScheduleId: null,
                    })
                );
                expect(result).toBe(mockClient);
            });
        });

        describe("given client data with both primary and secondary employees", () => {
            it("should create two employee_schedules", async () => {
                // Arrange
                const mockPrimarySchedule = { id: 10 };
                const mockSecondarySchedule = { id: 11 };
                const mockClient = createClientEntity();
                prismaService.employee_schedule.create
                    .mockResolvedValueOnce(mockPrimarySchedule)
                    .mockResolvedValueOnce(mockSecondarySchedule);
                createClientUsecase.execute.mockResolvedValue(mockClient);

                const params = {
                    name: "New Client",
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 6,
                    address: "123 Main St",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                };

                // Act
                await service.create(params);

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledTimes(2);
                expect(createClientUsecase.execute).toHaveBeenCalledWith(
                    expect.objectContaining({
                        primaryScheduleId: 10,
                        secondaryScheduleId: 11,
                    })
                );
            });
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given existing client and no employee change", () => {
            it("should update client without creating new schedule", async () => {
                // Arrange
                const existingClient = new ClientEntity(
                    1, "Old Name", 10, null, "Old Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );
                const updatedClient = new ClientEntity(
                    1, "New Name", 10, null, "New Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                const result = await service.update(1, { name: "New Name", address: "New Address" });

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(1);
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, {
                    name: "New Name",
                    primaryScheduleId: undefined,
                    secondaryScheduleId: undefined,
                    address: "New Address",
                    phone: undefined,
                    type: undefined,
                    duration: undefined,
                    fullPrice: undefined,
                    grant: undefined,
                    actualPrice: undefined,
                    startDate: undefined,
                    endDate: undefined,
                    careCenter: undefined,
                    voucherClient: undefined,
                    birthday: undefined,
                    contractStatus: undefined,
                    breastPump: undefined,
                });
                expect(result).toBe(updatedClient);
            });
        });

        describe("given existing client and primary employee change", () => {
            it("should mark old schedule as replaced and create new schedule", async () => {
                // Arrange
                const existingClient = new ClientEntity(
                    1, "Client", 10, null, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );
                const updatedClient = new ClientEntity(
                    1, "Client", 20, null, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findUnique to return current schedule with a different employee
                prismaService.employee_schedule.findUnique.mockResolvedValue({ id: 10, employee_id: 5 });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(1, { primaryEmployeeId: 7 });

                // Assert
                // Should lookup current employee
                expect(prismaService.employee_schedule.findUnique).toHaveBeenCalledWith({
                    where: { id: 10 },
                });
                // Mark old schedule as replaced
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, end_date: expect.any(Date) },
                });
                // Create new schedule
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        employee_id: 7,
                        replaced: false,
                    }),
                });
                // Update client with new schedule ID
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, 
                    expect.objectContaining({
                        primaryScheduleId: 20,
                    })
                );
            });

            it("should NOT create new schedule if same employee is selected", async () => {
                // Arrange
                const existingClient = new ClientEntity(
                    1, "Client", 10, null, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );
                const updatedClient = new ClientEntity(
                    1, "Client", 10, null, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findUnique to return current schedule with the SAME employee
                prismaService.employee_schedule.findUnique.mockResolvedValue({ id: 10, employee_id: 7 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(1, { primaryEmployeeId: 7 });

                // Assert
                // Should lookup current employee
                expect(prismaService.employee_schedule.findUnique).toHaveBeenCalledWith({
                    where: { id: 10 },
                });
                // Should NOT mark old schedule as replaced or create new schedule
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                // Update client without changing schedule
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, 
                    expect.objectContaining({
                        primaryScheduleId: undefined,
                    })
                );
            });
        });

        describe("given non-existent client", () => {
            it("should throw error", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                await expect(service.update(999, { name: "New Name" }))
                    .rejects
                    .toThrow("Client with id 999 not found");
            });
        });

        describe("given secondary employee being added", () => {
            it("should create new secondary schedule", async () => {
                // Arrange
                const existingClient = new ClientEntity(
                    1, "Client", 10, null, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );
                const updatedClient = new ClientEntity(
                    1, "Client", 10, 21, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                prismaService.employee_schedule.create.mockResolvedValue({ id: 21 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(1, { secondaryEmployeeId: 8 });

                // Assert
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        employee_id: 8,
                        replaced: false,
                    }),
                });
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, 
                    expect.objectContaining({
                        secondaryScheduleId: 21,
                    })
                );
            });
        });

        describe("given secondary employee being removed", () => {
            it("should mark old schedule as replaced and set secondaryScheduleId to null", async () => {
                // Arrange
                const existingClient = new ClientEntity(
                    1, "Client", 10, 15, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );
                const updatedClient = new ClientEntity(
                    1, "Client", 10, null, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findUnique to return current schedule with a different employee (so null is a change)
                prismaService.employee_schedule.findUnique.mockResolvedValue({ id: 15, employee_id: 6 });
                prismaService.employee_schedule.update.mockResolvedValue({});
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(1, { secondaryEmployeeId: null });

                // Assert
                expect(prismaService.employee_schedule.findUnique).toHaveBeenCalledWith({
                    where: { id: 15 },
                });
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 15 },
                    data: { replaced: true, end_date: expect.any(Date) },
                });
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, 
                    expect.objectContaining({
                        secondaryScheduleId: null,
                    })
                );
            });
        });

        describe("given secondary employee being changed to same employee", () => {
            it("should NOT create new schedule if same employee is selected", async () => {
                // Arrange
                const existingClient = new ClientEntity(
                    1, "Client", 10, 15, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );
                const updatedClient = new ClientEntity(
                    1, "Client", 10, 15, "Address", "010-0000-0000",
                    "A", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false
                );

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findUnique to return current schedule with the SAME employee
                prismaService.employee_schedule.findUnique.mockResolvedValue({ id: 15, employee_id: 8 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(1, { secondaryEmployeeId: 8 });

                // Assert
                expect(prismaService.employee_schedule.findUnique).toHaveBeenCalledWith({
                    where: { id: 15 },
                });
                // Should NOT mark old schedule as replaced or create new schedule
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                // Update client without changing schedule
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, 
                    expect.objectContaining({
                        secondaryScheduleId: undefined,
                    })
                );
            });
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        it("should delegate to listClientsUsecase", async () => {
            // Arrange
            const mockClients = [createClientEntity()];
            listClientsUsecase.execute.mockResolvedValue(mockClients);

            // Act
            const result = await service.findAll();

            // Assert
            expect(listClientsUsecase.execute).toHaveBeenCalled();
            expect(result).toBe(mockClients);
        });
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        it("should delegate to findClientByIdUsecase", async () => {
            // Arrange
            const mockClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(mockClient);

            // Act
            const result = await service.findById(1);

            // Assert
            expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(1);
            expect(result).toBe(mockClient);
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        it("should delegate to deleteClientUsecase", async () => {
            // Arrange
            deleteClientUsecase.execute.mockResolvedValue(undefined);

            // Act
            await service.delete(1);

            // Assert
            expect(deleteClientUsecase.execute).toHaveBeenCalledWith(1);
        });
    });
});

