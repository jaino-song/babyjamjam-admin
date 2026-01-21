import { Injectable } from "@nestjs/common";
import {
    CreateMessageTemplateUsecase,
    UpdateMessageTemplateUsecase,
    DeleteMessageTemplateUsecase,
    ListMessageTemplatesUsecase,
    FindMessageTemplateByIdUsecase,
    CreateMessageTemplateParams,
    UpdateMessageTemplateParams,
} from "application/usecases/message-template";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";

@Injectable()
export class MessageTemplateService {
    constructor(
        private readonly createMessageTemplateUsecase: CreateMessageTemplateUsecase,
        private readonly updateMessageTemplateUsecase: UpdateMessageTemplateUsecase,
        private readonly deleteMessageTemplateUsecase: DeleteMessageTemplateUsecase,
        private readonly listMessageTemplatesUsecase: ListMessageTemplatesUsecase,
        private readonly findMessageTemplateByIdUsecase: FindMessageTemplateByIdUsecase,
    ) {}

    async create(params: CreateMessageTemplateParams): Promise<MessageTemplateEntity> {
        return this.createMessageTemplateUsecase.execute(params);
    }

    async update(id: string, params: UpdateMessageTemplateParams): Promise<MessageTemplateEntity> {
        return this.updateMessageTemplateUsecase.execute(id, params);
    }

    async delete(id: string): Promise<void> {
        return this.deleteMessageTemplateUsecase.execute(id);
    }

    async findAll(): Promise<MessageTemplateEntity[]> {
        return this.listMessageTemplatesUsecase.execute();
    }

    async findById(id: string): Promise<MessageTemplateEntity> {
        return this.findMessageTemplateByIdUsecase.execute(id);
    }
}
