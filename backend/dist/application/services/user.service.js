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
exports.UserService = void 0;
const common_1 = require("@nestjs/common");
const user_1 = require("../usecases/user");
let UserService = class UserService {
    constructor(createUserUsecase, findUserByIdUsecase, findUserByKakaoIdUsecase, updateUserUsecase, deleteUserUsecase) {
        this.createUserUsecase = createUserUsecase;
        this.findUserByIdUsecase = findUserByIdUsecase;
        this.findUserByKakaoIdUsecase = findUserByKakaoIdUsecase;
        this.updateUserUsecase = updateUserUsecase;
        this.deleteUserUsecase = deleteUserUsecase;
    }
    create(params) {
        return this.createUserUsecase.execute(params.kakaoId, params.name, params.email, params.profileImage);
    }
    findById(id) {
        return this.findUserByIdUsecase.execute(id);
    }
    findByKakaoId(kakaoId) {
        return this.findUserByKakaoIdUsecase.execute(kakaoId);
    }
    update(id, params) {
        return this.updateUserUsecase.execute(id, params);
    }
    delete(id) {
        return this.deleteUserUsecase.execute(id);
    }
};
exports.UserService = UserService;
exports.UserService = UserService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [user_1.CreateUserUsecase,
        user_1.FindUserByIdUsecase,
        user_1.FindUserByKakaoIdUsecase,
        user_1.UpdateUserUsecase,
        user_1.DeleteUserUsecase])
], UserService);
//# sourceMappingURL=user.service.js.map