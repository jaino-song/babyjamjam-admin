import { Module } from "@nestjs/common";
import {
    CreateMessageUsecase,
    DeleteMessageUsecase,
    FindMessageByIdUsecase,
    ListMessagesUsecase,
    UpdateMessageUsecase,
} from "application/usecases/message";
import { MessageService } from "application/services/message.service";
import { MESSAGE_REPOSITORY } from "domain/repositories/message.repository.interface";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbMessageRepository } from "infrastructure/database/repositories/sb.message.repository";
import { MessageController } from "interface/controllers/message.controller";

@Module({
    imports: [DatabaseModule],
    controllers: [MessageController],
    providers: [
        CreateMessageUsecase,
        ListMessagesUsecase,
        FindMessageByIdUsecase,
        UpdateMessageUsecase,
        DeleteMessageUsecase,
        MessageService,
        {
            provide: MESSAGE_REPOSITORY,
            useClass: SbMessageRepository,
        },
    ],
    exports: [MessageService],
})
export class MessageModule {}
