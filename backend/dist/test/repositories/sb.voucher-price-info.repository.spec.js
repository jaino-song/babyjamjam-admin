"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sb_voucher_price_info_repository_1 = require("../../infrastructure/database/repositories/sb.voucher-price-info.repository");
const voucher_price_info_entity_1 = require("../../domain/entities/voucher-price-info.entity");
describe("SbVoucherPriceInfoRepository", () => {
    const voucherModel = {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };
    const prisma = { voucherPriceInfo: voucherModel };
    const repository = new sb_voucher_price_info_repository_1.SbVoucherPriceInfoRepository(prisma);
    const sampleRow = {
        id: 10,
        type: "standard",
        duration: BigInt(30),
        fullPrice: "100000",
        grant: "50000",
        actualPrice: "50000",
    };
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it("returns a voucher price info when findById finds a match", async () => {
        voucherModel.findUnique.mockResolvedValue(sampleRow);
        const result = await repository.findById(10);
        expect(voucherModel.findUnique).toHaveBeenCalledWith({ where: { id: 10 } });
        expect(result).toBeInstanceOf(voucher_price_info_entity_1.VoucherPriceInfoEntity);
        expect(result).toMatchObject(sampleRow);
    });
    it("returns null when findById does not find a record", async () => {
        voucherModel.findUnique.mockResolvedValue(null);
        const result = await repository.findById(999);
        expect(voucherModel.findUnique).toHaveBeenCalledWith({ where: { id: 999 } });
        expect(result).toBeNull();
    });
    it("returns voucher price infos when findByType finds matches", async () => {
        voucherModel.findMany.mockResolvedValue([sampleRow, { ...sampleRow, id: 11 }]);
        const result = await repository.findByType("standard");
        expect(voucherModel.findMany).toHaveBeenCalledWith({ where: { type: "standard" } });
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ id: 10, type: "standard" });
    });
    it("returns empty array when findByType finds nothing", async () => {
        voucherModel.findMany.mockResolvedValue([]);
        const result = await repository.findByType("missing");
        expect(voucherModel.findMany).toHaveBeenCalledWith({ where: { type: "missing" } });
        expect(result).toHaveLength(0);
    });
    it("creates a voucher price info using Prisma", async () => {
        const entity = voucher_price_info_entity_1.VoucherPriceInfoEntity.create("premium", BigInt(60), "200000", "100000", "100000");
        const createdRow = {
            id: 11,
            type: entity.type,
            duration: entity.duration,
            fullPrice: entity.fullPrice,
            grant: entity.grant,
            actualPrice: entity.actualPrice,
        };
        voucherModel.create.mockResolvedValue(createdRow);
        const result = await repository.create(entity);
        expect(voucherModel.create).toHaveBeenCalledWith({
            data: {
                id: 0,
                type: "premium",
                duration: BigInt(60),
                fullPrice: "200000",
                grant: "100000",
                actualPrice: "100000",
            },
        });
        expect(result).toMatchObject({ id: 11, type: "premium" });
    });
    it("updates a voucher price info using Prisma", async () => {
        const entity = new voucher_price_info_entity_1.VoucherPriceInfoEntity(15, "standard", BigInt(30), "100000", "50000", "50000");
        entity.type = "vip";
        entity.duration = BigInt(90);
        entity.fullPrice = "300000";
        entity.grant = "150000";
        entity.actualPrice = "150000";
        const updatedRow = {
            id: 15,
            type: entity.type,
            duration: entity.duration,
            fullPrice: entity.fullPrice,
            grant: entity.grant,
            actualPrice: entity.actualPrice,
        };
        voucherModel.update.mockResolvedValue(updatedRow);
        const result = await repository.update(entity);
        expect(voucherModel.update).toHaveBeenCalledWith({
            where: { id: 15 },
            data: {
                type: "vip",
                duration: BigInt(90),
                fullPrice: "300000",
                grant: "150000",
                actualPrice: "150000",
            },
        });
        expect(result).toMatchObject({ id: 15, type: "vip" });
    });
    it("deletes a voucher price info by id", async () => {
        voucherModel.delete.mockResolvedValue(undefined);
        await repository.delete(25);
        expect(voucherModel.delete).toHaveBeenCalledWith({ where: { id: 25 } });
    });
    it("returns all voucher price info records", async () => {
        const rows = [sampleRow, { ...sampleRow, id: 11, type: "premium" }];
        voucherModel.findMany.mockResolvedValue(rows);
        const result = await repository.findAll();
        expect(voucherModel.findMany).toHaveBeenCalledWith();
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ id: 10 });
    });
});
//# sourceMappingURL=sb.voucher-price-info.repository.spec.js.map