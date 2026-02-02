import { IMessageRepository } from "domain/repositories/message.repository.interface";
import { MessageEntity } from "domain/entities/message.entity";
import { PrismaService } from "../prisma.service";
import { Injectable } from "@nestjs/common";
import { MessageMapper } from "../mapper/message.mapper";

@Injectable()
export class SbMessageRepository implements IMessageRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(organizationid: string, id: number): Promise<MessageEntity | null> {
        const message = await this.prismaService.message.findFirst({
            where: { id, organization_id: organizationid },
        });
        return message ? MessageMapper.toDomain(message) : null;
    }

    async create(organizationid: string, message: MessageEntity): Promise<MessageEntity> {
        const created = await this.prismaService.message.create({
            data: {
                ...MessageMapper.toPrismaCreate(message),
                organization_id: organizationid,
            },
        });
        return MessageMapper.toDomain(created);
    }

    async update(organizationid: string, message: MessageEntity): Promise<MessageEntity> {
        const updated = await this.prismaService.message.update({
            where: { id: message.id, organization_id: organizationid },
            data: MessageMapper.toPrismaUpdate(message),
        });
        return MessageMapper.toDomain(updated);
    }

    async delete(organizationid: string, id: number): Promise<void> {
        await this.prismaService.message.delete({
            where: { id, organization_id: organizationid },
        });
    }
}
