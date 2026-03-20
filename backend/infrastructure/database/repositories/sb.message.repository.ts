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
        const result = await this.prismaService.message.updateMany({
            where: { id: message.id, organizationId: organizationid },
            data: MessageMapper.toPrismaUpdate(message),
        });
        if (result.count === 0) {
            throw new Error("Message not found for organization");
        }
        const updated = await this.prismaService.message.findFirst({
            where: { id: message.id, organizationId: organizationid },
        });
        if (!updated) {
            throw new Error("Message not found after update");
        }
        return MessageMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: number): Promise<void> {
        const result = await this.prismaService.message.deleteMany({
            where: { id, organizationId: organizationid },
        });
        if (result.count === 0) {
            throw new Error("Message not found for organization");
        }
    }
}
