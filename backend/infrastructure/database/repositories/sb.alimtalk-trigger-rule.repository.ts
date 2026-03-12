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

    async findAll(organizationId: string): Promise<AlimtalkTriggerRuleEntity[]> {
        const rows = await this.prisma.alimtalk_trigger_rule.findMany({
            where: { organizationId },
            orderBy: { createdAt: "desc" },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async findById(organizationId: string, id: string): Promise<AlimtalkTriggerRuleEntity | null> {
        const row = await this.prisma.alimtalk_trigger_rule.findFirst({
            where: { id, organizationId },
        });
        return row ? this.toDomain(row) : null;
    }

    async findActiveByEventTypes(
        organizationId: string,
        eventTypes: AlimtalkTriggerEventType[],
    ): Promise<AlimtalkTriggerRuleEntity[]> {
        const rows = await this.prisma.alimtalk_trigger_rule.findMany({
            where: {
                organizationId,
                isActive: true,
                eventType: { in: eventTypes },
            },
            orderBy: { createdAt: "desc" },
        });
        return rows.map((row) => this.toDomain(row));
    }

    async create(
        organizationId: string,
        rule: AlimtalkTriggerRuleEntity,
    ): Promise<AlimtalkTriggerRuleEntity> {
        const row = await this.prisma.alimtalk_trigger_rule.create({
            data: {
                organizationId,
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
        organizationId: string,
        rule: AlimtalkTriggerRuleEntity,
    ): Promise<AlimtalkTriggerRuleEntity> {
        const row = await this.prisma.alimtalk_trigger_rule.update({
            where: { id: rule.id },
            data: {
                organizationId,
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

    async delete(organizationId: string, id: string): Promise<void> {
        await this.prisma.alimtalk_trigger_rule.deleteMany({
            where: { id, organizationId },
        });
    }

    private toDomain(row: {
        id: string;
        organizationId: string | null;
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
            row.organizationId,
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
