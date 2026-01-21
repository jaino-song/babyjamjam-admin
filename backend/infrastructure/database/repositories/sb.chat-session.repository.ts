import { Injectable } from "@nestjs/common";
import { IChatSessionRepository } from "domain/repositories/chat-session.repository.interface";
import { ChatSessionEntity } from "domain/entities/chat-session.entity";
import { PrismaService } from "../prisma.service";
import { ChatSessionMapper } from "../mapper/chat-session.mapper";

@Injectable()
export class SbChatSessionRepository implements IChatSessionRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(id: string): Promise<ChatSessionEntity | null> {
        const session = await this.prismaService.chat_session.findUnique({
            where: { id },
        });
        if (!session) return null;
        
        const entity = ChatSessionMapper.toDomain(session);
        return entity.isExpired() ? null : entity;
    }

    async findByUserId(userId: string): Promise<ChatSessionEntity | null> {
        const session = await this.prismaService.chat_session.findFirst({
            where: { user_id: userId },
            orderBy: { created_at: 'desc' },
        });
        return session ? ChatSessionMapper.toDomain(session) : null;
    }

    async findActiveByUserId(userId: string): Promise<ChatSessionEntity | null> {
        const now = new Date();
        const session = await this.prismaService.chat_session.findFirst({
            where: {
                user_id: userId,
                expires_at: { gt: now },
            },
            orderBy: { created_at: 'desc' },
        });
        return session ? ChatSessionMapper.toDomain(session) : null;
    }

    async create(session: ChatSessionEntity): Promise<ChatSessionEntity> {
        const created = await this.prismaService.chat_session.create({
            data: ChatSessionMapper.toPrismaCreate(session),
        });
        return ChatSessionMapper.toDomain(created);
    }

    async update(session: ChatSessionEntity): Promise<ChatSessionEntity> {
        const updated = await this.prismaService.chat_session.update({
            where: { id: session.id },
            data: ChatSessionMapper.toPrismaUpdate(session),
        });
        return ChatSessionMapper.toDomain(updated);
    }

    async delete(id: string): Promise<void> {
        await this.prismaService.chat_session.delete({
            where: { id },
        });
    }

    async deleteExpired(): Promise<number> {
        const now = new Date();
        const result = await this.prismaService.chat_session.deleteMany({
            where: { expires_at: { lt: now } },
        });
        return result.count;
    }

    async deleteOlderThan(cutoffDate: Date): Promise<number> {
        const result = await this.prismaService.chat_session.deleteMany({
            where: { created_at: { lt: cutoffDate } },
        });
        return result.count;
    }
}
