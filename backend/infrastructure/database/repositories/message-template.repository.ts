import { Injectable } from "@nestjs/common";
import { IMessageTemplateRepository } from "domain/repositories/message-template.repository.interface";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageTemplateMapper } from "infrastructure/database/mapper/message-template.mapper";

@Injectable()
export class MessageTemplateRepository implements IMessageTemplateRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(organizationid: string, id: string): Promise<MessageTemplateEntity | null> {
        const row = await this.prismaService.message_template.findFirst({
            where: { id, organizationId: organizationid },
        });
        return row ? MessageTemplateMapper.toDomain(row) : null;
    }

    async findAll(organizationid: string): Promise<MessageTemplateEntity[]> {
        const rows = await this.prismaService.message_template.findMany({
            where: { organizationId: organizationid },
            orderBy: { createdAt: "desc" },
        });
        return rows.map(MessageTemplateMapper.toDomain);
    }

    async create(organizationid: string, template: MessageTemplateEntity): Promise<MessageTemplateEntity> {
        const { organization, ...data } = MessageTemplateMapper.toPrismaCreate(template);
        void organization;
        const created = await this.prismaService.message_template.create({
            data: {
                ...data,
                organizationId: organizationid,
            },
        });
        return MessageTemplateMapper.toDomain(created);
    }

    async update(organizationid: string, template: MessageTemplateEntity): Promise<MessageTemplateEntity> {
        const updated = await this.prismaService.message_template.update({
            where: { id: template.id, organizationId: organizationid },
            data: MessageTemplateMapper.toPrismaUpdate(template),
        });
        return MessageTemplateMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: string): Promise<void> {
        await this.prismaService.message_template.delete({
            where: { id, organizationId: organizationid },
        });
    }
}
