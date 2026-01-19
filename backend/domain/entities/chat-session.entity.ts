/**
 * ChatMessage represents a single message in a chat session
 */
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
}

/**
 * ChatSessionEntity represents a chat session with Gemini AI
 * Sessions expire after 1 day and have a maximum of 100 messages
 */
export class ChatSessionEntity {
    public static readonly MAX_MESSAGES = 100;
    public static readonly SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day

    constructor(
        public readonly id: string,
        public readonly userId: string,
        public messages: ChatMessage[],
        public readonly createdAt: Date,
        public expiresAt: Date,
    ) {}

    /**
     * Check if the session has expired
     */
    isExpired(): boolean {
        return new Date() > this.expiresAt;
    }

    /**
     * Check if the session can accept more messages
     */
    canAddMessage(): boolean {
        return this.messages.length < ChatSessionEntity.MAX_MESSAGES;
    }

    /**
     * Add a message to the session
     * @throws Error if session is expired or at max capacity
     */
    addMessage(role: 'user' | 'assistant', content: string): void {
        if (this.isExpired()) {
            throw new Error('Session has expired');
        }
        if (!this.canAddMessage()) {
            throw new Error(`Session has reached maximum message limit of ${ChatSessionEntity.MAX_MESSAGES}`);
        }
        this.messages.push({
            role,
            content,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Get the message count
     */
    getMessageCount(): number {
        return this.messages.length;
    }

    /**
     * Create a new chat session
     */
    static create(userId: string): ChatSessionEntity {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ChatSessionEntity.SESSION_DURATION_MS);
        
        return new ChatSessionEntity(
            '', // ID will be assigned by repository
            userId,
            [],
            now,
            expiresAt,
        );
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper)
     */
    static reconstitute(
        id: string,
        userId: string,
        messages: ChatMessage[],
        createdAt: Date,
        expiresAt: Date,
    ): ChatSessionEntity {
        return new ChatSessionEntity(
            id,
            userId,
            messages,
            createdAt,
            expiresAt,
        );
    }
}
