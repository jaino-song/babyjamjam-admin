import { Injectable } from "@nestjs/common";

import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageLogMapper } from "infrastructure/database/mapper/message-log.mapper";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-record-link-message";

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

    async findSentTriggerJobIds(jobIds: string[]): Promise<Set<string>> {
        if (jobIds.length === 0) {
            return new Set<string>();
        }

        const rows = await this.prisma.message_log.findMany({
            where: {
                triggerJobId: { in: jobIds },
                status: "sent",
            },
            select: { triggerJobId: true },
        });

        return new Set(
            rows
                .map((row) => row.triggerJobId)
                .filter((triggerJobId): triggerJobId is string => Boolean(triggerJobId)),
        );
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

    async findRetryableServiceRecordSmsByScheduleId(scheduleId: number): Promise<MessageLogEntity[]> {
        const jobs = await this.prisma.message_trigger_job.findMany({
            where: {
                employeeScheduleId: scheduleId,
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
            },
            select: { id: true },
        });
        const triggerJobIds = jobs.map((job) => job.id);

        const rows = await this.prisma.message_log.findMany({
            where: {
                provider: "aligo_sms",
                templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                status: { in: ["pending", "failed"] },
                nextRetryAt: { not: null },
                OR: [
                    ...(triggerJobIds.length > 0 ? [{ triggerJobId: { in: triggerJobIds } }] : []),
                    { variables: { path: ["scheduleId"], equals: String(scheduleId) } },
                ],
            },
            orderBy: { createdAt: "desc" },
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
