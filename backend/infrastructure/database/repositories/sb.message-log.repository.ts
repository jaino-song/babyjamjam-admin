import { Injectable } from "@nestjs/common";

import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageLogMapper } from "infrastructure/database/mapper/message-log.mapper";
import { PrismaService } from "infrastructure/database/prisma.service";

@Injectable()
export class SbMessageLogRepository implements IMessageLogRepository {
    constructor(private readonly prisma: PrismaService) {}

    async save(log: MessageLogEntity): Promise<MessageLogEntity> {
        const row = await this.prisma.message_log.create({
            data: MessageLogMapper.toPrismaCreate(log),
        });
        return MessageLogMapper.toDomain(row);
    }

    async update(log: MessageLogEntity): Promise<MessageLogEntity> {
        const row = await this.prisma.message_log.update({
            where: { id: log.id },
            data: MessageLogMapper.toPrismaUpdate(log),
        });
        return MessageLogMapper.toDomain(row);
    }

    async findPendingRetries(): Promise<MessageLogEntity[]> {
        const rows = await this.prisma.message_log.findMany({
            where: {
                status: { in: ["pending", "failed"] },
                nextRetryAt: { lte: new Date() },
            },
            orderBy: { nextRetryAt: "asc" },
            take: 50,
        });
        return rows.map(MessageLogMapper.toDomain);
    }

    async findRecentByBranch(
        branchId: string,
        limit = 200,
        skip = 0,
    ): Promise<MessageLogEntity[]> {
        const rows = await this.prisma.message_log.findMany({
            where: { branchId },
            orderBy: { createdAt: "desc" },
            take: limit,
            skip,
        });
        return rows.map(MessageLogMapper.toDomain);
    }
}
