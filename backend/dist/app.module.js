"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const jwt_strategy_1 = require("./infrastructure/auth/jwt.strategy");
const auth_controller_1 = require("./interface/controllers/auth.controller");
const eformsign_controller_1 = require("./interface/controllers/eformsign.controller");
const kakao_strategy_1 = require("./infrastructure/auth/kakao.strategy");
const auth_service_1 = require("./application/services/auth.service");
const eformsign_service_1 = require("./application/services/eformsign.service");
const config_1 = require("@nestjs/config");
const passport_1 = require("@nestjs/passport");
const bank_account_info_module_1 = require("./module/bank-account-info.module");
const user_module_1 = require("./module/user.module");
const message_module_1 = require("./module/message.module");
const voucher_price_info_module_1 = require("./module/voucher-price-info.module");
const employee_module_1 = require("./module/employee.module");
const client_module_1 = require("./module/client.module");
const employee_schedule_module_1 = require("./module/employee-schedule.module");
const prisma_service_1 = require("./infrastructure/database/prisma.service");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
            }),
            passport_1.PassportModule,
            jwt_1.JwtModule.register({
                secret: process.env.JWT_SECRET,
                signOptions: { expiresIn: "7d" },
            }),
            user_module_1.UserModule,
            bank_account_info_module_1.BankAccountInfoModule,
            message_module_1.MessageModule,
            voucher_price_info_module_1.VoucherPriceInfoModule,
            employee_module_1.EmployeeModule,
            client_module_1.ClientModule,
            employee_schedule_module_1.EmployeeScheduleModule,
            client_module_1.ClientModule,
            employee_schedule_module_1.EmployeeScheduleModule,
        ],
        controllers: [auth_controller_1.AuthController, eformsign_controller_1.EformsignController],
        providers: [auth_service_1.AuthService, eformsign_service_1.EformsignService, kakao_strategy_1.KakaoStrategy, jwt_strategy_1.JwtStrategy, prisma_service_1.PrismaService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map