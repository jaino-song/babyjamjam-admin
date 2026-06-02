import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { BankAccountInfoController } from "interface/controllers/bank-account-info.controller";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";

describe("BankAccountInfoController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let bankAccountInfoService: jest.Mocked<BankAccountInfoService>;

    type BankAccountInfoOverrides = Partial<{
        area: string;
        bankName: string | null;
        accNum: string | null;
    }>;

    const createMockBankAccountInfo = (overrides: BankAccountInfoOverrides = {}): BankAccountInfoEntity => {
        return new BankAccountInfoEntity(
            overrides.area ?? "Seoul",
            overrides.bankName ?? "신한은행",
            overrides.accNum ?? "110-123-456789",
        );
    };

    beforeEach(async () => {
        const mockBankAccountInfoService = {
            create: jest.fn(),
            findAll: jest.fn(),
            findByArea: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [BankAccountInfoController],
            providers: [
                {
                    provide: BankAccountInfoService,
                    useValue: mockBankAccountInfoService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue({
                canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
                    const request = context.switchToHttp().getRequest();
                    request.user = { userId: "owner-user-id", role: "owner" };
                    return true;
                },
            })
            .overrideGuard(OwnerOrAdminGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        bankAccountInfoService = moduleFixture.get(BankAccountInfoService);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // POST /bank-account-infos - Create
    // ============================================
    describe("POST /bank-account-infos", () => {
        describe("given valid bank account info data", () => {
            it("should create a new bank account info and return 201", async () => {
                // Arrange
                const createDto = {
                    area: "Incheon",
                    bankName: "국민은행",
                    accNum: "123-456-789012",
                };
                const createdInfo = createMockBankAccountInfo(createDto);
                bankAccountInfoService.create.mockResolvedValue(createdInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/bank-account-infos")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(bankAccountInfoService.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        area: "Incheon",
                        bankName: "국민은행",
                        accNum: "123-456-789012",
                    }),
                );
            });
        });

        describe("given different bank names", () => {
            it.each([
                "신한은행",
                "국민은행",
                "우리은행",
                "하나은행",
                "농협",
            ])("should create bank account info with bank %s", async (bankName) => {
                // Arrange
                const createDto = {
                    area: "TestArea",
                    bankName,
                    accNum: "111-222-333444",
                };
                const createdInfo = createMockBankAccountInfo(createDto);
                bankAccountInfoService.create.mockResolvedValue(createdInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/bank-account-infos")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(bankAccountInfoService.create).toHaveBeenCalledWith(
                    expect.objectContaining({ bankName }),
                );
            });
        });
    });

    // ============================================
    // GET /bank-account-infos - List All
    // ============================================
    describe("GET /bank-account-infos", () => {
        describe("given bank account infos exist", () => {
            it("should return all bank account infos", async () => {
                // Arrange
                const infos = [
                    createMockBankAccountInfo({ area: "Seoul" }),
                    createMockBankAccountInfo({ area: "Busan" }),
                    createMockBankAccountInfo({ area: "Incheon" }),
                ];
                bankAccountInfoService.findAll.mockResolvedValue(infos);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(3);
                expect(bankAccountInfoService.findAll).toHaveBeenCalled();
            });
        });

        describe("given no bank account infos exist", () => {
            it("should return empty array", async () => {
                // Arrange
                bankAccountInfoService.findAll.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /bank-account-infos/area - Find By Area
    // ============================================
    describe("GET /bank-account-infos/area", () => {
        describe("given bank account info exists for area", () => {
            it("should return the bank account info", async () => {
                // Arrange
                const info = createMockBankAccountInfo({
                    area: "Daegu",
                    bankName: "대구은행",
                    accNum: "999-888-777666",
                });
                bankAccountInfoService.findByArea.mockResolvedValue(info);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos/area")
                    .query({ area: "Daegu" });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.findByArea).toHaveBeenCalledWith("Daegu");
            });
        });

        describe("given bank account info does not exist for area", () => {
            it("should return null from service", async () => {
                // Arrange
                bankAccountInfoService.findByArea.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos/area")
                    .query({ area: "NonexistentArea" });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.findByArea).toHaveBeenCalledWith("NonexistentArea");
            });
        });

        describe("given different area names", () => {
            it.each([
                "Seoul",
                "Busan",
                "Incheon",
                "Daegu",
                "Gwangju",
            ])("should find bank account info for area %s", async (area) => {
                // Arrange
                const info = createMockBankAccountInfo({ area });
                bankAccountInfoService.findByArea.mockResolvedValue(info);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos/area")
                    .query({ area });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.findByArea).toHaveBeenCalledWith(area);
            });
        });
    });

    // ============================================
    // PATCH /bank-account-infos - Update
    // ============================================
    describe("PATCH /bank-account-infos", () => {
        describe("given valid update data", () => {
            it("should update the bank account info", async () => {
                // Arrange
                const updateDto = {
                    bankName: "우리은행",
                    accNum: "111-222-333444",
                };
                const updatedInfo = createMockBankAccountInfo({
                    area: "Seoul",
                    ...updateDto,
                });
                bankAccountInfoService.update.mockResolvedValue(updatedInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/bank-account-infos")
                    .query({ area: "Seoul" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.update).toHaveBeenCalledWith(
                    "Seoul",
                    expect.objectContaining({
                        bankName: "우리은행",
                        accNum: "111-222-333444",
                    }),
                );
            });
        });

        describe("given partial update (only bankName)", () => {
            it("should only update bankName", async () => {
                // Arrange
                const partialDto = { bankName: "하나은행" };
                const updatedInfo = createMockBankAccountInfo({
                    area: "Busan",
                    bankName: "하나은행",
                });
                bankAccountInfoService.update.mockResolvedValue(updatedInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/bank-account-infos")
                    .query({ area: "Busan" })
                    .send(partialDto);

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.update).toHaveBeenCalledWith(
                    "Busan",
                    expect.objectContaining({ bankName: "하나은행" }),
                );
            });
        });

        describe("given partial update (only accNum)", () => {
            it("should only update accNum", async () => {
                // Arrange
                const partialDto = { accNum: "000-000-000000" };
                const updatedInfo = createMockBankAccountInfo({
                    area: "Incheon",
                    accNum: "000-000-000000",
                });
                bankAccountInfoService.update.mockResolvedValue(updatedInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/bank-account-infos")
                    .query({ area: "Incheon" })
                    .send(partialDto);

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.update).toHaveBeenCalledWith(
                    "Incheon",
                    expect.objectContaining({ accNum: "000-000-000000" }),
                );
            });
        });
    });

    // ============================================
    // DELETE /bank-account-infos - Delete
    // ============================================
    describe("DELETE /bank-account-infos", () => {
        describe("given valid area", () => {
            it("should delete the bank account info", async () => {
                // Arrange
                bankAccountInfoService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/bank-account-infos")
                    .query({ area: "Seoul" });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.delete).toHaveBeenCalledWith("Seoul");
            });
        });

        describe("given different areas", () => {
            it.each([
                "Seoul",
                "Busan",
                "Incheon",
                "Daegu",
                "TestArea",
            ])("should delete bank account info for area %s", async (area) => {
                // Arrange
                bankAccountInfoService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/bank-account-infos")
                    .query({ area });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.delete).toHaveBeenCalledWith(area);
            });
        });
    });
});
