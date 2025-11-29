"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../infrastructure/database/prisma.service");
const jwt_1 = require("@nestjs/jwt");
const crypto = __importStar(require("crypto"));
let AuthService = class AuthService {
    constructor(prisma, jwt) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.authCodes = new Map();
    }
    cleanupExpiredCodes() {
        const now = Date.now();
        for (const [code, stored] of this.authCodes.entries()) {
            if (now > stored.expiresAt) {
                this.authCodes.delete(code);
            }
        }
    }
    async validateKakaoUser(kakaoData) {
        let user = await this.prisma.user.findFirst({
            where: {
                kakaoId: kakaoData.kakaoId
            },
        });
        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    kakaoId: kakaoData.kakaoId,
                    email: kakaoData.email,
                    name: kakaoData.name,
                    profile_image: kakaoData.profileImage,
                    role: "user",
                },
            });
        }
        const payload = {
            sub: user.id,
            role: user.role,
        };
        const signOptions = user.role === "owner"
            ? { expiresIn: "30d" }
            : { expiresIn: "3d" };
        const refreshSignOptions = user.role === "owner"
            ? { expiresIn: "7d" }
            : { expiresIn: "1d" };
        const refreshToken = await this.jwt.signAsync({ ...payload, type: 'refresh' }, refreshSignOptions);
        const accessToken = await this.jwt.signAsync({ ...payload, type: 'access' }, signOptions);
        return {
            user: user.id,
            accessToken,
            refreshToken,
        };
    }
    async createAuthCode(tokens) {
        const code = crypto.randomBytes(32).toString("hex");
        this.authCodes.set(code, {
            tokens,
            expiresAt: Date.now() + 30 * 1000,
        });
        this.cleanupExpiredCodes();
        return code;
    }
    async exchangeCodeForTokens(code) {
        const stored = this.authCodes.get(code);
        if (!stored) {
            throw new common_1.UnauthorizedException("Invalid authorization code");
        }
        if (Date.now() > stored.expiresAt) {
            this.authCodes.delete(code);
            throw new common_1.UnauthorizedException("Authorization code expired");
        }
        this.authCodes.delete(code);
        return stored.tokens;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, jwt_1.JwtService])
], AuthService);
//# sourceMappingURL=auth.service.js.map