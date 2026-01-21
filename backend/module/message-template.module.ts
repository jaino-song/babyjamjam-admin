import { Module } from "@nestjs/common";
import {
    CreateMessageTemplateUsecase,
    UpdateMessageTemplateUsecase,
    DeleteMessageTemplateUsecase,
    ListMessageTemplatesUsecase,
    FindMessageTemplateByIdUsecase,
} from "application/usecases/message-template";
import { MessageTemplateService } from "application/services/message-template.service";
import { MESSAGE_TEMPLATE_REPOSITORY } from "domain/repositories/message-template.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageTemplateRepository } from "infrastructure/database/repositories/message-template.repository";
import { MessageTemplateController } from "interface/controllers/message-template.controller";

@Module({
    controllers: [MessageTemplateController],
    providers: [
        CreateMessageTemplateUsecase,
        UpdateMessageTemplateUsecase,
        DeleteMessageTemplateUsecase,
        ListMessageTemplatesUsecase,
        FindMessageTemplateByIdUsecase,
        MessageTemplateService,
        PrismaService,
        {
            provide: MESSAGE_TEMPLATE_REPOSITORY,
            useClass: MessageTemplateRepository,
        },
    ],
    exports: [MessageTemplateService],
})
export class MessageTemplateModule {}
