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
            include: { messages: { orderBy: { timestamp: 'asc' } } },
        });
        if (!session) return null;
        
        const entity = ChatSessionMapper.toDomain(session);
        return entity.isExpired() ? null : entity;
    }

    async findByUserId(userId: string): Promise<ChatSessionEntity | null> {
        const session = await this.prismaService.chat_session.findFirst({
            where: { user_id: userId },
            orderBy: { created_at: 'desc' },
            include: { messages: { orderBy: { timestamp: 'asc' } } },
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
            include: { messages: { orderBy: { timestamp: 'asc' } } },
        });
        return session ? ChatSessionMapper.toDomain(session) : null;
    }

    async create(session: ChatSessionEntity): Promise<ChatSessionEntity> {
        const created = await this.prismaService.chat_session.create({
            data: ChatSessionMapper.toPrismaCreate(session),
            include: { messages: true },
        });
        return ChatSessionMapper.toDomain(created);
    }

    async update(session: ChatSessionEntity): Promise<ChatSessionEntity> {
        // Get existing messages count
        const existing = await this.prismaService.chat_message.count({
            where: { session_id: session.id },
        });
        
        // Create new messages (those beyond existing count)
        const newMessages = session.messages.slice(existing);
        
        if (newMessages.length > 0) {
            await this.prismaService.chat_message.createMany({
                data: newMessages.map(m => ChatSessionMapper.toPrismaCreateMessage(session.id, m)),
            });
        }
        
        // Update session expiry
        const updated = await this.prismaService.chat_session.update({
            where: { id: session.id },
            data: { expires_at: session.expiresAt },
            include: { messages: { orderBy: { timestamp: 'asc' } } },
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
