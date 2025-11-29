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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const auth_service_1 = require("../../application/services/auth.service");
const jwt_guard_1 = require("../../infrastructure/auth/jwt.guard");
const prisma_service_1 = require("../../infrastructure/database/prisma.service");
const token_exchange_dto_1 = require("../dto/token-exchange.dto");
let AuthController = class AuthController {
    constructor(authService, prisma) {
        this.authService = authService;
        this.prisma = prisma;
    }
    async kakaoLogin() {
    }
    async kakaoCallback(req, res) {
        const tokens = await this.authService.validateKakaoUser(req.user);
        const code = await this.authService.createAuthCode(tokens);
        const isProduction = process.env.NODE_ENV === "production";
        const frontendURL = isProduction
            ? process.env.PRODUCTION_FRONTEND_URL
            : (process.env.DEVELOPMENT_FRONTEND_URL || "http://localhost:3000");
        console.log(`[Auth] Redirecting to ${frontendURL}/auth/callback (NODE_ENV: ${process.env.NODE_ENV})`);
        res.redirect(`${frontendURL}/auth/callback?code=${code}`);
    }
    async getCurrentUser(req) {
        const user = await this.prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                name: true,
                email: true,
                profile_image: true,
                role: true,
            },
        });
        return user;
    }
    async exchangeToken(body) {
        const tokens = await this.authService.exchangeCodeForTokens(body.code);
        return tokens;
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Get)("kakao"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("kakao")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "kakaoLogin", null);
__decorate([
    (0, common_1.Get)("kakao/callback"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("kakao")),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "kakaoCallback", null);
__decorate([
    (0, common_1.Get)("me"),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "getCurrentUser", null);
__decorate([
    (0, common_1.Post)("token"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [token_exchange_dto_1.TokenExchangeDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "exchangeToken", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)("auth"),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        prisma_service_1.PrismaService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map