"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SbVoucherPriceInfoRepository = void 0;
const prisma_service_1 = require("../prisma.service");
const common_1 = require("@nestjs/common");
const voucher_price_info_mapper_1 = require("../mapper/voucher-price-info.mapper");
let SbVoucherPriceInfoRepository = class SbVoucherPriceInfoRepository {
    constructor(prismaService) {
        this.prismaService = prismaService;
    }
    async findById(id) {
        const voucherPriceInfo = await this.prismaService.voucherPriceInfo.findUnique({
            where: { id },
        });
        return voucherPriceInfo ? voucher_price_info_mapper_1.VoucherPriceInfoMapper.toDomain(voucherPriceInfo) : null;
    }
    async findByType(type) {
        const voucherPriceInfo = await this.prismaService.voucherPriceInfo.findFirst({
            where: { type: type },
        });
        return voucherPriceInfo ? voucher_price_info_mapper_1.VoucherPriceInfoMapper.toDomain(voucherPriceInfo) : null;
    }
    async create(voucherPriceInfo) {
        const created = await this.prismaService.voucherPriceInfo.create({
            data: voucher_price_info_mapper_1.VoucherPriceInfoMapper.toPrismaCreate(voucherPriceInfo),
        });
        return voucher_price_info_mapper_1.VoucherPriceInfoMapper.toDomain(created);
    }
    async update(voucherPriceInfo) {
        const updated = await this.prismaService.voucherPriceInfo.update({
            where: { id: voucherPriceInfo.id },
            data: voucher_price_info_mapper_1.VoucherPriceInfoMapper.toPrismaUpdate(voucherPriceInfo),
        });
        return voucher_price_info_mapper_1.VoucherPriceInfoMapper.toDomain(updated);
    }
    async delete(id) {
        await this.prismaService.voucherPriceInfo.delete({
            where: { id },
        });
    }
    async findAll() {
        const voucherPriceInfos = await this.prismaService.voucherPriceInfo.findMany();
        return voucherPriceInfos.map(row => voucher_price_info_mapper_1.VoucherPriceInfoMapper.toDomain(row));
    }
};
exports.SbVoucherPriceInfoRepository = SbVoucherPriceInfoRepository;
exports.SbVoucherPriceInfoRepository = SbVoucherPriceInfoRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SbVoucherPriceInfoRepository);
//# sourceMappingURL=sb.voucher-price-info.repository.js.map