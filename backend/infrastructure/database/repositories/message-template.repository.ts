import { Injectable } from "@nestjs/common";
import { IMessageTemplateRepository } from "domain/repositories/message-template.repository.interface";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageTemplateMapper } from "infrastructure/database/mapper/message-template.mapper";

@Injectable()
export class MessageTemplateRepository implements IMessageTemplateRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async findById(id: string): Promise<MessageTemplateEntity | null> {
        const row = await this.prismaService.message_template.findUnique({
            where: { id },
        });
        return row ? MessageTemplateMapper.toDomain(row) : null;
    }

    async findAll(): Promise<MessageTemplateEntity[]> {
        const rows = await this.prismaService.message_template.findMany({
            orderBy: { created_at: "desc" },
        });
        return rows.map(MessageTemplateMapper.toDomain);
    }

    async create(template: MessageTemplateEntity): Promise<MessageTemplateEntity> {
        const created = await this.prismaService.message_template.create({
            data: MessageTemplateMapper.toPrismaCreate(template),
        });
        return MessageTemplateMapper.toDomain(created);
    }

    async update(template: MessageTemplateEntity): Promise<MessageTemplateEntity> {
        const updated = await this.prismaService.message_template.update({
            where: { id: template.id },
            data: MessageTemplateMapper.toPrismaUpdate(template),
        });
        return MessageTemplateMapper.toDomain(updated);
    }

    async delete(id: string): Promise<void> {
        await this.prismaService.message_template.delete({
            where: { id },
        });
    }
}
