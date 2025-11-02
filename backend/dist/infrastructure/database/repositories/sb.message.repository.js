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
exports.SbMessageRepository = void 0;
const prisma_service_1 = require("../prisma.service");
const common_1 = require("@nestjs/common");
const message_mapper_1 = require("../mapper/message.mapper");
let SbMessageRepository = class SbMessageRepository {
    constructor(prismaService) {
        this.prismaService = prismaService;
    }
    async findById(id) {
        const message = await this.prismaService.message.findUnique({
            where: { id },
        });
        return message ? message_mapper_1.MessageMapper.toDomain(message) : null;
    }
    async create(message) {
        const created = await this.prismaService.message.create({
            data: message_mapper_1.MessageMapper.toPrismaCreate(message),
        });
        return message_mapper_1.MessageMapper.toDomain(created);
    }
    async update(message) {
        const updated = await this.prismaService.message.update({
            where: { id: message.id },
            data: message_mapper_1.MessageMapper.toPrismaUpdate(message),
        });
        return message_mapper_1.MessageMapper.toDomain(updated);
    }
    async delete(id) {
        await this.prismaService.message.delete({
            where: { id },
        });
    }
};
exports.SbMessageRepository = SbMessageRepository;
exports.SbMessageRepository = SbMessageRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SbMessageRepository);
//# sourceMappingURL=sb.message.repository.js.map