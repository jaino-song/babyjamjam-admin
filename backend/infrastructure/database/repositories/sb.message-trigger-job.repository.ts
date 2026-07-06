import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { IMessageTriggerJobRepository } from "domain/repositories/message-trigger-job.repository.interface";
import {
    MessageTriggerJobEntity,
    MessageTriggerJobPayload,
    MessageTriggerJobStatus,
} from "domain/entities/message-trigger-job.entity";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

@Injectable()
export class SbMessageTriggerJobRepository implements IMessageTriggerJobRepository {
    constructor(private readonly prisma: PrismaService) {}

    async create(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity> {
        const row = await this.prisma.message_trigger_job.create({
            data: this.toCreate(job),
        });
        return this.toDomain(row);
    }

    async update(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity> {
        const row = await this.prisma.message_trigger_job.update({
            where: { id: job.id },
            data: this.toUpdate(job),
        });
        return this.toDomain(row);
    }

    async findById(id: string): Promise<MessageTriggerJobEntity | null> {
        const row = await this.prisma.message_trigger_job.findUnique({ where: { id } });
        return row ? this.toDomain(row) : null;
    }

    async findDuePending(limit = 100): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                status: "pending",
                scheduledFor: { lte: new Date() },
            },
            orderBy: { scheduledFor: "asc" },
            take: limit,
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findUpcomingPendingByBranch(
        branchId: string,
        limit = 200,
    ): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                branchId,
                status: "pending",
                scheduledFor: { gte: new Date() },
            },
            orderBy: { scheduledFor: "asc" },
            take: limit,
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findPendingByRuleId(ruleId: string): Promise<MessageTriggerJobEntity[]> {
        const rows = await this.prisma.message_trigger_job.findMany({
            where: { ruleId, status: "pending" },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findPendingByRuleIdsAndClientId(
        ruleIds: string[],
        clientId: number,
    ): Promise<MessageTriggerJobEntity[]> {
        if (ruleIds.length === 0) return [];
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                ruleId: { in: ruleIds },
                clientId,
                status: "pending",
            },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findPendingByRuleIdsAndEmployeeScheduleId(
        ruleIds: string[],
        employeeScheduleId: number,
    ): Promise<MessageTriggerJobEntity[]> {
        if (ruleIds.length === 0) return [];
        const rows = await this.prisma.message_trigger_job.findMany({
            where: {
                ruleId: { in: ruleIds },
                employeeScheduleId,
                status: "pending",
            },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async upsertPending(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity> {
        const row = await this.prisma.message_trigger_job.upsert({
            where: { dedupeKey: job.dedupeKey },
            create: this.toCreate(job),
            update: {
                status: "pending",
                scheduledFor: job.scheduledFor,
                canceledAt: null,
                cancelReason: null,
                sentAt: null,
                recipientType: job.recipientType,
                recipientPhone: job.recipientPhone,
                templateKey: job.templateKey,
                payload: job.payload as unknown as Prisma.InputJsonValue,
            },
        });
        return this.toDomain(row);
    }

    private toCreate(job: MessageTriggerJobEntity) {
        return {
            branchId: job.branchId,
            ruleId: job.ruleId,
            status: job.status,
            scheduledFor: job.scheduledFor,
            sentAt: job.sentAt,
            canceledAt: job.canceledAt,
            cancelReason: job.cancelReason,
            clientId: job.clientId,
            employeeScheduleId: job.employeeScheduleId,
            recipientType: job.recipientType,
            recipientPhone: job.recipientPhone,
            templateKey: job.templateKey,
            dedupeKey: job.dedupeKey,
            payload: job.payload as unknown as Prisma.InputJsonValue,
        };
    }

    private toUpdate(job: MessageTriggerJobEntity) {
        return {
            status: job.status,
            scheduledFor: job.scheduledFor,
            sentAt: job.sentAt,
            canceledAt: job.canceledAt,
            cancelReason: job.cancelReason,
            recipientType: job.recipientType,
            recipientPhone: job.recipientPhone,
            templateKey: job.templateKey,
            payload: job.payload as unknown as Prisma.InputJsonValue,
        };
    }

    private toDomain(row: {
        id: string;
        branchId: string | null;
        ruleId: string;
        status: string;
        scheduledFor: Date;
        sentAt: Date | null;
        canceledAt: Date | null;
        cancelReason: string | null;
        clientId: number | null;
        employeeScheduleId: number | null;
        recipientType: string;
        recipientPhone: string | null;
        templateKey: string;
        dedupeKey: string;
        payload: Prisma.JsonValue;
        createdAt: Date;
        updatedAt: Date;
    }): MessageTriggerJobEntity {
        return MessageTriggerJobEntity.reconstitute(
            row.id,
            row.branchId,
            row.ruleId,
            row.status as MessageTriggerJobStatus,
            row.scheduledFor,
            row.sentAt,
            row.canceledAt,
            row.cancelReason,
            row.clientId,
            row.employeeScheduleId,
            row.recipientType as MessageTriggerRecipientType,
            row.recipientPhone,
            row.templateKey as MessageTriggerTemplateKey,
            row.dedupeKey,
            ((row.payload as unknown as MessageTriggerJobPayload) ?? {
                memberId: "",
                recipientName: "",
                recipientPhone: "",
                templateVariables: {},
            }),
            row.createdAt,
            row.updatedAt,
        );
    }
}
