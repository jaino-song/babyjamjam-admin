import { ChatSessionEntity, ChatMessage } from "domain/entities/chat-session.entity";
import { chat_session, chat_message } from "@prisma/client";

type ChatSessionWithMessages = chat_session & {
    messages: chat_message[];
};

export class ChatSessionMapper {
    static toDomain(row: ChatSessionWithMessages): ChatSessionEntity {
        const messages: ChatMessage[] = row.messages.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            timestamp: m.timestamp.toISOString(),
        }));
        
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
            expires_at: entity.expiresAt,
        };
    }

    static toPrismaCreateMessage(sessionId: string, message: ChatMessage) {
        return {
            session_id: sessionId,
            role: message.role,
            content: message.content,
            timestamp: new Date(message.timestamp),
        };
    }
}
