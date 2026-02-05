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

    async create(organizationid: string, params: CreateMessageTemplateParams): Promise<MessageTemplateEntity> {
        return this.createMessageTemplateUsecase.execute(organizationid, params);
    }

    async update(
        organizationid: string,
        id: string,
        params: UpdateMessageTemplateParams
    ): Promise<MessageTemplateEntity> {
        return this.updateMessageTemplateUsecase.execute(organizationid, id, params);
    }

    async delete(organizationid: string, id: string): Promise<void> {
        return this.deleteMessageTemplateUsecase.execute(organizationid, id);
    }

    async findAll(organizationid: string): Promise<MessageTemplateEntity[]> {
        return this.listMessageTemplatesUsecase.execute(organizationid);
    }

    async findById(organizationid: string, id: string): Promise<MessageTemplateEntity> {
        return this.findMessageTemplateByIdUsecase.execute(organizationid, id);
    }
}
