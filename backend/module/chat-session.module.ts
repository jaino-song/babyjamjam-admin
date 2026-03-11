import { Module } from "@nestjs/common";
import { CHAT_SESSION_REPOSITORY } from "domain/repositories/chat-session.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbChatSessionRepository } from "infrastructure/database/repositories/sb.chat-session.repository";
import { ChatFeedbackRepository } from "infrastructure/database/repositories/chat-feedback.repository";

@Module({
    imports: [DatabaseModule],
    providers: [
        ChatFeedbackRepository,
        {
            provide: CHAT_SESSION_REPOSITORY,
            useClass: SbChatSessionRepository,
        },
    ],
    exports: [CHAT_SESSION_REPOSITORY, ChatFeedbackRepository],
})
export class ChatSessionModule {}
