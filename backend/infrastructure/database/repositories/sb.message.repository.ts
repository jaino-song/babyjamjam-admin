import { IMessageRepository } from "domain/repositories/message.repository.interface";
import { MessageEntity } from "domain/entities/message.entity";
import { PrismaService } from "../prisma.service";
import { Injectable } from "@nestjs/common";
import { MessageMapper } from "../mapper/message.mapper";

@Injectable()
export class SbMessageRepository implements IMessageRepository {
    constructor(private prismaService: PrismaService) {}

    async findAll(organizationid: string): Promise<MessageEntity[]> {
        const messages = await this.prismaService.message.findMany({
            where: { organizationId: organizationid },
            orderBy: { createdAt: "desc" },
        });
        return messages.map(MessageMapper.toDomain);
    }

    async findById(organizationid: string, id: number): Promise<MessageEntity | null> {
        const message = await this.prismaService.message.findFirst({
            where: { id, organizationId: organizationid },
        });
        return message ? MessageMapper.toDomain(message) : null;
    }

    async create(organizationid: string, message: MessageEntity): Promise<MessageEntity> {
        const created = await this.prismaService.message.create({
            data: {
                ...MessageMapper.toPrismaCreate(message),
                organizationId: organizationid,
            },
        });
        return MessageMapper.toDomain(created);
    }

    async update(organizationid: string, message: MessageEntity): Promise<MessageEntity> {
        const updated = await this.prismaService.message.update({
            where: { id: message.id, organizationId: organizationid },
            data: MessageMapper.toPrismaUpdate(message),
        });
        return MessageMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: number): Promise<void> {
        await this.prismaService.message.delete({
            where: { id, organizationId: organizationid },
        });
    }
}
