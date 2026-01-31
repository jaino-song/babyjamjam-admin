import { Module } from "@nestjs/common";
import { CHAT_SESSION_REPOSITORY } from "domain/repositories/chat-session.repository.interface";
import { SbChatSessionRepository } from "infrastructure/database/repositories/sb.chat-session.repository";
import { ChatFeedbackRepository } from "infrastructure/database/repositories/chat-feedback.repository";
import { PrismaService } from "infrastructure/database/prisma.service";

@Module({
    providers: [
        PrismaService,
        ChatFeedbackRepository,
        {
            provide: CHAT_SESSION_REPOSITORY,
            useClass: SbChatSessionRepository,
        },
    ],
    exports: [CHAT_SESSION_REPOSITORY, ChatFeedbackRepository, PrismaService],
})
export class ChatSessionModule {}
