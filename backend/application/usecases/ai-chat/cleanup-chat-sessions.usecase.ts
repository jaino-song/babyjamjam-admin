import { Inject, Injectable, Logger } from "@nestjs/common";
import {
    CHAT_SESSION_REPOSITORY,
    IChatSessionRepository,
} from "domain/repositories/chat-session.repository.interface";
import { ChatSessionEntity } from "domain/entities/chat-session.entity";

export interface CleanupChatSessionsResult {
    deletedCount: number;
}

@Injectable()
export class CleanupChatSessionsUseCase {
    private readonly logger = new Logger(CleanupChatSessionsUseCase.name);

    constructor(
        @Inject(CHAT_SESSION_REPOSITORY)
        private readonly sessionRepository: IChatSessionRepository,
    ) {}

    async execute(): Promise<CleanupChatSessionsResult> {
        const cutoffDate = new Date(Date.now() - ChatSessionEntity.RETENTION_DURATION_MS);
        const deletedCount = await this.sessionRepository.deleteOlderThan(cutoffDate);

        this.logger.log(
            `Cleaned up ${deletedCount} chat sessions older than ${cutoffDate.toISOString()}`,
        );

        return { deletedCount };
    }
}

// Backward-compatible name (some parts of the codebase use "Usecase")
export class CleanupChatSessionsUsecase extends CleanupChatSessionsUseCase {}
