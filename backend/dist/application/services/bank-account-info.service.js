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
exports.BankAccountInfoService = void 0;
const common_1 = require("@nestjs/common");
const bank_account_info_1 = require("../usecases/bank-account-info");
let BankAccountInfoService = class BankAccountInfoService {
    constructor(createBankAccountInfoUsecase, findBankAccountInfoByAreaUsecase, updateBankAccountInfoUsecase, deleteBankAccountInfoUsecase) {
        this.createBankAccountInfoUsecase = createBankAccountInfoUsecase;
        this.findBankAccountInfoByAreaUsecase = findBankAccountInfoByAreaUsecase;
        this.updateBankAccountInfoUsecase = updateBankAccountInfoUsecase;
        this.deleteBankAccountInfoUsecase = deleteBankAccountInfoUsecase;
    }
    create(params) {
        return this.createBankAccountInfoUsecase.execute(params.area, params.bankName, params.accNum);
    }
    findByArea(area) {
        return this.findBankAccountInfoByAreaUsecase.execute(area);
    }
    update(area, params) {
        return this.updateBankAccountInfoUsecase.execute(area, params);
    }
    delete(area) {
        return this.deleteBankAccountInfoUsecase.execute(area);
    }
};
exports.BankAccountInfoService = BankAccountInfoService;
exports.BankAccountInfoService = BankAccountInfoService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [bank_account_info_1.CreateBankAccountInfoUsecase,
        bank_account_info_1.FindBankAccountInfoByAreaUsecase,
        bank_account_info_1.UpdateBankAccountInfoUsecase,
        bank_account_info_1.DeleteBankAccountInfoUsecase])
], BankAccountInfoService);
//# sourceMappingURL=bank-account-info.service.js.map