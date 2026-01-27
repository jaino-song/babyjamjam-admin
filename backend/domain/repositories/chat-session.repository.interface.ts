import { ChatSessionEntity } from "../entities/chat-session.entity";

export interface IChatSessionRepository {
    findById(id: string): Promise<ChatSessionEntity | null>;
    findByUserId(userId: string): Promise<ChatSessionEntity | null>;
    findActiveByUserId(userId: string): Promise<ChatSessionEntity | null>;
    create(session: ChatSessionEntity): Promise<ChatSessionEntity>;
    update(session: ChatSessionEntity): Promise<ChatSessionEntity>;
    delete(id: string): Promise<void>;
    deleteExpired(): Promise<number>;
    deleteOlderThan(cutoffDate: Date): Promise<number>;
}

export const CHAT_SESSION_REPOSITORY = 'CHAT_SESSION_REPOSITORY';
