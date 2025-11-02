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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateVoucherPriceInfoUsecase = void 0;
const common_1 = require("@nestjs/common");
const voucher_price_info_entity_1 = require("../../../domain/entities/voucher-price-info.entity");
const voucher_price_info_repository_interface_1 = require("../../../domain/repositories/voucher-price-info.repository.interface");
let CreateVoucherPriceInfoUsecase = class CreateVoucherPriceInfoUsecase {
    constructor(voucherPriceInfoRepository) {
        this.voucherPriceInfoRepository = voucherPriceInfoRepository;
    }
    execute(type, duration, fullPrice, grant, actualPrice) {
        const voucherPriceInfo = voucher_price_info_entity_1.VoucherPriceInfoEntity.create(type, duration, fullPrice, grant, actualPrice);
        return this.voucherPriceInfoRepository.create(voucherPriceInfo);
    }
};
exports.CreateVoucherPriceInfoUsecase = CreateVoucherPriceInfoUsecase;
exports.CreateVoucherPriceInfoUsecase = CreateVoucherPriceInfoUsecase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(voucher_price_info_repository_interface_1.VOUCHER_PRICE_INFO_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], CreateVoucherPriceInfoUsecase);
//# sourceMappingURL=create-voucher-price-info.usecase.js.map