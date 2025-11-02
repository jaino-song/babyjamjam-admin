"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoucherPriceInfoModule = void 0;
const common_1 = require("@nestjs/common");
const voucher_price_info_1 = require("../application/usecases/voucher-price-info");
const voucher_price_info_service_1 = require("../application/services/voucher-price-info.service");
const voucher_price_info_repository_interface_1 = require("../domain/repositories/voucher-price-info.repository.interface");
const prisma_service_1 = require("../infrastructure/database/prisma.service");
const sb_voucher_price_info_repository_1 = require("../infrastructure/database/repositories/sb.voucher-price-info.repository");
const voucher_price_info_controller_1 = require("../interface/controllers/voucher-price-info.controller");
let VoucherPriceInfoModule = class VoucherPriceInfoModule {
};
exports.VoucherPriceInfoModule = VoucherPriceInfoModule;
exports.VoucherPriceInfoModule = VoucherPriceInfoModule = __decorate([
    (0, common_1.Module)({
        controllers: [voucher_price_info_controller_1.VoucherPriceInfoController],
        providers: [
            voucher_price_info_1.CreateVoucherPriceInfoUsecase,
            voucher_price_info_1.DeleteVoucherPriceInfoUsecase,
            voucher_price_info_1.FindVoucherPriceInfoByIdUsecase,
            voucher_price_info_1.FindVoucherPriceInfoByTypeUsecase,
            voucher_price_info_1.ListVoucherPriceInfoUsecase,
            voucher_price_info_1.UpdateVoucherPriceInfoUsecase,
            voucher_price_info_service_1.VoucherPriceInfoService,
            prisma_service_1.PrismaService,
            {
                provide: voucher_price_info_repository_interface_1.VOUCHER_PRICE_INFO_REPOSITORY,
                useClass: sb_voucher_price_info_repository_1.SbVoucherPriceInfoRepository,
            },
        ],
        exports: [voucher_price_info_service_1.VoucherPriceInfoService],
    })
], VoucherPriceInfoModule);
//# sourceMappingURL=voucher-price-info.module.js.map