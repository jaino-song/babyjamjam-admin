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
exports.SbClientRepository = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const client_mapper_1 = require("../mapper/client.mapper");
let SbClientRepository = class SbClientRepository {
    constructor(prismaService) {
        this.prismaService = prismaService;
    }
    async findById(id) {
        const client = await this.prismaService.client.findUnique({
            where: { id },
        });
        return client ? client_mapper_1.ClientMapper.toDomain(client) : null;
    }
    async findAll() {
        const clients = await this.prismaService.client.findMany();
        return clients.map(client_mapper_1.ClientMapper.toDomain);
    }
    async create(client) {
        const created = await this.prismaService.client.create({
            data: client_mapper_1.ClientMapper.toPrismaCreate(client),
        });
        return client_mapper_1.ClientMapper.toDomain(created);
    }
    async update(client) {
        const updated = await this.prismaService.client.update({
            where: { id: client.id },
            data: client_mapper_1.ClientMapper.toPrismaUpdate(client),
        });
        return client_mapper_1.ClientMapper.toDomain(updated);
    }
    async delete(id) {
        await this.prismaService.client.delete({
            where: { id },
        });
    }
};
exports.SbClientRepository = SbClientRepository;
exports.SbClientRepository = SbClientRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SbClientRepository);
//# sourceMappingURL=sb.client.repository.js.map