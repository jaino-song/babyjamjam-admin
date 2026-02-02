import { Injectable } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { IClientRepository, PaginatedResult } from "domain/repositories/client.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";

@Injectable()
export class SbClientRepository implements IClientRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(organizationid: string, id: number): Promise<ClientEntity | null> {
        const client = await this.prismaService.client.findFirst({
            where: { id, organizationId: organizationid },
        });
        return client ? ClientMapper.toDomain(client) : null;
    }

    async findAll(organizationid: string): Promise<ClientEntity[]> {
        const clients = await this.prismaService.client.findMany({
            where: { organizationId: organizationid },
        });
        return clients.map(ClientMapper.toDomain);
    }

    async findAllPaginated(
        organizationid: string,
        page: number,
        limit: number,
        search?: string
    ): Promise<PaginatedResult<ClientEntity>> {
        const skip = (page - 1) * limit;

        const where = {
            organizationId: organizationid,
            ...(search
                ? {
                      OR: [
                          { name: { contains: search, mode: 'insensitive' as const } },
                          { address: { contains: search, mode: 'insensitive' as const } },
                          { phone: { contains: search, mode: 'insensitive' as const } },
                      ],
                  }
                : {}),
        };

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

    async create(organizationid: string, client: ClientEntity): Promise<ClientEntity> {
        const created = await this.prismaService.client.create({
            data: {
                ...ClientMapper.toPrismaCreate(client),
                organizationId: organizationid,
            },
        });
        return ClientMapper.toDomain(created);
    }

    async update(organizationid: string, client: ClientEntity): Promise<ClientEntity> {
        const updated = await this.prismaService.client.update({
            where: { id: client.id, organizationId: organizationid },
            data: ClientMapper.toPrismaUpdate(client),
        });
        return ClientMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: number): Promise<void> {
        await this.prismaService.client.delete({
            where: { id, organizationId: organizationid },
        });
    }

    async findByStartDate(organizationid: string, date: Date): Promise<ClientEntity[]> {
        // Normalize to start of day for date comparison
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                organizationId: organizationid,
                startDate: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
            },
        });
        return clients.map(ClientMapper.toDomain);
    }

    async findByEndDate(organizationid: string, date: Date): Promise<ClientEntity[]> {
        // Normalize to start of day for date comparison
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                organizationId: organizationid,
                endDate: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
            },
        });
        return clients.map(ClientMapper.toDomain);
    }

    async findByCreatedDate(organizationid: string, date: Date): Promise<ClientEntity[]> {
        // Note: Client model doesn't have createdAt field in schema
        // For now, this returns empty array. To enable payment reminders,
        // add createdAt field to client model in schema.prisma
        void organizationid;
        void date;
        console.warn('[ClientRepository] findByCreatedDate: client model lacks createdAt field');
        return [];
    }

    async findStartingWithinDays(organizationid: string, days: number): Promise<ClientEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                organizationId: organizationid,
                startDate: {
                    gt: today,
                    lte: endDate,
                },
            },
        });
        return clients.map(ClientMapper.toDomain);
    }

    async findEndingWithinDays(organizationid: string, days: number): Promise<ClientEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                organizationId: organizationid,
                endDate: {
                    gte: today,
                    lte: endDate,
                },
            },
        });
        return clients.map(ClientMapper.toDomain);
    }

    async findWithIncompleteContractsStartingWithinDays(
        organizationid: string,
        days: number
    ): Promise<ClientEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                organizationId: organizationid,
                startDate: {
                    gt: today,
                    lte: endDate,
                },
                eDocId: { not: null },
                eformsignDocByEDocId: {
                    statusType: { not: '050' },
                },
            },
            include: {
                eformsignDocByEDocId: true,
            },
        });
        return clients.map(ClientMapper.toDomain);
    }

    async findWithoutContractSentStartingWithinDays(
        organizationid: string,
        days: number
    ): Promise<ClientEntity[]> {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                organizationId: organizationid,
                startDate: {
                    gt: today,
                    lte: endDate,
                },
                eDocId: null,
            },
        });
        return clients.map(ClientMapper.toDomain);
    }
}
