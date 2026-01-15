import { ClientService } from "application/services/client.service";
import { CreateClientUsecase, UpdateClientUsecase, FindClientByIdUsecase, ListClientsUsecase, ListClientsPaginatedUsecase, DeleteClientUsecase } from "application/usecases/client";
import { ClientEntity } from "domain/entities/client.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AlimtalkService } from "application/services/alimtalk.service";

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
            updateMany: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
        },
        client: {
            update: jest.fn(),
        },
        eformsign_doc: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    });

    const createMockAlimtalkService = () => ({
        sendClientCreatedAlimtalk: jest.fn().mockResolvedValue(undefined),
    });

    const createClientEntity = (): ClientEntity => new ClientEntity(
        1,
        "Test Client",
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
        null,
    );

    let service: ClientService;
    let createClientUsecase: ReturnType<typeof createMockCreateClientUsecase>;
    let updateClientUsecase: ReturnType<typeof createMockUpdateClientUsecase>;
    let findClientByIdUsecase: ReturnType<typeof createMockFindClientByIdUsecase>;
    let listClientsUsecase: ReturnType<typeof createMockListClientsUsecase>;
    let listClientsPaginatedUsecase: ReturnType<typeof createMockListClientsPaginatedUsecase>;
    let deleteClientUsecase: ReturnType<typeof createMockDeleteClientUsecase>;
    let prismaService: ReturnType<typeof createMockPrismaService>;
    let alimtalkService: ReturnType<typeof createMockAlimtalkService>;

    beforeEach(() => {
        createClientUsecase = createMockCreateClientUsecase();
        updateClientUsecase = createMockUpdateClientUsecase();
        findClientByIdUsecase = createMockFindClientByIdUsecase();
        listClientsUsecase = createMockListClientsUsecase();
        listClientsPaginatedUsecase = createMockListClientsPaginatedUsecase();
        deleteClientUsecase = createMockDeleteClientUsecase();
        prismaService = createMockPrismaService();
        alimtalkService = createMockAlimtalkService();

        service = new ClientService(
            createClientUsecase as unknown as CreateClientUsecase,
            findClientByIdUsecase as unknown as FindClientByIdUsecase,
            listClientsUsecase as unknown as ListClientsUsecase,
            listClientsPaginatedUsecase as unknown as ListClientsPaginatedUsecase,
            updateClientUsecase as unknown as UpdateClientUsecase,
            deleteClientUsecase as unknown as DeleteClientUsecase,
            prismaService as unknown as PrismaService,
            alimtalkService as unknown as AlimtalkService,
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
            it("should create client first, then create employee_schedule with client_id", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const mockSchedule = { id: 10, client_id: 1 };
                createClientUsecase.execute.mockResolvedValue(mockClient);
                prismaService.employee_schedule.create.mockResolvedValue(mockSchedule);

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
                // Client should be created first
                expect(createClientUsecase.execute).toHaveBeenCalledWith(
                    expect.objectContaining({
                        name: "New Client",
                        address: "123 Main St",
                    })
                );
                // Then schedule with client_id
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        client_id: 1,
                        primary_employee_id: 5,
                        work_address: "123 Main St",
                        replaced: false,
                    }),
                });
                expect(result).toBe(mockClient);
            });
        });

        describe("given client data with both primary and secondary employees", () => {
            it("should create single schedule with both employees", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const mockSchedule = { id: 10, client_id: 1 };
                createClientUsecase.execute.mockResolvedValue(mockClient);
                prismaService.employee_schedule.create.mockResolvedValue(mockSchedule);

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
                expect(prismaService.employee_schedule.create).toHaveBeenCalledTimes(1);
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        client_id: 1,
                        primary_employee_id: 5,
                        secondary_employee_id: 6,
                    }),
                });
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
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                const result = await service.update(1, { name: "New Name", address: "New Address" });

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(1);
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, expect.objectContaining({
                    name: "New Name",
                    address: "New Address",
                }));
                expect(result).toBe(updatedClient);
            });
        });

        describe("given existing client and primary employee change", () => {
            it("should mark old schedule as replaced and create new schedule", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findFirst to return current schedule with a different employee
                prismaService.employee_schedule.findFirst.mockResolvedValue({ 
                    id: 10, 
                    client_id: 1,
                    primary_employee_id: 5,
                    secondary_employee_id: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, client_id: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(1, { primaryEmployeeId: 7 });

                // Assert
                // Should lookup current schedule by client_id
                expect(prismaService.employee_schedule.findFirst).toHaveBeenCalledWith({
                    where: { client_id: 1, replaced: false },
                    orderBy: { id: 'desc' },
                });
                // Mark old schedule as replaced
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, end_date: expect.any(Date) },
                });
                // Create new schedule with client_id
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        client_id: 1,
                        primary_employee_id: 7,
                        replaced: false,
                    }),
                });
            });

            it("should NOT create new schedule if same employee is selected", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Mock findFirst to return current schedule with the SAME employee
                prismaService.employee_schedule.findFirst.mockResolvedValue({ 
                    id: 10, 
                    client_id: 1,
                    primary_employee_id: 7,
                    secondary_employee_id: null,
                });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(1, { primaryEmployeeId: 7 });

                // Assert
                // Should lookup current schedule
                expect(prismaService.employee_schedule.findFirst).toHaveBeenCalled();
                // Should NOT mark old schedule as replaced or create new schedule
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
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
            it("should create new schedule with secondary employee", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // No existing schedule
                prismaService.employee_schedule.findFirst.mockResolvedValue(null);
                prismaService.employee_schedule.create.mockResolvedValue({ id: 21, client_id: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(1, { primaryEmployeeId: 5, secondaryEmployeeId: 8 });

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        client_id: 1,
                        primary_employee_id: 5,
                        secondary_employee_id: 8,
                        replaced: false,
                    }),
                });
            });
        });

        describe("given secondary employee being removed", () => {
            it("should mark old schedule as replaced and create new schedule without secondary", async () => {
                // Arrange
                const existingClient = createClientEntity();
                const updatedClient = createClientEntity();

                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                // Current schedule has secondary employee
                prismaService.employee_schedule.findFirst.mockResolvedValue({ 
                    id: 15, 
                    client_id: 1,
                    primary_employee_id: 5,
                    secondary_employee_id: 6,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, client_id: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(1, { secondaryEmployeeId: null });

                // Assert
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 15 },
                    data: { replaced: true, end_date: expect.any(Date) },
                });
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        client_id: 1,
                        primary_employee_id: 5,
                        secondary_employee_id: null,
                    }),
                });
            });
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        it("should delegate to listClientsUsecase and attach employee info", async () => {
            // Arrange
            const mockClients = [createClientEntity()];
            listClientsUsecase.execute.mockResolvedValue(mockClients);

            // Act
            const result = await service.findAll();

            // Assert
            expect(listClientsUsecase.execute).toHaveBeenCalled();
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                id: 1,
                name: "Test Client",
                primaryEmployee: null,
                secondaryEmployee: null,
                hasSigned: false,
            });
        });
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        it("should delegate to findClientByIdUsecase and attach employee info", async () => {
            // Arrange
            const mockClient = createClientEntity();
            findClientByIdUsecase.execute.mockResolvedValue(mockClient);

            // Act
            const result = await service.findById(1);

            // Assert
            expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(1);
            expect(result).toMatchObject({
                id: 1,
                name: "Test Client",
                primaryEmployee: null,
                secondaryEmployee: null,
                hasSigned: false,
            });
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

    // ============================================
    // terminateService
    // ============================================
    describe("terminateService", () => {
        describe("given existing client", () => {
            it("should update client status to terminated", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const terminatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date(),
                    false, true, "900101", "terminated", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(terminatedClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                // Act
                const result = await service.terminateService(1, "Client requested");

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(1);
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, {
                    serviceStatus: "terminated",
                    endDate: expect.any(Date),
                });
                expect(prismaService.employee_schedule.updateMany).toHaveBeenCalledWith({
                    where: { client_id: 1, replaced: false },
                    data: { end_date: expect.any(Date) },
                });
                expect(result.serviceStatus).toBe("terminated");
            });

            it("should terminate without reason", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const terminatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date(),
                    false, true, "900101", "terminated", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(terminatedClient);
                prismaService.employee_schedule.updateMany = jest.fn().mockResolvedValue({ count: 1 });

                // Act
                const result = await service.terminateService(1);

                // Assert
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, expect.objectContaining({
                    serviceStatus: "terminated",
                }));
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                await expect(service.terminateService(999))
                    .rejects
                    .toThrow("Client with id 999 not found");
            });
        });
    });

    // ============================================
    // requestReplacement
    // ============================================
    describe("requestReplacement", () => {
        describe("given existing client and new employee", () => {
            it("should update status to replacement_requested and create new schedule", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const updatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date("2024-06-01"),
                    false, true, "900101", "replacement_requested", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue({
                    id: 10,
                    client_id: 1,
                    primary_employee_id: 5,
                    secondary_employee_id: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, client_id: 1 });

                // Act
                const result = await service.requestReplacement(1, 7, 8);

                // Assert
                // Should update status
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, {
                    serviceStatus: "replacement_requested",
                });
                // Should mark old schedule as replaced
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, end_date: expect.any(Date) },
                });
                // Should create new schedule with new employees
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        client_id: 1,
                        primary_employee_id: 7,
                        secondary_employee_id: 8,
                        replaced: false,
                    }),
                });
                expect(result.serviceStatus).toBe("replacement_requested");
            });

            it("should handle replacement with primary employee only", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const updatedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000", new Date(), new Date("2024-06-01"),
                    false, true, "900101", "replacement_requested", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(updatedClient);
                prismaService.employee_schedule.findFirst.mockResolvedValue(null); // No existing schedule
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, client_id: 1 });

                // Act
                await service.requestReplacement(1, 7);

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        client_id: 1,
                        primary_employee_id: 7,
                        secondary_employee_id: null,
                        replaced: false,
                    }),
                });
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                await expect(service.requestReplacement(999, 7))
                    .rejects
                    .toThrow("Client with id 999 not found");
            });
        });
    });

    // ============================================
    // completeReplacement
    // ============================================
    describe("completeReplacement", () => {
        describe("given client in replacement_requested status", () => {
            it("should compute and restore status based on dates", async () => {
                // Arrange
                const mockClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000",
                    new Date("2024-01-01"), // start date in the past
                    new Date("2025-12-31"), // end date in the future
                    false, true, "900101", "replacement_requested", false, null
                );
                const completedClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2025-12-31"),
                    false, true, "900101", "active", false, null
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(completedClient);

                // Act
                const result = await service.completeReplacement(1);

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(1);
                // Should compute status (active since we're between start and end dates)
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(1, {
                    serviceStatus: expect.stringMatching(/active|waiting|completed/),
                });
            });
        });

        describe("given client not in replacement_requested status", () => {
            it("should still complete but log warning", async () => {
                // Arrange
                const mockClient = new ClientEntity(
                    1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                    "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2025-12-31"),
                    false, true, "900101", "active", false, null // Not in replacement_requested
                );
                findClientByIdUsecase.execute.mockResolvedValue(mockClient);
                updateClientUsecase.execute.mockResolvedValue(mockClient);

                // Act
                const result = await service.completeReplacement(1);

                // Assert
                // Should still update status
                expect(updateClientUsecase.execute).toHaveBeenCalled();
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                await expect(service.completeReplacement(999))
                    .rejects
                    .toThrow("Client with id 999 not found");
            });
        });
    });

    // ============================================
    // findAllPaginated
    // ============================================
    describe("findAllPaginated", () => {
        it("should return paginated results with employee info", async () => {
            // Arrange
            const mockClients = [createClientEntity()];
            const paginatedResult = {
                data: mockClients,
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1,
            };
            listClientsPaginatedUsecase.execute.mockResolvedValue(paginatedResult);

            // Act
            const result = await service.findAllPaginated(1, 10, "Test");

            // Assert
            expect(listClientsPaginatedUsecase.execute).toHaveBeenCalledWith(1, 10, "Test");
            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(result.page).toBe(1);
            expect(result.totalPages).toBe(1);
        });

        it("should handle empty search results", async () => {
            // Arrange
            const paginatedResult = {
                data: [],
                total: 0,
                page: 1,
                limit: 10,
                totalPages: 0,
            };
            listClientsPaginatedUsecase.execute.mockResolvedValue(paginatedResult);

            // Act
            const result = await service.findAllPaginated(1, 10, "NonExistent");

            // Assert
            expect(result.data).toHaveLength(0);
            expect(result.total).toBe(0);
        });
    });

    // ============================================
    // Service status computation tests
    // ============================================
    describe("service status computation", () => {
        it("should attach computed service status to clients", async () => {
            // Arrange
            // Create client with dates that would result in 'active' status
            const futureEndDate = new Date();
            futureEndDate.setMonth(futureEndDate.getMonth() + 1);
            const pastStartDate = new Date();
            pastStartDate.setMonth(pastStartDate.getMonth() - 1);

            const mockClient = new ClientEntity(
                1, "Test Client", "Test Address", "010-1234-5678", "A형", 15,
                "100000", "50000", "50000",
                pastStartDate, futureEndDate,
                false, true, "900101", "waiting", // Stored as waiting
                false, null
            );
            listClientsUsecase.execute.mockResolvedValue([mockClient]);
            // Mock the prismaService.client.update for background update
            prismaService.client = { update: jest.fn().mockResolvedValue({}) } as unknown as typeof prismaService.client;

            // Act
            const result = await service.findAll();

            // Assert
            // Should return computed status, not stored status
            expect(result).toHaveLength(1);
            expect(result[0]?.serviceStatus).toBe("active");
        });
    });
});
