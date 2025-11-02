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
exports.UpdateVoucherPriceInfoUsecase = void 0;
const common_1 = require("@nestjs/common");
const voucher_price_info_repository_interface_1 = require("../../../domain/repositories/voucher-price-info.repository.interface");
let UpdateVoucherPriceInfoUsecase = class UpdateVoucherPriceInfoUsecase {
    constructor(voucherPriceInfoRepository) {
        this.voucherPriceInfoRepository = voucherPriceInfoRepository;
    }
    async execute(id, updates) {
        const voucherPriceInfo = await this.voucherPriceInfoRepository.findById(id);
        if (!voucherPriceInfo) {
            throw new common_1.NotFoundException(`Voucher price info with id ${id} not found`);
        }
        if (updates.type !== undefined) {
            voucherPriceInfo.type = updates.type;
        }
        if (updates.duration !== undefined) {
            voucherPriceInfo.duration = updates.duration;
        }
        if (updates.fullPrice !== undefined) {
            voucherPriceInfo.fullPrice = updates.fullPrice;
        }
        if (updates.grant !== undefined) {
            voucherPriceInfo.grant = updates.grant;
        }
        if (updates.actualPrice !== undefined) {
            voucherPriceInfo.actualPrice = updates.actualPrice;
        }
        return this.voucherPriceInfoRepository.update(voucherPriceInfo);
    }
};
exports.UpdateVoucherPriceInfoUsecase = UpdateVoucherPriceInfoUsecase;
exports.UpdateVoucherPriceInfoUsecase = UpdateVoucherPriceInfoUsecase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(voucher_price_info_repository_interface_1.VOUCHER_PRICE_INFO_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], UpdateVoucherPriceInfoUsecase);
//# sourceMappingURL=update-voucher-price-info.usecase.js.map