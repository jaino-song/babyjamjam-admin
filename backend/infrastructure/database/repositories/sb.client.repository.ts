import { Injectable } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository, PaginatedResult } from "domain/repositories/client.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";

@Injectable()
export class SbClientRepository implements IClientRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(id: number): Promise<ClientEntity | null> {
        const client = await this.prismaService.client.findUnique({
            where: { id },
        });
        return client ? ClientMapper.toDomain(client) : null;
    }

    async findAll(): Promise<ClientEntity[]> {
        const clients = await this.prismaService.client.findMany();
        return clients.map(ClientMapper.toDomain);
    }

    async findAllPaginated(page: number, limit: number, search?: string): Promise<PaginatedResult<ClientEntity>> {
        const skip = (page - 1) * limit;
        
        const where = search ? {
            OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { address: { contains: search, mode: 'insensitive' as const } },
                { phone: { contains: search, mode: 'insensitive' as const } },
            ],
        } : {};

        try {
            const [clients, total] = await Promise.all([
                this.prismaService.client.findMany({
                    where,
                    skip,
                    take: limit,
                    orderBy: { id: 'desc' },
                }),
                this.prismaService.client.count({ where }),
            ]);

            return {
                data: clients.map(ClientMapper.toDomain),
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        } catch (error) {
            console.error('[ClientRepository] findAllPaginated error:', error);
            throw error;
        }
    }

    async create(client: ClientEntity): Promise<ClientEntity> {
        const created = await this.prismaService.client.create({
            data: ClientMapper.toPrismaCreate(client),
        });
        return ClientMapper.toDomain(created);
    }

    async update(client: ClientEntity): Promise<ClientEntity> {
        const updated = await this.prismaService.client.update({
            where: { id: client.id },
            data: ClientMapper.toPrismaUpdate(client),
        });
        return ClientMapper.toDomain(updated);
    }

    async delete(id: number): Promise<void> {
        await this.prismaService.client.delete({
            where: { id },
        });
    }
}
