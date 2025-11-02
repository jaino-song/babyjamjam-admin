"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BankAccountInfoModule = void 0;
const common_1 = require("@nestjs/common");
const bank_account_info_1 = require("../application/usecases/bank-account-info");
const sb_bank_account_info_repository_1 = require("../infrastructure/database/repositories/sb.bank-account-info.repository");
const bank_account_info_service_1 = require("../application/services/bank-account-info.service");
const bank_account_info_controller_1 = require("../interface/controllers/bank-account-info.controller");
const bank_account_info_repository_interface_1 = require("../domain/repositories/bank-account-info.repository.interface");
const prisma_service_1 = require("../infrastructure/database/prisma.service");
let BankAccountInfoModule = class BankAccountInfoModule {
};
exports.BankAccountInfoModule = BankAccountInfoModule;
exports.BankAccountInfoModule = BankAccountInfoModule = __decorate([
    (0, common_1.Module)({
        controllers: [bank_account_info_controller_1.BankAccountInfoController],
        providers: [
            bank_account_info_1.CreateBankAccountInfoUsecase,
            bank_account_info_1.FindBankAccountInfoByAreaUsecase,
            bank_account_info_1.UpdateBankAccountInfoUsecase,
            bank_account_info_1.DeleteBankAccountInfoUsecase,
            bank_account_info_service_1.BankAccountInfoService,
            prisma_service_1.PrismaService,
            {
                provide: bank_account_info_repository_interface_1.BANK_ACCOUNT_INFO_REPOSITORY,
                useClass: sb_bank_account_info_repository_1.SbBankAccountInfoRepository,
            },
        ],
        exports: [bank_account_info_service_1.BankAccountInfoService],
    })
], BankAccountInfoModule);
//# sourceMappingURL=bank-account-info.module.js.map