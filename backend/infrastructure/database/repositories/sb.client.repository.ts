import { Injectable } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { IClientRepository, PaginatedResult } from "domain/repositories/client.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import { hasColumn } from "infrastructure/database/schema-capabilities";

@Injectable()
export class SbClientRepository implements IClientRepository {
    constructor(private readonly prismaService: PrismaService) {}

    private async getClientSelect() {
        const supportsCreatedAt = await hasColumn(this.prismaService, "client", "created_at");

        return {
            id: true,
            name: true,
            address: true,
            phone: true,
            type: true,
            duration: true,
            fullPrice: true,
            grant: true,
            actualPrice: true,
            startDate: true,
            endDate: true,
            careCenter: true,
            voucherClient: true,
            birthday: true,
            dueDate: true,
            serviceStatus: true,
            breastPump: true,
            eDocId: true,
            ...(supportsCreatedAt ? { createdAt: true } : {}),
        } as const;
    }

    async findById(branchid: string, id: number): Promise<ClientEntity | null> {
        const select = await this.getClientSelect();
        const client = await this.prismaService.client.findFirst({
            where: { id, branchId: branchid },
            select,
        });
        return client ? ClientMapper.toDomain(client) : null;
    }

    async findAll(branchid: string): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const clients = await this.prismaService.client.findMany({
            where: { branchId: branchid },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findAllPaginated(
        branchid: string,
        page: number,
        limit: number,
        search?: string
    ): Promise<PaginatedResult<ClientEntity>> {
        const skip = (page - 1) * limit;

        const where = {
            branchId: branchid,
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
            const select = await this.getClientSelect();
            const [clients, total] = await Promise.all([
                this.prismaService.client.findMany({
                    where,
                    skip,
                    take: limit,
                    orderBy: { id: 'desc' },
                    select,
                }),
                this.prismaService.client.count({ where }),
            ]);

            return {
                data: clients.map((client) => ClientMapper.toDomain(client as any)),
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

    async create(branchid: string, client: ClientEntity): Promise<ClientEntity> {
        const select = await this.getClientSelect();
        const created = await this.prismaService.client.create({
            data: {
                ...ClientMapper.toPrismaCreate(client),
                branchId: branchid,
            },
            select,
        });
        return ClientMapper.toDomain(created as any);
    }

    async update(branchid: string, client: ClientEntity): Promise<ClientEntity> {
        const select = await this.getClientSelect();
        const result = await this.prismaService.client.updateMany({
            where: { id: client.id, branchId: branchid },
            data: ClientMapper.toPrismaUpdate(client),
        });
        if (result.count === 0) {
            throw new Error("Client not found for branch");
        }
        const updated = await this.prismaService.client.findFirst({
            where: { id: client.id, branchId: branchid },
            select,
        });
        if (!updated) {
            throw new Error("Client not found after update");
        }
        return ClientMapper.toDomain(updated as any);
    }

    async delete(branchid: string, id: number): Promise<void> {
        const result = await this.prismaService.client.deleteMany({
            where: { id, branchId: branchid },
        });
        if (result.count === 0) {
            throw new Error("Client not found for branch");
        }
    }

    async findByStartDate(branchid: string, date: Date): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        // Normalize to start of day for date comparison
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                startDate: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findByEndDate(branchid: string, date: Date): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        // Normalize to start of day for date comparison
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                endDate: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findByCreatedDate(branchid: string, date: Date): Promise<ClientEntity[]> {
        const supportsCreatedAt = await hasColumn(this.prismaService, "client", "created_at");
        if (!supportsCreatedAt) {
            return [];
        }

        const select = await this.getClientSelect();
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                createdAt: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findStartingWithinDays(branchid: string, days: number): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                startDate: {
                    gt: today,
                    lte: endDate,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findEndingWithinDays(branchid: string, days: number): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                endDate: {
                    gte: today,
                    lte: endDate,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findWithIncompleteContractsStartingWithinDays(
        branchid: string,
        days: number
    ): Promise<ClientEntity[]> {
        const baseSelect = await this.getClientSelect();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                startDate: {
                    gt: today,
                    lte: endDate,
                },
                eDocId: { not: null },
                eformsignDocByEDocId: {
                    statusType: { not: '050' },
                },
            },
            select: {
                ...baseSelect,
                eformsignDocByEDocId: {
                    select: {
                        documentId: true,
                        statusType: true,
                    },
                },
            },
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findWithoutContractSentStartingWithinDays(
        branchid: string,
        days: number
    ): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                startDate: {
                    gt: today,
                    lte: endDate,
                },
                eDocId: null,
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }
}
