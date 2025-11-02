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
exports.VoucherPriceInfoService = void 0;
const common_1 = require("@nestjs/common");
const voucher_price_info_1 = require("../usecases/voucher-price-info");
let VoucherPriceInfoService = class VoucherPriceInfoService {
    constructor(createVoucherPriceInfoUsecase, findVoucherPriceInfoByIdUsecase, findVoucherPriceInfoByTypeUsecase, listVoucherPriceInfoUsecase, updateVoucherPriceInfoUsecase, deleteVoucherPriceInfoUsecase) {
        this.createVoucherPriceInfoUsecase = createVoucherPriceInfoUsecase;
        this.findVoucherPriceInfoByIdUsecase = findVoucherPriceInfoByIdUsecase;
        this.findVoucherPriceInfoByTypeUsecase = findVoucherPriceInfoByTypeUsecase;
        this.listVoucherPriceInfoUsecase = listVoucherPriceInfoUsecase;
        this.updateVoucherPriceInfoUsecase = updateVoucherPriceInfoUsecase;
        this.deleteVoucherPriceInfoUsecase = deleteVoucherPriceInfoUsecase;
    }
    create(params) {
        return this.createVoucherPriceInfoUsecase.execute(params.type, params.duration, params.fullPrice, params.grant, params.actualPrice);
    }
    findById(id) {
        return this.findVoucherPriceInfoByIdUsecase.execute(id);
    }
    findByType(type) {
        return this.findVoucherPriceInfoByTypeUsecase.execute(type);
    }
    list() {
        return this.listVoucherPriceInfoUsecase.execute();
    }
    update(id, params) {
        return this.updateVoucherPriceInfoUsecase.execute(id, params);
    }
    delete(id) {
        return this.deleteVoucherPriceInfoUsecase.execute(id);
    }
};
exports.VoucherPriceInfoService = VoucherPriceInfoService;
exports.VoucherPriceInfoService = VoucherPriceInfoService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [voucher_price_info_1.CreateVoucherPriceInfoUsecase,
        voucher_price_info_1.FindVoucherPriceInfoByIdUsecase,
        voucher_price_info_1.FindVoucherPriceInfoByTypeUsecase,
        voucher_price_info_1.ListVoucherPriceInfoUsecase,
        voucher_price_info_1.UpdateVoucherPriceInfoUsecase,
        voucher_price_info_1.DeleteVoucherPriceInfoUsecase])
], VoucherPriceInfoService);
//# sourceMappingURL=voucher-price-info.service.js.map