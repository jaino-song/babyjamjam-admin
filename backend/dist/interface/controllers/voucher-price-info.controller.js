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
exports.VoucherPriceInfoController = void 0;
const common_1 = require("@nestjs/common");
const voucher_price_info_service_1 = require("../../application/services/voucher-price-info.service");
const voucher_price_info_dto_1 = require("../dto/voucher-price-info.dto");
let VoucherPriceInfoController = class VoucherPriceInfoController {
    constructor(voucherService) {
        this.voucherService = voucherService;
    }
    create(dto) {
        return this.voucherService.create({
            type: dto.type,
            duration: BigInt(dto.duration),
            fullPrice: dto.fullPrice,
            grant: dto.grant,
            actualPrice: dto.actualPrice,
        });
    }
    list() {
        return this.voucherService.list();
    }
    findByType(type) {
        return this.voucherService.findByType(type);
    }
    findById(id) {
        return this.voucherService.findById(Number(id));
    }
    update(id, dto) {
        return this.voucherService.update(Number(id), {
            type: dto.type ?? undefined,
            duration: dto.duration !== undefined ? BigInt(dto.duration) : undefined,
            fullPrice: dto.fullPrice ?? undefined,
            grant: dto.grant ?? undefined,
            actualPrice: dto.actualPrice ?? undefined,
        });
    }
    delete(id) {
        return this.voucherService.delete(Number(id));
    }
};
exports.VoucherPriceInfoController = VoucherPriceInfoController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [voucher_price_info_dto_1.CreateVoucherPriceInfoDto]),
    __metadata("design:returntype", void 0)
], VoucherPriceInfoController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], VoucherPriceInfoController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("type"),
    __param(0, (0, common_1.Query)("type")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VoucherPriceInfoController.prototype, "findByType", null);
__decorate([
    (0, common_1.Get)("id"),
    __param(0, (0, common_1.Query)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VoucherPriceInfoController.prototype, "findById", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, common_1.Query)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, voucher_price_info_dto_1.UpdateVoucherPriceInfoDto]),
    __metadata("design:returntype", void 0)
], VoucherPriceInfoController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(),
    __param(0, (0, common_1.Query)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VoucherPriceInfoController.prototype, "delete", null);
exports.VoucherPriceInfoController = VoucherPriceInfoController = __decorate([
    (0, common_1.Controller)("voucher-price-infos"),
    __metadata("design:paramtypes", [voucher_price_info_service_1.VoucherPriceInfoService])
], VoucherPriceInfoController);
//# sourceMappingURL=voucher-price-info.controller.js.map