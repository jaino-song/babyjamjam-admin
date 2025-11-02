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
exports.SbBankAccountInfoRepository = void 0;
const prisma_service_1 = require("../prisma.service");
const common_1 = require("@nestjs/common");
const bank_account_info_mapper_1 = require("../mapper/bank-account-info.mapper");
let SbBankAccountInfoRepository = class SbBankAccountInfoRepository {
    constructor(prismaService) {
        this.prismaService = prismaService;
    }
    async findByArea(area) {
        const bankAccountInfo = await this.prismaService.bankAccountInfo.findUnique({
            where: { area },
        });
        return bankAccountInfo ? bank_account_info_mapper_1.BankAccountInfoMapper.toDomain(bankAccountInfo) : null;
    }
    async create(bankAccountInfo) {
        const created = await this.prismaService.bankAccountInfo.create({
            data: bank_account_info_mapper_1.BankAccountInfoMapper.toPrismaCreate(bankAccountInfo),
        });
        return bank_account_info_mapper_1.BankAccountInfoMapper.toDomain(created);
    }
    async update(bankAccountInfo) {
        const updated = await this.prismaService.bankAccountInfo.update({
            where: { area: bankAccountInfo.area },
            data: bank_account_info_mapper_1.BankAccountInfoMapper.toPrismaUpdate(bankAccountInfo),
        });
        return bank_account_info_mapper_1.BankAccountInfoMapper.toDomain(updated);
    }
    async delete(area) {
        await this.prismaService.bankAccountInfo.delete({
            where: { area },
        });
    }
};
exports.SbBankAccountInfoRepository = SbBankAccountInfoRepository;
exports.SbBankAccountInfoRepository = SbBankAccountInfoRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SbBankAccountInfoRepository);
//# sourceMappingURL=sb.bank-account-info.repository.js.map