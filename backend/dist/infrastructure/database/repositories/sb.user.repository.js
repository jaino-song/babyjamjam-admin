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
exports.SbUserRepository = void 0;
const prisma_service_1 = require("../prisma.service");
const common_1 = require("@nestjs/common");
const user_mapper_1 = require("../mapper/user.mapper");
let SbUserRepository = class SbUserRepository {
    constructor(prismaService) {
        this.prismaService = prismaService;
    }
    async findById(id) {
        const user = await this.prismaService.user.findUnique({
            where: { id },
        });
        return user ? user_mapper_1.UserMapper.toDomain(user) : null;
    }
    async findByKakaoId(kakaoId) {
        const user = await this.prismaService.user.findUnique({
            where: { kakaoId },
        });
        return user ? user_mapper_1.UserMapper.toDomain(user) : null;
    }
    async create(user) {
        const created = await this.prismaService.user.create({
            data: user_mapper_1.UserMapper.toPrismaCreate(user),
        });
        return user_mapper_1.UserMapper.toDomain(created);
    }
    async update(user) {
        const updated = await this.prismaService.user.update({
            where: { id: user.id },
            data: user_mapper_1.UserMapper.toPrismaUpdate(user),
        });
        return user_mapper_1.UserMapper.toDomain(updated);
    }
    async delete(id) {
        await this.prismaService.user.delete({
            where: { id },
        });
    }
};
exports.SbUserRepository = SbUserRepository;
exports.SbUserRepository = SbUserRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SbUserRepository);
//# sourceMappingURL=sb.user.repository.js.map