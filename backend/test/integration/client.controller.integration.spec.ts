import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { ClientController } from "interface/controllers/client.controller";
import { ClientService } from "application/services/client.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { ClientEntity } from "domain/entities/client.entity";

describe("ClientController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let clientService: jest.Mocked<ClientService>;

    type ClientOverrides = Partial<{
        id: number;
        name: string;
        address: string | null;
        phone: string | null;
        type: string | null;
        duration: number | null;
        fullPrice: string | null;
        grant: string | null;
        actualPrice: string | null;
        startDate: Date | null;
        endDate: Date | null;
        careCenter: boolean;
        voucherClient: boolean;
        birthday: string | null;
        contractStatus: string | null;
        breastPump: boolean;
        eDocId: string | null;
    }>;

    const createMockClient = (overrides: ClientOverrides = {}): ClientEntity => {
        return new ClientEntity(
            overrides.id ?? 1,
            overrides.name ?? "Test Client",
            overrides.address ?? "Seoul",
            overrides.phone ?? "010-1234-5678",
            overrides.type ?? "standard",
            overrides.duration ?? 30,
            overrides.fullPrice ?? "100000",
            overrides.grant ?? "50000",
            overrides.actualPrice ?? "50000",
            overrides.startDate ?? new Date("2025-01-01"),
            overrides.endDate ?? new Date("2025-01-31"),
            overrides.careCenter ?? true,
            overrides.voucherClient ?? false,
            overrides.birthday ?? "1990-01-15",
            overrides.contractStatus ?? "active",
            overrides.breastPump ?? false,
            overrides.eDocId ?? null,
        );
    };

    const createClientWithEmployeeInfo = (client: ClientEntity) => ({
        ...client,
        primaryEmployee: null,
        secondaryEmployee: null,
        hasSigned: false,
    });

    beforeEach(async () => {
        const mockClientService = {
            create: jest.fn(),
            findAll: jest.fn(),
            findAllPaginated: jest.fn(),
            findById: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [ClientController],
            providers: [
                {
                    provide: ClientService,
                    useValue: mockClientService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue({ canActivate: () => true }) // JWT Guard를 항상 통과하도록 Mock
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        clientService = moduleFixture.get(ClientService);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // POST /clients - Create
    // ============================================
    describe("POST /clients", () => {
        describe("given valid client data", () => {
            it("should create a new client and return 201", async () => {
                // Arrange
                const createDto = {
                    name: "New Client",
                    primaryEmployeeId: 10,
                    address: "Incheon",
                    phone: "010-9999-8888",
                    careCenter: true,
                    voucherClient: false,
                    breastPump: false,
                };
                const createdClient = createMockClient({ id: 5, ...createDto });
                clientService.create.mockResolvedValue(createdClient);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/clients")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(clientService.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        name: "New Client",
                        primaryEmployeeId: 10,
                    }),
                );
            });
        });

        describe("given missing required fields", () => {
            it("should return 400 for missing name", async () => {
                // Arrange
                const invalidDto = {
                    primaryEmployeeId: 10,
                    careCenter: true,
                    voucherClient: false,
                    breastPump: false,
                };

                // Act
                const response = await request(app.getHttpServer())
                    .post("/clients")
                    .send(invalidDto);

                // Assert
                expect(response.status).toBe(400);
            });
        });
    });

    // ============================================
    // GET /clients - List All
    // ============================================
    describe("GET /clients", () => {
        describe("given clients exist", () => {
            it("should return all clients", async () => {
                // Arrange
                const clients = [
                    createClientWithEmployeeInfo(createMockClient({ id: 1, name: "Client A" })),
                    createClientWithEmployeeInfo(createMockClient({ id: 2, name: "Client B" })),
                ];
                clientService.findAll.mockResolvedValue(clients);

                // Act
                const response = await request(app.getHttpServer()).get("/clients");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(2);
                expect(clientService.findAll).toHaveBeenCalled();
            });
        });

        describe("given pagination parameters", () => {
            it("should return paginated results", async () => {
                // Arrange
                const paginatedResult = {
                    data: [createClientWithEmployeeInfo(createMockClient({ id: 1 }))],
                    total: 10,
                    page: 1,
                    limit: 5,
                    totalPages: 2,
                };
                clientService.findAllPaginated.mockResolvedValue(paginatedResult);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/clients")
                    .query({ page: "1", limit: "5" });

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.findAllPaginated).toHaveBeenCalledWith(1, 5, undefined);
            });

            it("should pass search query to paginated method", async () => {
                // Arrange
                const paginatedResult = {
                    data: [],
                    total: 0,
                    page: 1,
                    limit: 10,
                    totalPages: 0,
                };
                clientService.findAllPaginated.mockResolvedValue(paginatedResult);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/clients")
                    .query({ page: "1", limit: "10", search: "Kim" });

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.findAllPaginated).toHaveBeenCalledWith(1, 10, "Kim");
            });
        });

        describe("given no clients exist", () => {
            it("should return empty array", async () => {
                // Arrange
                clientService.findAll.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer()).get("/clients");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /clients/:id - Find By ID
    // ============================================
    describe("GET /clients/:id", () => {
        describe("given client exists", () => {
            it("should return the client", async () => {
                // Arrange
                const client = createClientWithEmployeeInfo(createMockClient({ id: 7, name: "Specific Client" }));
                clientService.findById.mockResolvedValue(client);

                // Act
                const response = await request(app.getHttpServer()).get("/clients/7");

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.findById).toHaveBeenCalledWith(7);
            });
        });

        describe("given client does not exist", () => {
            it("should return null from service", async () => {
                // Arrange
                clientService.findById.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer()).get("/clients/999");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual({});
                expect(clientService.findById).toHaveBeenCalledWith(999);
            });
        });
    });

    // ============================================
    // PATCH /clients/:id - Update
    // ============================================
    describe("PATCH /clients/:id", () => {
        describe("given valid update data", () => {
            it("should update the client", async () => {
                // Arrange
                const updateDto = {
                    name: "Updated Name",
                    address: "Busan",
                };
                const updatedClient = createMockClient({ id: 3, ...updateDto });
                clientService.update.mockResolvedValue(updatedClient);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/clients/3")
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.update).toHaveBeenCalledWith(
                    3,
                    expect.objectContaining({
                        name: "Updated Name",
                        address: "Busan",
                    }),
                );
            });
        });

        describe("given partial update", () => {
            it("should only update provided fields", async () => {
                // Arrange
                const partialDto = { phone: "010-0000-0000" };
                const updatedClient = createMockClient({ id: 4, phone: "010-0000-0000" });
                clientService.update.mockResolvedValue(updatedClient);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/clients/4")
                    .send(partialDto);

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.update).toHaveBeenCalledWith(
                    4,
                    expect.objectContaining({
                        phone: "010-0000-0000",
                    }),
                );
            });
        });
    });

    // ============================================
    // DELETE /clients/:id - Delete
    // ============================================
    describe("DELETE /clients/:id", () => {
        describe("given valid client id", () => {
            it("should delete the client", async () => {
                // Arrange
                clientService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer()).delete("/clients/8");

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.delete).toHaveBeenCalledWith(8);
            });
        });

        describe("given different client ids", () => {
            it.each([1, 10, 100, 999])("should delete client with id %i", async (id) => {
                // Arrange
                clientService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer()).delete(`/clients/${id}`);

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.delete).toHaveBeenCalledWith(id);
            });
        });
    });
});
