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
exports.FindBankAccountInfoByAreaUsecase = void 0;
const common_1 = require("@nestjs/common");
const bank_account_info_repository_interface_1 = require("../../../domain/repositories/bank-account-info.repository.interface");
let FindBankAccountInfoByAreaUsecase = class FindBankAccountInfoByAreaUsecase {
    constructor(bankAccountInfoRepository) {
        this.bankAccountInfoRepository = bankAccountInfoRepository;
    }
    execute(area) {
        return this.bankAccountInfoRepository.findByArea(area);
    }
};
exports.FindBankAccountInfoByAreaUsecase = FindBankAccountInfoByAreaUsecase;
exports.FindBankAccountInfoByAreaUsecase = FindBankAccountInfoByAreaUsecase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(bank_account_info_repository_interface_1.BANK_ACCOUNT_INFO_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], FindBankAccountInfoByAreaUsecase);
//# sourceMappingURL=find-bank-account-info-by-area.usecase.js.map