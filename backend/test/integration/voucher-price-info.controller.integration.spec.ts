import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { VoucherPriceInfoController } from "interface/controllers/voucher-price-info.controller";
import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";

describe("VoucherPriceInfoController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let voucherService: jest.Mocked<VoucherPriceInfoService>;

    type VoucherPriceInfoOverrides = Partial<{
        id: number;
        type: string | null;
        duration: number | null;  // Use number for JSON serialization compatibility
        fullPrice: string | null;
        grant: string | null;
        actualPrice: string | null;
        year: number;
    }>;

    // Mock object that can be JSON serialized (avoiding BigInt serialization issues)
    const createMockVoucherPriceInfoResponse = (overrides: VoucherPriceInfoOverrides = {}) => ({
        id: overrides.id ?? 1,
        type: overrides.type ?? "standard",
        duration: overrides.duration ?? 30,  // Number instead of BigInt for JSON
        fullPrice: overrides.fullPrice ?? "1000000",
        grant: overrides.grant ?? "500000",
        actualPrice: overrides.actualPrice ?? "500000",
        year: overrides.year ?? 2025,
    });

    beforeEach(async () => {
        const mockVoucherService = {
            create: jest.fn(),
            list: jest.fn(),
            findByType: jest.fn(),
            findById: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            parseImage: jest.fn(),
            bulkUpdate: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [VoucherPriceInfoController],
            providers: [
                {
                    provide: VoucherPriceInfoService,
                    useValue: mockVoucherService,
                },
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        voucherService = moduleFixture.get(VoucherPriceInfoService);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // POST /voucher-price-infos - Create
    // ============================================
    describe("POST /voucher-price-infos", () => {
        describe("given valid voucher price info data", () => {
            it("should create a new voucher price info and return 201", async () => {
                // Arrange
                const createDto = {
                    type: "premium",
                    duration: "60",  // DTO expects string (IsNumberString)
                    fullPrice: "2000000",
                    grant: "1000000",
                    actualPrice: "1000000",
                    year: 2025,
                };
                const createdInfo = createMockVoucherPriceInfoResponse({
                    id: 5,
                    type: "premium",
                    duration: 60,
                    fullPrice: "2000000",
                    grant: "1000000",
                    actualPrice: "1000000",
                    year: 2025,
                });
                voucherService.create.mockResolvedValue(createdInfo as any);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/voucher-price-infos")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(voucherService.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: "premium",
                        duration: BigInt(60),
                        fullPrice: "2000000",
                        year: 2025,
                    }),
                );
            });
        });

        describe("given different duration values", () => {
            it.each([15, 30, 45, 60, 90])("should create voucher with duration %i days", async (duration) => {
                // Arrange
                const createDto = {
                    type: "standard",
                    duration: String(duration),  // DTO expects string (IsNumberString)
                    fullPrice: "1000000",
                    grant: "500000",
                    actualPrice: "500000",
                    year: 2025,
                };
                const createdInfo = createMockVoucherPriceInfoResponse({
                    id: 10,
                    duration: duration,
                });
                voucherService.create.mockResolvedValue(createdInfo as any);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/voucher-price-infos")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(voucherService.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        duration: BigInt(duration),
                    }),
                );
            });
        });
    });

    // ============================================
    // GET /voucher-price-infos - List All
    // ============================================
    describe("GET /voucher-price-infos", () => {
        describe("given voucher price infos exist", () => {
            it("should return all voucher price infos", async () => {
                // Arrange
                const infos = [
                    createMockVoucherPriceInfoResponse({ id: 1, type: "standard" }),
                    createMockVoucherPriceInfoResponse({ id: 2, type: "premium" }),
                    createMockVoucherPriceInfoResponse({ id: 3, type: "deluxe" }),
                ];
                voucherService.list.mockResolvedValue(infos as any);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/voucher-price-infos");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(3);
                expect(voucherService.list).toHaveBeenCalled();
            });
        });

        describe("given no voucher price infos exist", () => {
            it("should return empty array", async () => {
                // Arrange
                voucherService.list.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/voucher-price-infos");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /voucher-price-infos/type - Find By Type
    // ============================================
    describe("GET /voucher-price-infos/type", () => {
        describe("given voucher price infos exist for type", () => {
            it("should return voucher price infos by type", async () => {
                // Arrange
                const infos = [
                    createMockVoucherPriceInfoResponse({ id: 1, type: "standard", duration: 30 }),
                    createMockVoucherPriceInfoResponse({ id: 2, type: "standard", duration: 60 }),
                ];
                voucherService.findByType.mockResolvedValue(infos as any);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/voucher-price-infos/type")
                    .query({ type: "standard" });

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(2);
                expect(voucherService.findByType).toHaveBeenCalledWith("standard", undefined);
            });
        });

        describe("given type and year query", () => {
            it("should filter by type and year", async () => {
                // Arrange
                const infos = [
                    createMockVoucherPriceInfoResponse({ id: 1, type: "premium", year: 2025 }),
                ];
                voucherService.findByType.mockResolvedValue(infos as any);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/voucher-price-infos/type")
                    .query({ type: "premium", year: "2025" });

                // Assert
                expect(response.status).toBe(200);
                expect(voucherService.findByType).toHaveBeenCalledWith("premium", 2025);
            });
        });

        describe("given no voucher price infos exist for type", () => {
            it("should return empty array", async () => {
                // Arrange
                voucherService.findByType.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/voucher-price-infos/type")
                    .query({ type: "nonexistent" });

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /voucher-price-infos/id - Find By ID
    // ============================================
    describe("GET /voucher-price-infos/id", () => {
        describe("given voucher price info exists", () => {
            it("should return the voucher price info", async () => {
                // Arrange
                const info = createMockVoucherPriceInfoResponse({
                    id: 7,
                    type: "deluxe",
                    fullPrice: "3000000",
                });
                voucherService.findById.mockResolvedValue(info as any);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/voucher-price-infos/id")
                    .query({ id: "7" });

                // Assert
                expect(response.status).toBe(200);
                expect(voucherService.findById).toHaveBeenCalledWith(7);
            });
        });

        describe("given voucher price info does not exist", () => {
            it("should return null from service", async () => {
                // Arrange
                voucherService.findById.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/voucher-price-infos/id")
                    .query({ id: "999" });

                // Assert
                expect(response.status).toBe(200);
                expect(voucherService.findById).toHaveBeenCalledWith(999);
            });
        });
    });

    // ============================================
    // PATCH /voucher-price-infos - Update
    // ============================================
    describe("PATCH /voucher-price-infos", () => {
        describe("given valid update data", () => {
            it("should update the voucher price info", async () => {
                // Arrange
                const updateDto = {
                    type: "premium",
                    fullPrice: "2500000",
                    grant: "1250000",
                    actualPrice: "1250000",
                };
                const updatedInfo = createMockVoucherPriceInfoResponse({
                    id: 3,
                    type: "premium",
                    fullPrice: "2500000",
                });
                voucherService.update.mockResolvedValue(updatedInfo as any);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/voucher-price-infos")
                    .query({ id: "3" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(voucherService.update).toHaveBeenCalledWith(
                    3,
                    expect.objectContaining({
                        type: "premium",
                        fullPrice: "2500000",
                    }),
                );
            });
        });

        describe("given duration update", () => {
            it("should convert duration to bigint", async () => {
                // Arrange
                const updateDto = { duration: "45" };  // DTO expects string (IsNumberString)
                const updatedInfo = createMockVoucherPriceInfoResponse({
                    id: 4,
                    duration: 45,
                });
                voucherService.update.mockResolvedValue(updatedInfo as any);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/voucher-price-infos")
                    .query({ id: "4" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(voucherService.update).toHaveBeenCalledWith(
                    4,
                    expect.objectContaining({
                        duration: BigInt(45),
                    }),
                );
            });
        });

        describe("given year update", () => {
            it("should update year", async () => {
                // Arrange
                const updateDto = { year: 2026 };
                const updatedInfo = createMockVoucherPriceInfoResponse({
                    id: 5,
                    year: 2026,
                });
                voucherService.update.mockResolvedValue(updatedInfo as any);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/voucher-price-infos")
                    .query({ id: "5" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(voucherService.update).toHaveBeenCalledWith(
                    5,
                    expect.objectContaining({ year: 2026 }),
                );
            });
        });
    });

    // ============================================
    // DELETE /voucher-price-infos - Delete
    // ============================================
    describe("DELETE /voucher-price-infos", () => {
        describe("given valid voucher price info id", () => {
            it("should delete the voucher price info", async () => {
                // Arrange
                voucherService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/voucher-price-infos")
                    .query({ id: "8" });

                // Assert
                expect(response.status).toBe(200);
                expect(voucherService.delete).toHaveBeenCalledWith(8);
            });
        });

        describe("given different voucher price info ids", () => {
            it.each([1, 10, 100, 999])("should delete voucher price info with id %i", async (id) => {
                // Arrange
                voucherService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/voucher-price-infos")
                    .query({ id: String(id) });

                // Assert
                expect(response.status).toBe(200);
                expect(voucherService.delete).toHaveBeenCalledWith(id);
            });
        });
    });

    // ============================================
    // POST /voucher-price-infos/bulk-update - Bulk Update
    // ============================================
    describe("POST /voucher-price-infos/bulk-update", () => {
        describe("given valid bulk update data", () => {
            it("should bulk update voucher price infos", async () => {
                // Arrange
                const bulkUpdateDto = {
                    items: [
                        { type: "standard", duration: 30, fullPrice: "1000000", grant: "500000", actualPrice: "500000" },
                        { type: "premium", duration: 60, fullPrice: "2000000", grant: "1000000", actualPrice: "1000000" },
                    ],
                    year: 2025,
                };
                const bulkUpdateResult = {
                    created: [1, 2],
                    updated: [],
                    errors: [],
                };
                voucherService.bulkUpdate.mockResolvedValue(bulkUpdateResult);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/voucher-price-infos/bulk-update")
                    .send(bulkUpdateDto);

                // Assert
                expect(response.status).toBe(201);
                expect(voucherService.bulkUpdate).toHaveBeenCalledWith(
                    bulkUpdateDto.items,
                    bulkUpdateDto.year,
                );
            });
        });

        describe("given empty items array", () => {
            it("should handle empty bulk update", async () => {
                // Arrange
                const bulkUpdateDto = {
                    items: [],
                    year: 2025,
                };
                const bulkUpdateResult = {
                    created: [],
                    updated: [],
                    errors: [],
                };
                voucherService.bulkUpdate.mockResolvedValue(bulkUpdateResult);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/voucher-price-infos/bulk-update")
                    .send(bulkUpdateDto);

                // Assert
                expect(response.status).toBe(201);
                expect(voucherService.bulkUpdate).toHaveBeenCalledWith([], 2025);
            });
        });
    });

    // ============================================
    // POST /voucher-price-infos/parse-image - Parse Image
    // (Note: File upload testing requires special handling)
    // ============================================
    describe("POST /voucher-price-infos/parse-image", () => {
        describe("given valid image file", () => {
            it("should parse the image and return result", async () => {
                // Arrange
                const parseResult = {
                    parsedData: [
                        { type: "standard", duration: 30, fullPrice: "1000000", grant: "500000", actualPrice: "500000" },
                    ],
                    hasValidationWarnings: false,
                    warnings: [],
                };
                voucherService.parseImage.mockResolvedValue(parseResult);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/voucher-price-infos/parse-image")
                    .attach("image", Buffer.from("fake-image-data"), "test.png");

                // Assert
                expect(response.status).toBe(201);
                expect(voucherService.parseImage).toHaveBeenCalled();
            });
        });
    });
});
