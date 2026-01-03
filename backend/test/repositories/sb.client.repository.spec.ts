import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientEntity } from "domain/entities/client.entity";

describe("SbClientRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================
    
    const createMockPrismaClient = () => ({
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    });

    const createClientRow = (overrides = {}) => ({
        id: 1,
        name: "John Doe",
        address: "Incheon",
        phone: "010-1111-2222",
        type: "A",
        duration: 15,
        full_price: "100000",
        grant: "50000",
        actual_price: "50000",
        start_date: new Date("2024-01-01T00:00:00.000Z"),
        end_date: new Date("2024-06-01T00:00:00.000Z"),
        care_center: true,
        voucher_client: false,
        birthday: "900101",
        contract_status: "completed",
        breast_pump: true,
        e_doc_id: null,
        ...overrides,
    });

    const createClientEntity = (overrides = {}) => ClientEntity.create({
        name: "Test Client",
        address: "Test Address",
        phone: "010-0000-1111",
        type: "B",
        duration: 12,
        fullPrice: "120000",
        grant: "60000",
        actualPrice: "60000",
        startDate: new Date("2024-02-01T00:00:00.000Z"),
        endDate: new Date("2024-08-01T00:00:00.000Z"),
        careCenter: false,
        voucherClient: true,
        birthday: "950315",
        contractStatus: "pending",
        breastPump: false,
        eDocId: null,
        ...overrides,
    });

    let clientModel: ReturnType<typeof createMockPrismaClient>;
    let prisma: PrismaService;
    let repository: SbClientRepository;

    beforeEach(() => {
        clientModel = createMockPrismaClient();
        prisma = { client: clientModel } as unknown as PrismaService;
        repository = new SbClientRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        describe("given a valid client id exists", () => {
            it("should return the mapped ClientEntity", async () => {
                // Arrange
                const row = createClientRow();
                clientModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findById(1);

                // Assert
                expect(clientModel.findUnique).toHaveBeenCalledTimes(1);
                expect(clientModel.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
                expect(result).toBeInstanceOf(ClientEntity);
                expect(result).toMatchObject({
                    id: 1,
                    name: "John Doe",
                    address: "Incheon",
                    careCenter: true,
                    birthday: "900101",
                    contractStatus: "completed",
                    breastPump: true,
                });
            });
        });

        describe("given a client id does not exist", () => {
            it("should return null", async () => {
                // Arrange
                clientModel.findUnique.mockResolvedValue(null);

                // Act
                const result = await repository.findById(999);

                // Assert
                expect(clientModel.findUnique).toHaveBeenCalledWith({ where: { id: 999 } });
                expect(result).toBeNull();
            });
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        describe("given clients exist in the database", () => {
            it("should return all clients as ClientEntity array", async () => {
                // Arrange
                const rows = [
                    createClientRow({ id: 1, name: "John" }),
                    createClientRow({ id: 2, name: "Jane" }),
                ];
                clientModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findAll();

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith();
                expect(result).toHaveLength(2);
                expect(result[0]).toBeInstanceOf(ClientEntity);
                expect(result[0]).toMatchObject({ id: 1, name: "John" });
                expect(result[1]).toMatchObject({ id: 2, name: "Jane" });
            });
        });

        describe("given no clients exist", () => {
            it("should return an empty array", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);

                // Act
                const result = await repository.findAll();

                // Assert
                expect(result).toEqual([]);
            });
        });
    });

    // ============================================
    // findAllPaginated
    // ============================================
    describe("findAllPaginated", () => {
        describe("given page 1 with limit 10 and no search", () => {
            it("should return paginated result with correct metadata", async () => {
                // Arrange
                const rows = [
                    createClientRow({ id: 1, name: "John" }),
                    createClientRow({ id: 2, name: "Jane" }),
                ];
                clientModel.findMany.mockResolvedValue(rows);
                clientModel.count.mockResolvedValue(15);

                // Act
                const result = await repository.findAllPaginated(1, 10);

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith({
                    where: {},
                    skip: 0,
                    take: 10,
                    orderBy: { id: "desc" },
                });
                expect(clientModel.count).toHaveBeenCalledWith({ where: {} });
                expect(result).toEqual({
                    data: expect.arrayContaining([
                        expect.objectContaining({ id: 1, name: "John" }),
                        expect.objectContaining({ id: 2, name: "Jane" }),
                    ]),
                    total: 15,
                    page: 1,
                    limit: 10,
                    totalPages: 2,
                });
            });
        });

        describe("given page 2 with limit 10", () => {
            it("should calculate correct skip offset", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(25);

                // Act
                await repository.findAllPaginated(2, 10);

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        skip: 10,
                        take: 10,
                    })
                );
            });
        });

        describe("given page 3 with limit 5", () => {
            it("should calculate correct skip offset for different page sizes", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(100);

                // Act
                await repository.findAllPaginated(3, 5);

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        skip: 10, // (3-1) * 5 = 10
                        take: 5,
                    })
                );
            });
        });

        describe("given a search term", () => {
            it("should apply search filter to name, address, and phone", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([createClientRow()]);
                clientModel.count.mockResolvedValue(1);

                const expectedWhere = {
                    OR: [
                        { name: { contains: "John", mode: "insensitive" } },
                        { address: { contains: "John", mode: "insensitive" } },
                        { phone: { contains: "John", mode: "insensitive" } },
                    ],
                };

                // Act
                const result = await repository.findAllPaginated(1, 10, "John");

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith({
                    where: expectedWhere,
                    skip: 0,
                    take: 10,
                    orderBy: { id: "desc" },
                });
                expect(clientModel.count).toHaveBeenCalledWith({ where: expectedWhere });
                expect(result.data).toHaveLength(1);
                expect(result.total).toBe(1);
            });
        });

        describe("given no results found", () => {
            it("should return empty data with zero totals", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(0);

                // Act
                const result = await repository.findAllPaginated(1, 10);

                // Assert
                expect(result).toEqual({
                    data: [],
                    total: 0,
                    page: 1,
                    limit: 10,
                    totalPages: 0,
                });
            });
        });

        describe("given total is exact multiple of limit", () => {
            it("should calculate totalPages correctly", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(20);

                // Act
                const result = await repository.findAllPaginated(1, 10);

                // Assert
                expect(result.totalPages).toBe(2);
            });
        });

        describe("given total is not exact multiple of limit", () => {
            it("should round up totalPages", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(21);

                // Act
                const result = await repository.findAllPaginated(1, 10);

                // Assert
                expect(result.totalPages).toBe(3);
            });
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        describe("given a valid ClientEntity", () => {
            it("should persist client with correct data mapping", async () => {
                // Arrange
                const entity = createClientEntity();
                const createdRow = createClientRow({
                    id: 5,
                    name: "Test Client",
                });
                clientModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(entity);

                // Assert
                expect(clientModel.create).toHaveBeenCalledWith({
                    data: {
                        name: "Test Client",
                        address: "Test Address",
                        phone: "010-0000-1111",
                        type: "B",
                        duration: 12,
                        full_price: "120000",
                        grant: "60000",
                        actual_price: "60000",
                        start_date: new Date("2024-02-01T00:00:00.000Z"),
                        end_date: new Date("2024-08-01T00:00:00.000Z"),
                        care_center: false,
                        voucher_client: true,
                        birthday: "950315",
                        contract_status: "pending",
                        breast_pump: false,
                        e_doc_id: null,
                    },
                });
                expect(result).toBeInstanceOf(ClientEntity);
                expect(result.id).toBe(5);
            });
        });

        describe("given entity with null optional fields", () => {
            it("should handle null values correctly", async () => {
                // Arrange
                const entity = createClientEntity({
                    address: null,
                    phone: null,
                    type: null,
                    birthday: null,
                    contractStatus: null,
                });
                const createdRow = createClientRow({
                    id: 6,
                    address: null,
                    phone: null,
                    type: null,
                    birthday: null,
                    contract_status: null,
                });
                clientModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(entity);

                // Assert
                expect(clientModel.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({
                        address: null,
                        phone: null,
                        type: null,
                        birthday: null,
                        contract_status: null,
                    }),
                });
                expect(result.address).toBeNull();
            });
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given an existing ClientEntity with changes", () => {
            it("should update client with correct data mapping", async () => {
                // Arrange
                const entity = new ClientEntity(
                    7,
                    "Updated Name",
                    "Updated Address",
                    "010-3333-4444",
                    "C",
                    6,
                    "60000",
                    "30000",
                    "30000",
                    new Date("2024-03-01T00:00:00.000Z"),
                    new Date("2024-09-01T00:00:00.000Z"),
                    true,
                    false,
                    "880520",
                    "in_progress",
                    true,
                    null,
                );
                const updatedRow = createClientRow({
                    id: 7,
                    name: "Updated Name",
                });
                clientModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(clientModel.update).toHaveBeenCalledWith({
                    where: { id: 7 },
                    data: {
                        name: "Updated Name",
                        address: "Updated Address",
                        phone: "010-3333-4444",
                        type: "C",
                        duration: 6,
                        full_price: "60000",
                        grant: "30000",
                        actual_price: "30000",
                        start_date: new Date("2024-03-01T00:00:00.000Z"),
                        end_date: new Date("2024-09-01T00:00:00.000Z"),
                        care_center: true,
                        voucher_client: false,
                        birthday: "880520",
                        contract_status: "in_progress",
                        breast_pump: true,
                        e_doc_id: null,
                    },
                });
                expect(result).toBeInstanceOf(ClientEntity);
                expect(result.id).toBe(7);
            });
        });

        describe("given entity with breastPump toggled", () => {
            it("should correctly update breast_pump field", async () => {
                // Arrange
                const entity = new ClientEntity(
                    8, "Client", null, null, null, null,
                    null, null, null, null, null, false, false,
                    null, null, true, null, // breastPump = true, eDocId = null
                );
                const updatedRow = createClientRow({ id: 8, breast_pump: true });
                clientModel.update.mockResolvedValue(updatedRow);

                // Act
                await repository.update(entity);

                // Assert
                expect(clientModel.update).toHaveBeenCalledWith({
                    where: { id: 8 },
                    data: expect.objectContaining({
                        breast_pump: true,
                    }),
                });
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        describe("given a valid client id", () => {
            it("should delete the client", async () => {
                // Arrange
                clientModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete(4);

                // Assert
                expect(clientModel.delete).toHaveBeenCalledTimes(1);
                expect(clientModel.delete).toHaveBeenCalledWith({ where: { id: 4 } });
            });
        });

        describe("given different client ids", () => {
            it.each([1, 10, 100, 999])("should delete client with id %i", async (id) => {
                // Arrange
                clientModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete(id);

                // Assert
                expect(clientModel.delete).toHaveBeenCalledWith({ where: { id } });
            });
        });
    });
});
