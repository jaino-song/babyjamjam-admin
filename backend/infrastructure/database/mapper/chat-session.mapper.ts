import { ChatSessionEntity, ChatMessage } from "domain/entities/chat-session.entity";
import { Prisma } from "@prisma/client";

type ChatSessionRow = {
    id: string;
    user_id: string;
    messages: Prisma.JsonValue;
    created_at: Date;
    expires_at: Date;
};

export class ChatSessionMapper {
    static toDomain(row: ChatSessionRow): ChatSessionEntity {
        const messages = Array.isArray(row.messages) 
            ? (row.messages as unknown as ChatMessage[])
            : [];
        
        return ChatSessionEntity.reconstitute(
            row.id,
            row.user_id,
            messages,
            row.created_at,
            row.expires_at,
        );
    }

    static toPrismaCreate(entity: ChatSessionEntity) {
        return {
            user_id: entity.userId,
            messages: entity.messages as unknown as Prisma.InputJsonValue,
            expires_at: entity.expiresAt,
        };
    }

    static toPrismaUpdate(entity: ChatSessionEntity) {
        return {
            messages: entity.messages as unknown as Prisma.InputJsonValue,
            expires_at: entity.expiresAt,
        };
    }
}
