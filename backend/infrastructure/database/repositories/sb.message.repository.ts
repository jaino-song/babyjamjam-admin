import { IMessageRepository } from "domain/repositories/message.repository.interface";
import { MessageEntity } from "domain/entities/message.entity";
import { PrismaService } from "../prisma.service";
import { Injectable } from "@nestjs/common";
import { MessageMapper } from "../mapper/message.mapper";

@Injectable()
export class SbMessageRepository implements IMessageRepository {
    constructor(private prismaService: PrismaService) {}

    async findAll(branchid: string): Promise<MessageEntity[]> {
        const messages = await this.prismaService.message.findMany({
            where: { branchId: branchid },
            orderBy: { createdAt: "desc" },
        });
        return messages.map(MessageMapper.toDomain);
    }

    async findById(branchid: string, id: number): Promise<MessageEntity | null> {
        const message = await this.prismaService.message.findFirst({
            where: { id, branchId: branchid },
        });
        return message ? MessageMapper.toDomain(message) : null;
    }

    async create(branchid: string, message: MessageEntity): Promise<MessageEntity> {
        const created = await this.prismaService.message.create({
            data: {
                ...MessageMapper.toPrismaCreate(message),
                branchId: branchid,
            },
        });
        return MessageMapper.toDomain(created);
    }

    async update(branchid: string, message: MessageEntity): Promise<MessageEntity> {
        const result = await this.prismaService.message.updateMany({
            where: { id: message.id, branchId: branchid },
            data: MessageMapper.toPrismaUpdate(message),
        });
        if (result.count === 0) {
            throw new Error("Message not found for branch");
        }
        const updated = await this.prismaService.message.findFirst({
            where: { id: message.id, branchId: branchid },
        });
        if (!updated) {
            throw new Error("Message not found after update");
        }
        return MessageMapper.toDomain(updated);
    }

    async delete(branchid: string, id: number): Promise<void> {
        const result = await this.prismaService.message.deleteMany({
            where: { id, branchId: branchid },
        });
        if (result.count === 0) {
            throw new Error("Message not found for branch");
        }
    }
}
