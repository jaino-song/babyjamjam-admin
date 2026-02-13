import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";
import { AlimtalkLogMapper } from "infrastructure/database/mapper/alimtalk-log.mapper";

@Injectable()
export class SbAlimtalkLogRepository implements IAlimtalkLogRepository {
    constructor(private readonly prisma: PrismaService) {}

    async save(log: AlimtalkLogEntity): Promise<AlimtalkLogEntity> {
        const row = await this.prisma.alimtalk_log.create({
            data: AlimtalkLogMapper.toPrismaCreate(log),
        });
        return AlimtalkLogMapper.toDomain(row);
    }

    async update(log: AlimtalkLogEntity): Promise<AlimtalkLogEntity> {
        const row = await this.prisma.alimtalk_log.update({
            where: { id: log.id },
            data: AlimtalkLogMapper.toPrismaUpdate(log),
        });
        return AlimtalkLogMapper.toDomain(row);
    }

    async findPendingRetries(): Promise<AlimtalkLogEntity[]> {
        const rows = await this.prisma.alimtalk_log.findMany({
            where: {
                status: "pending",
                nextRetryAt: { lte: new Date() },
            },
            orderBy: { nextRetryAt: "asc" },
            take: 50,
        });
        return rows.map(AlimtalkLogMapper.toDomain);
    }
}
