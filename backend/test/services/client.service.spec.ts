import { ClientService } from "../../application/services/client.service";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsPaginatedUsecase,
    ListClientsUsecase,
    UpdateClientUsecase,
} from "../../application/usecases/client";
import { AlimtalkService } from "../../application/services/alimtalk.service";
import { AlimtalkTriggerService } from "../../application/services/alimtalk-trigger.service";
import { ClientEntity } from "../../domain/entities/client.entity";
import { IClientRepository } from "../../domain/repositories/client.repository.interface";
import { PrismaService } from "../../infrastructure/database/prisma.service";

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
        area: {
            findFirst: jest.fn().mockResolvedValue({ id: "incheon" }),
        },
    });

    const createMockAlimtalkService = () => ({
        sendClientCreatedAlimtalk: jest.fn().mockResolvedValue(undefined),
    });

    const createMockTriggerService = () => ({
        ensureDefaultRulesForBranch: jest.fn().mockResolvedValue(undefined),
        syncClientRulesForClient: jest.fn().mockResolvedValue(undefined),
        syncEmployeeAssignmentRulesForSchedule: jest.fn().mockResolvedValue(undefined),
    });

    const createMockClientRepository = (): jest.Mocked<IClientRepository> => ({
        findById: jest.fn(),
        findAll: jest.fn(),
        findAllPaginated: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findByStartDate: jest.fn(),
        findByEndDate: jest.fn(),
        findByCreatedDate: jest.fn(),
        findStartingWithinDays: jest.fn().mockResolvedValue([]),
        findEndingWithinDays: jest.fn().mockResolvedValue([]),
        findWithIncompleteContractsStartingWithinDays: jest.fn().mockResolvedValue([]),
        findWithoutContractSentStartingWithinDays: jest.fn().mockResolvedValue([]),
        findByPhone: jest.fn().mockResolvedValue(null),
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

    const branchId = "org-1";

    let service: ClientService;
    let createClientUsecase: ReturnType<typeof createMockCreateClientUsecase>;
    let updateClientUsecase: ReturnType<typeof createMockUpdateClientUsecase>;
    let findClientByIdUsecase: ReturnType<typeof createMockFindClientByIdUsecase>;
    let listClientsUsecase: ReturnType<typeof createMockListClientsUsecase>;
    let listClientsPaginatedUsecase: ReturnType<typeof createMockListClientsPaginatedUsecase>;
    let deleteClientUsecase: ReturnType<typeof createMockDeleteClientUsecase>;
    let prismaService: ReturnType<typeof createMockPrismaService>;
    let alimtalkService: ReturnType<typeof createMockAlimtalkService>;
    let triggerService: ReturnType<typeof createMockTriggerService>;
    let clientRepository: ReturnType<typeof createMockClientRepository>;

    beforeEach(() => {
        createClientUsecase = createMockCreateClientUsecase();
        updateClientUsecase = createMockUpdateClientUsecase();
        findClientByIdUsecase = createMockFindClientByIdUsecase();
        listClientsUsecase = createMockListClientsUsecase();
        listClientsPaginatedUsecase = createMockListClientsPaginatedUsecase();
        deleteClientUsecase = createMockDeleteClientUsecase();
        prismaService = createMockPrismaService();
        alimtalkService = createMockAlimtalkService();
        triggerService = createMockTriggerService();
        clientRepository = createMockClientRepository();

        service = new ClientService(
            createClientUsecase as unknown as CreateClientUsecase,
            findClientByIdUsecase as unknown as FindClientByIdUsecase,
            listClientsUsecase as unknown as ListClientsUsecase,
            listClientsPaginatedUsecase as unknown as ListClientsPaginatedUsecase,
            updateClientUsecase as unknown as UpdateClientUsecase,
            deleteClientUsecase as unknown as DeleteClientUsecase,
            prismaService as unknown as PrismaService,
            alimtalkService as unknown as AlimtalkService,
            clientRepository,
            triggerService as unknown as AlimtalkTriggerService,
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
            it("should create client first, then create employee_schedule with clientId", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const mockSchedule = { id: 10, clientId: 1 };
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
                const result = await service.create(branchId, params);

                // Assert
                // Client should be created first
                expect(createClientUsecase.execute).toHaveBeenCalledWith(
                    branchId,
                    expect.objectContaining({
                        name: "New Client",
                        address: "123 Main St",
                    })
                );
                // Then schedule with clientId
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 5,
                        workAddress: "123 Main St",
                        replaced: false,
                    }),
                });
                expect(result).toBe(mockClient);
            });
        });

        describe("given valid client data without primary employee", () => {
            it("should create client and skip employee_schedule creation", async () => {
                // Arrange
                const mockClient = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(mockClient);

                const params = {
                    name: "New Client",
                    address: "123 Main St",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert
                expect(createClientUsecase.execute).toHaveBeenCalledWith(
                    branchId,
                    expect.objectContaining({
                        name: "New Client",
                        address: "123 Main St",
                    })
                );
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(result).toBe(mockClient);
            });
        });

        it("should allow an areaId when the area belongs to the branch", async () => {
            // Arrange
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            const params = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: null,
                voucherClient: true,
                breastPump: false,
                areaId: "incheon",
            };

            // Act
            await service.create(branchId, params);

            // Assert
            expect(prismaService.area.findFirst).toHaveBeenCalledWith({
                where: {
                    id: "incheon",
                    OR: [{ branchId }, { branchId: null }],
                },
                select: { id: true },
            });
            expect(createClientUsecase.execute).toHaveBeenCalledWith(
                branchId,
                expect.objectContaining({
                    areaId: "incheon",
                    careCenter: null,
                }),
            );
        });

        it("calls ensureDefaultRulesForBranch then syncClientRulesForClient with suppressGreeting=false by default", async () => {
            // Arrange
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            const params = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
            };

            // Act
            await service.create(branchId, params);

            // Assert
            expect(triggerService.ensureDefaultRulesForBranch).toHaveBeenCalledWith(branchId);
            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                branchId,
                mockClient.id,
                true,
                false,
            );
        });

        it("calls ensureDefaultRulesForBranch then syncClientRulesForClient with suppressGreeting=true when suppressGreetingSms is set", async () => {
            // Arrange
            const mockClient = createClientEntity();
            createClientUsecase.execute.mockResolvedValue(mockClient);

            const params = {
                name: "New Client",
                phone: "010-1234-5678",
                careCenter: false,
                voucherClient: true,
                breastPump: false,
                suppressGreetingSms: true,
            };

            // Act
            await service.create(branchId, params);

            // Assert
            expect(triggerService.ensureDefaultRulesForBranch).toHaveBeenCalledWith(branchId);
            expect(triggerService.syncClientRulesForClient).toHaveBeenCalledWith(
                branchId,
                mockClient.id,
                true,
                true,
            );
        });

        describe("given client data with both primary and secondary employees", () => {
            it("should create single schedule with both employees", async () => {
                // Arrange
                const mockClient = createClientEntity();
                const mockSchedule = { id: 10, clientId: 1 };
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
                await service.create(branchId, params);

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledTimes(1);
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: 6,
                    }),
                });
            });
        });

        describe("phone deduplication (reuse-existing)", () => {
            it("reuses the existing client when a client with the same normalized phone already exists in the branch", async () => {
                // Arrange
                const existingClient = createClientEntity();
                clientRepository.findByPhone.mockResolvedValue(existingClient);

                const params = {
                    name: "New Client",
                    phone: "010-1234-5678",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert: returns the existing client unchanged
                expect(result).toBe(existingClient);
                // Assert: no new client was created
                expect(createClientUsecase.execute).not.toHaveBeenCalled();
                expect(clientRepository.create).not.toHaveBeenCalled();
                // Assert: no side-effects fired
                expect(alimtalkService.sendClientCreatedAlimtalk).not.toHaveBeenCalled();
                expect(triggerService.syncClientRulesForClient).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            });

            it("creates a new client when no client with that phone exists in the branch", async () => {
                // Arrange — findByPhone returns null (no duplicate)
                clientRepository.findByPhone.mockResolvedValue(null);
                const mockClient = createClientEntity();
                createClientUsecase.execute.mockResolvedValue(mockClient);

                const params = {
                    name: "New Client",
                    phone: "010-9999-0000",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                };

                // Act
                const result = await service.create(branchId, params);

                // Assert: normal create path ran
                expect(createClientUsecase.execute).toHaveBeenCalledTimes(1);
                expect(result).toBe(mockClient);
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
                const result = await service.update(branchId, 1, { name: "New Name", address: "New Address" });

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.update).not.toHaveBeenCalled();
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, expect.objectContaining({
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
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { primaryEmployeeId: 7 });

                // Assert
                // Should lookup current schedule by clientId
                expect(prismaService.employee_schedule.findFirst).toHaveBeenCalledWith({
                    where: { clientId: 1, branchId: "org-1", replaced: false },
                    orderBy: { id: 'desc' },
                });
                // Mark old schedule as replaced
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                // Create new schedule with clientId
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 7,
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
                    clientId: 1,
                    primaryEmployeeId: 7,
                    secondaryEmployeeId: null,
                });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { primaryEmployeeId: 7 });

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
                await expect(service.update(branchId, 999, { name: "New Name" }))
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
                prismaService.employee_schedule.create.mockResolvedValue({ id: 21, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { primaryEmployeeId: 5, secondaryEmployeeId: 8 });

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: 8,
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
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: 6,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });
                updateClientUsecase.execute.mockResolvedValue(updatedClient);

                // Act
                await service.update(branchId, 1, { secondaryEmployeeId: null });

                // Assert
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 15 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 5,
                        secondaryEmployeeId: null,
                    }),
                });
            });
        });

        describe("phone collision guard", () => {
            it("rejects updating a client's phone to one already used by another client in the branch", async () => {
                // Arrange
                const existingClient = createClientEntity(); // id = 1
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);

                // Another client (id = 2) already holds that phone
                const otherClient = new ClientEntity(
                    2, "Other Client", "Other Address", "010-1234-5678",
                    "A형", 15, "100000", "50000", "50000",
                    new Date("2024-01-01"), new Date("2024-06-01"),
                    false, true, "900101", "pending", false, null,
                );
                clientRepository.findByPhone.mockResolvedValue(otherClient);

                // Act & Assert
                await expect(
                    service.update(branchId, 1, { phone: "010-1234-5678" }),
                ).rejects.toThrow(expect.objectContaining({ status: 409 }));

                // No DB writes should have occurred
                expect(updateClientUsecase.execute).not.toHaveBeenCalled();
                expect(prismaService.employee_schedule.create).not.toHaveBeenCalled();
            });

            it("allows update when the matching client is the same record (self)", async () => {
                // Arrange
                const existingClient = createClientEntity(); // id = 1
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(existingClient);

                // findByPhone returns the same client (id = 1) — keeping own phone
                clientRepository.findByPhone.mockResolvedValue(existingClient);

                // Act
                await service.update(branchId, 1, { phone: "010-1234-5678" });

                // Assert: update proceeded
                expect(updateClientUsecase.execute).toHaveBeenCalledTimes(1);
            });

            it("allows update when no other client has that phone", async () => {
                // Arrange
                const existingClient = createClientEntity();
                findClientByIdUsecase.execute.mockResolvedValue(existingClient);
                updateClientUsecase.execute.mockResolvedValue(existingClient);

                // findByPhone returns null — no collision
                clientRepository.findByPhone.mockResolvedValue(null);

                // Act
                await service.update(branchId, 1, { phone: "010-9999-0000" });

                // Assert: update proceeded
                expect(updateClientUsecase.execute).toHaveBeenCalledTimes(1);
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
            const result = await service.findAll(branchId);

            // Assert
            expect(listClientsUsecase.execute).toHaveBeenCalledWith(branchId);
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
            const result = await service.findById(branchId, 1);

            // Assert
            expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
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
            await service.delete(branchId, 1);

            // Assert
            expect(deleteClientUsecase.execute).toHaveBeenCalledWith(branchId, 1);
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
                const result = await service.terminateService(branchId, 1, "Client requested");

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, {
                    serviceStatus: "terminated",
                    endDate: expect.any(Date),
                });
                expect(prismaService.employee_schedule.updateMany).toHaveBeenCalledWith({
                    where: { clientId: 1, replaced: false },
                    data: { endDate: expect.any(Date) },
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
                await service.terminateService(branchId, 1);

                // Assert
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, expect.objectContaining({
                    serviceStatus: "terminated",
                }));
            });
        });

        describe("given non-existent client", () => {
            it("should throw NotFoundException", async () => {
                // Arrange
                findClientByIdUsecase.execute.mockResolvedValue(null);

                // Act & Assert
                await expect(service.terminateService(branchId, 999))
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
                    clientId: 1,
                    primaryEmployeeId: 5,
                    secondaryEmployeeId: null,
                });
                prismaService.employee_schedule.update.mockResolvedValue({});
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });

                // Act
                const result = await service.requestReplacement(branchId, 1, 7, 8);

                // Assert
                // Should update status
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, {
                    serviceStatus: "replacement_requested",
                });
                // Should mark old schedule as replaced
                expect(prismaService.employee_schedule.update).toHaveBeenCalledWith({
                    where: { id: 10 },
                    data: { replaced: true, endDate: expect.any(Date) },
                });
                // Should create new schedule with new employees
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 7,
                        secondaryEmployeeId: 8,
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
                prismaService.employee_schedule.create.mockResolvedValue({ id: 20, clientId: 1 });

                // Act
                await service.requestReplacement(branchId, 1, 7);

                // Assert
                expect(prismaService.employee_schedule.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        clientId: 1,
                        primaryEmployeeId: 7,
                        secondaryEmployeeId: null,
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
                await expect(service.requestReplacement(branchId, 999, 7))
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
                await service.completeReplacement(branchId, 1);

                // Assert
                expect(findClientByIdUsecase.execute).toHaveBeenCalledWith(branchId, 1);
                // Should compute status (active since we're between start and end dates)
                expect(updateClientUsecase.execute).toHaveBeenCalledWith(branchId, 1, {
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
                await service.completeReplacement(branchId, 1);

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
                await expect(service.completeReplacement(branchId, 999))
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
            const result = await service.findAllPaginated(branchId, 1, 10, "Test");

            // Assert
            expect(listClientsPaginatedUsecase.execute).toHaveBeenCalledWith(branchId, 1, 10, "Test");
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
            const result = await service.findAllPaginated(branchId, 1, 10, "NonExistent");

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
            const result = await service.findAll(branchId);

            // Assert
            // Should return computed status, not stored status
            expect(result).toHaveLength(1);
            expect(result[0]?.serviceStatus).toBe("active");
        });
    });
});
