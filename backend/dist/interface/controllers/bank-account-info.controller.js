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
exports.BankAccountInfoController = void 0;
const common_1 = require("@nestjs/common");
const bank_account_info_service_1 = require("../../application/services/bank-account-info.service");
const bank_account_info_dto_1 = require("../dto/bank-account-info.dto");
let BankAccountInfoController = class BankAccountInfoController {
    constructor(bankAccountInfoService) {
        this.bankAccountInfoService = bankAccountInfoService;
    }
    create(createBankAccountInfoDto) {
        return this.bankAccountInfoService.create(createBankAccountInfoDto);
    }
    findByArea(area) {
        return this.bankAccountInfoService.findByArea(area);
    }
    update(area, updateBankAccountInfoDto) {
        return this.bankAccountInfoService.update(area, updateBankAccountInfoDto);
    }
    delete(area) {
        return this.bankAccountInfoService.delete(area);
    }
};
exports.BankAccountInfoController = BankAccountInfoController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [bank_account_info_dto_1.CreateBankAccountInfoDto]),
    __metadata("design:returntype", void 0)
], BankAccountInfoController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":area"),
    __param(0, (0, common_1.Param)("area")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BankAccountInfoController.prototype, "findByArea", null);
__decorate([
    (0, common_1.Patch)(":area"),
    __param(0, (0, common_1.Param)("area")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, bank_account_info_dto_1.UpdateBankAccountInfoDto]),
    __metadata("design:returntype", void 0)
], BankAccountInfoController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":area"),
    __param(0, (0, common_1.Param)("area")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BankAccountInfoController.prototype, "delete", null);
exports.BankAccountInfoController = BankAccountInfoController = __decorate([
    (0, common_1.Controller)("bank-account-infos"),
    __metadata("design:paramtypes", [bank_account_info_service_1.BankAccountInfoService])
], BankAccountInfoController);
//# sourceMappingURL=bank-account-info.controller.js.map