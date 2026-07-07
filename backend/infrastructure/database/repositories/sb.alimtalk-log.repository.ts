import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";
import { AlimtalkLogMapper } from "infrastructure/database/mapper/alimtalk-log.mapper";
import {
    SERVICE_FEEDBACK_LINK_RULE_ID,
    SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-feedback-link-message";

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
                status: { in: ["pending", "failed"] },
                nextRetryAt: { lte: new Date() },
            },
            orderBy: { nextRetryAt: "asc" },
            take: 50,
        });
        return rows.map(AlimtalkLogMapper.toDomain);
    }

    async findRetryableServiceFeedbackSmsByScheduleId(scheduleId: number): Promise<AlimtalkLogEntity[]> {
        const jobs = await this.prisma.alimtalk_trigger_job.findMany({
            where: {
                employeeScheduleId: scheduleId,
                ruleId: SERVICE_FEEDBACK_LINK_RULE_ID,
            },
            select: { id: true },
        });
        const triggerJobIds = jobs.map((job) => job.id);

        const rows = await this.prisma.alimtalk_log.findMany({
            where: {
                provider: "aligo_sms",
                templateKey: SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
                status: { in: ["pending", "failed"] },
                nextRetryAt: { not: null },
                OR: [
                    ...(triggerJobIds.length > 0 ? [{ triggerJobId: { in: triggerJobIds } }] : []),
                    { variables: { path: ["scheduleId"], equals: String(scheduleId) } },
                ],
            },
            orderBy: { createdAt: "desc" },
        });
        return rows.map(AlimtalkLogMapper.toDomain);
    }

    async findRecentByBranch(
        branchId: string,
        limit = 200,
        skip = 0,
    ): Promise<AlimtalkLogEntity[]> {
        const rows = await this.prisma.alimtalk_log.findMany({
            where: { branchId },
            orderBy: { createdAt: "desc" },
            take: limit,
            skip,
        });
        return rows.map(AlimtalkLogMapper.toDomain);
    }
}
