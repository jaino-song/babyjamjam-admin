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
exports.UpdateBankAccountInfoUsecase = void 0;
const common_1 = require("@nestjs/common");
const bank_account_info_repository_interface_1 = require("../../../domain/repositories/bank-account-info.repository.interface");
let UpdateBankAccountInfoUsecase = class UpdateBankAccountInfoUsecase {
    constructor(bankAccountInfoRepository) {
        this.bankAccountInfoRepository = bankAccountInfoRepository;
    }
    async execute(area, updates) {
        const bankAccountInfo = await this.bankAccountInfoRepository.findByArea(area);
        if (!bankAccountInfo) {
            throw new common_1.NotFoundException(`Bank account info with area ${area} not found`);
        }
        if (updates.bankName !== undefined) {
            bankAccountInfo.bankName = updates.bankName;
        }
        if (updates.accNum !== undefined) {
            bankAccountInfo.accNum = updates.accNum;
        }
        return this.bankAccountInfoRepository.update(bankAccountInfo);
    }
};
exports.UpdateBankAccountInfoUsecase = UpdateBankAccountInfoUsecase;
exports.UpdateBankAccountInfoUsecase = UpdateBankAccountInfoUsecase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(bank_account_info_repository_interface_1.BANK_ACCOUNT_INFO_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], UpdateBankAccountInfoUsecase);
//# sourceMappingURL=update-bank-account-info.usecase.js.map