import { SbVoucherPriceInfoRepository } from "infrastructure/database/repositories/sb.voucher-price-info.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";

describe("SbVoucherPriceInfoRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockPrismaVoucher = () => ({
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    });

    const createVoucherRow = (overrides = {}) => ({
        id: 10,
        type: "standard",
        duration: BigInt(30),
        full_price: "100000",
        grant: "50000",
        actual_price: "50000",
        year: 2025,
        ...overrides,
    });

    let voucherModel: ReturnType<typeof createMockPrismaVoucher>;
    let prisma: PrismaService;
    let repository: SbVoucherPriceInfoRepository;

    beforeEach(() => {
        voucherModel = createMockPrismaVoucher();
        prisma = { voucher_price_info: voucherModel } as unknown as PrismaService;
        repository = new SbVoucherPriceInfoRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        describe("given a voucher price info exists with the specified id", () => {
            it("should return the mapped VoucherPriceInfoEntity", async () => {
                // Arrange
                const row = createVoucherRow();
                voucherModel.findUnique.mockResolvedValue(row);

                // Act
                const result = await repository.findById(10);

                // Assert
                expect(voucherModel.findUnique).toHaveBeenCalledWith({ where: { id: 10 } });
                expect(result).toBeInstanceOf(VoucherPriceInfoEntity);
                expect(result).toMatchObject({
                    id: 10,
                    type: "standard",
                    duration: BigInt(30),
                    fullPrice: "100000",
                    grant: "50000",
                    actualPrice: "50000",
                });
            });
        });

        describe("given no voucher price info exists with the specified id", () => {
            it("should return null", async () => {
                // Arrange
                voucherModel.findUnique.mockResolvedValue(null);

                // Act
                const result = await repository.findById(999);

                // Assert
                expect(voucherModel.findUnique).toHaveBeenCalledWith({ where: { id: 999 } });
                expect(result).toBeNull();
            });
        });
    });

    // ============================================
    // findByType
    // ============================================
    describe("findByType", () => {
        describe("given voucher price infos exist with the specified type", () => {
            it("should return all matching entities", async () => {
                // Arrange
                const rows = [
                    createVoucherRow({ id: 10 }),
                    createVoucherRow({ id: 11 }),
                ];
                voucherModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findByType("standard");

                // Assert
                expect(voucherModel.findMany).toHaveBeenCalledWith({ where: { type: "standard" } });
                expect(result).toHaveLength(2);
                expect(result[0]).toMatchObject({ id: 10, type: "standard" });
                expect(result[1]).toMatchObject({ id: 11, type: "standard" });
            });
        });

        describe("given no voucher price infos exist with the specified type", () => {
            it("should return empty array", async () => {
                // Arrange
                voucherModel.findMany.mockResolvedValue([]);

                // Act
                const result = await repository.findByType("missing");

                // Assert
                expect(voucherModel.findMany).toHaveBeenCalledWith({ where: { type: "missing" } });
                expect(result).toHaveLength(0);
            });
        });

        describe("given different voucher types", () => {
            it.each(["standard", "premium", "vip", "basic"])(
                "should query with type %s",
                async (type) => {
                    // Arrange
                    voucherModel.findMany.mockResolvedValue([]);

                    // Act
                    await repository.findByType(type);

                    // Assert
                    expect(voucherModel.findMany).toHaveBeenCalledWith({ where: { type } });
                }
            );
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        describe("given voucher price infos exist", () => {
            it("should return all entities", async () => {
                // Arrange
                const rows = [
                    createVoucherRow({ id: 10, type: "standard" }),
                    createVoucherRow({ id: 11, type: "premium" }),
                ];
                voucherModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findAll();

                // Assert
                expect(voucherModel.findMany).toHaveBeenCalledWith();
                expect(result).toHaveLength(2);
                expect(result[0]).toMatchObject({ id: 10 });
                expect(result[1]).toMatchObject({ id: 11, type: "premium" });
            });
        });

        describe("given no voucher price infos exist", () => {
            it("should return empty array", async () => {
                // Arrange
                voucherModel.findMany.mockResolvedValue([]);

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
        describe("given a valid VoucherPriceInfoEntity", () => {
            it("should persist voucher and return created entity", async () => {
                // Arrange
                const entity = VoucherPriceInfoEntity.create("premium", BigInt(60), "200000", "100000", "100000", 2025);
                const createdRow = createVoucherRow({
                    id: 11,
                    type: "premium",
                    duration: BigInt(60),
                    full_price: "200000",
                    grant: "100000",
                    actual_price: "100000",
                    year: 2025,
                });
                voucherModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(entity);

                // Assert
                expect(voucherModel.create).toHaveBeenCalledWith({
                    data: {
                        id: 0,
                        type: "premium",
                        duration: BigInt(60),
                        full_price: "200000",
                        grant: "100000",
                        actual_price: "100000",
                        year: 2025,
                    },
                });
                expect(result).toMatchObject({ id: 11, type: "premium" });
            });
        });

        describe("given different duration values", () => {
            it.each([
                [BigInt(15), "15-day voucher"],
                [BigInt(30), "30-day voucher"],
                [BigInt(60), "60-day voucher"],
                [BigInt(90), "90-day voucher"],
            ])("should create with duration %s (%s)", async (duration) => {
                // Arrange
                const entity = VoucherPriceInfoEntity.create("test", duration, "100", "50", "50", 2025);
                const createdRow = createVoucherRow({ id: 12, duration });
                voucherModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(entity);

                // Assert
                expect(voucherModel.create).toHaveBeenCalledWith({
                    data: expect.objectContaining({ duration }),
                });
                expect(result.duration).toBe(duration);
            });
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given an existing VoucherPriceInfoEntity with changes", () => {
            it("should update voucher with correct data", async () => {
                // Arrange
                const entity = new VoucherPriceInfoEntity(15, "vip", BigInt(90), "300000", "150000", "150000", 2025);
                const updatedRow = createVoucherRow({
                    id: 15,
                    type: "vip",
                    duration: BigInt(90),
                    full_price: "300000",
                    grant: "150000",
                    actual_price: "150000",
                    year: 2025,
                });
                voucherModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(voucherModel.update).toHaveBeenCalledWith({
                    where: { id: 15 },
                    data: {
                        type: "vip",
                        duration: BigInt(90),
                        full_price: "300000",
                        grant: "150000",
                        actual_price: "150000",
                        year: 2025,
                    },
                });
                expect(result).toMatchObject({ id: 15, type: "vip" });
            });
        });

        describe("given only price fields are changed", () => {
            it("should update with new prices", async () => {
                // Arrange
                const entity = new VoucherPriceInfoEntity(16, "standard", BigInt(30), "150000", "75000", "75000", 2025);
                const updatedRow = createVoucherRow({
                    id: 16,
                    full_price: "150000",
                    grant: "75000",
                    actual_price: "75000",
                    year: 2025,
                });
                voucherModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(result.fullPrice).toBe("150000");
                expect(result.grant).toBe("75000");
                expect(result.actualPrice).toBe("75000");
            });
        });

        describe("given type is upgraded from standard to premium", () => {
            it("should correctly update the type", async () => {
                // Arrange
                const entity = new VoucherPriceInfoEntity(17, "premium", BigInt(30), "100000", "50000", "50000", 2025);
                const updatedRow = createVoucherRow({
                    id: 17,
                    type: "premium",
                });
                voucherModel.update.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(entity);

                // Assert
                expect(voucherModel.update).toHaveBeenCalledWith({
                    where: { id: 17 },
                    data: expect.objectContaining({ type: "premium" }),
                });
                expect(result.type).toBe("premium");
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        describe("given a valid voucher id", () => {
            it("should delete the voucher price info", async () => {
                // Arrange
                voucherModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete(25);

                // Assert
                expect(voucherModel.delete).toHaveBeenCalledWith({ where: { id: 25 } });
            });
        });

        describe("given different voucher ids", () => {
            it.each([1, 10, 100, 999])("should delete voucher with id %i", async (id) => {
                // Arrange
                voucherModel.delete.mockResolvedValue(undefined);

                // Act
                await repository.delete(id);

                // Assert
                expect(voucherModel.delete).toHaveBeenCalledWith({ where: { id } });
            });
        });
    });
});
