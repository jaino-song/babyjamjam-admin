"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserModule = void 0;
const common_1 = require("@nestjs/common");
const user_1 = require("../application/usecases/user");
const sb_user_repository_1 = require("../infrastructure/database/repositories/sb.user.repository");
const user_service_1 = require("../application/services/user.service");
const user_controller_1 = require("../interface/controllers/user.controller");
const user_repository_interface_1 = require("../domain/repositories/user.repository.interface");
const prisma_service_1 = require("../infrastructure/database/prisma.service");
let UserModule = class UserModule {
};
exports.UserModule = UserModule;
exports.UserModule = UserModule = __decorate([
    (0, common_1.Module)({
        controllers: [user_controller_1.UserController],
        providers: [
            user_1.CreateUserUsecase,
            user_1.FindUserByIdUsecase,
            user_1.FindUserByKakaoIdUsecase,
            user_1.UpdateUserUsecase,
            user_1.DeleteUserUsecase,
            user_service_1.UserService,
            prisma_service_1.PrismaService,
            {
                provide: user_repository_interface_1.USER_REPOSITORY,
                useClass: sb_user_repository_1.SbUserRepository,
            },
        ],
        exports: [user_service_1.UserService],
    })
], UserModule);
//# sourceMappingURL=user.module.js.map