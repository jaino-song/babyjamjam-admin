import { Injectable } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { IAlimtalkTriggerRuleRepository } from "domain/repositories/alimtalk-trigger-rule.repository.interface";
import { AlimtalkTriggerRuleEntity } from "domain/entities/alimtalk-trigger-rule.entity";
import {
    AlimtalkTriggerEventType,
    AlimtalkTriggerOffsetType,
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";

@Injectable()
export class SbAlimtalkTriggerRuleRepository implements IAlimtalkTriggerRuleRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findAll(branchId: string): Promise<AlimtalkTriggerRuleEntity[]> {
        const rows = await this.prisma.alimtalk_trigger_rule.findMany({
            where: { branchId },
            orderBy: { createdAt: "desc" },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findById(branchId: string, id: string): Promise<AlimtalkTriggerRuleEntity | null> {
        const row = await this.prisma.alimtalk_trigger_rule.findFirst({
            where: { id, branchId },
        });
        return row ? this.toDomain(row) : null;
    }

    async findActiveByEventTypes(
        branchId: string,
        eventTypes: AlimtalkTriggerEventType[],
    ): Promise<AlimtalkTriggerRuleEntity[]> {
        const rows = await this.prisma.alimtalk_trigger_rule.findMany({
            where: {
                branchId,
                isActive: true,
                eventType: { in: eventTypes },
            },
            orderBy: { createdAt: "desc" },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async create(
        branchId: string,
        rule: AlimtalkTriggerRuleEntity,
    ): Promise<AlimtalkTriggerRuleEntity> {
        const row = await this.prisma.alimtalk_trigger_rule.create({
            data: {
                branchId,
                name: rule.name,
                isActive: rule.isActive,
                eventType: rule.eventType,
                offsetType: rule.offsetType,
                offsetDays: rule.offsetDays,
                recipientType: rule.recipientType,
                templateKey: rule.templateKey,
            },
        });
        return this.toDomain(row);
    }

    async update(
        branchId: string,
        rule: AlimtalkTriggerRuleEntity,
    ): Promise<AlimtalkTriggerRuleEntity> {
        const row = await this.prisma.alimtalk_trigger_rule.update({
            where: { id: rule.id },
            data: {
                branchId,
                name: rule.name,
                isActive: rule.isActive,
                eventType: rule.eventType,
                offsetType: rule.offsetType,
                offsetDays: rule.offsetDays,
                recipientType: rule.recipientType,
                templateKey: rule.templateKey,
            },
        });
        return this.toDomain(row);
    }

    async delete(branchId: string, id: string): Promise<void> {
        await this.prisma.alimtalk_trigger_rule.deleteMany({
            where: { id, branchId },
        });
    }

    private toDomain(row: {
        id: string;
        branchId: string | null;
        name: string;
        isActive: boolean;
        eventType: string;
        offsetType: string;
        offsetDays: number;
        recipientType: string;
        templateKey: string;
        createdAt: Date;
        updatedAt: Date;
    }): AlimtalkTriggerRuleEntity {
        return AlimtalkTriggerRuleEntity.reconstitute(
            row.id,
            row.branchId,
            row.name,
            row.isActive,
            row.eventType as AlimtalkTriggerEventType,
            row.offsetType as AlimtalkTriggerOffsetType,
            row.offsetDays,
            row.recipientType as AlimtalkTriggerRecipientType,
            row.templateKey as AlimtalkTriggerTemplateKey,
            row.createdAt,
            row.updatedAt,
        );
    }
}
