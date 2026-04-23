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

    async create(branchid: string, params: CreateMessageTemplateParams): Promise<MessageTemplateEntity> {
        return this.createMessageTemplateUsecase.execute(branchid, params);
    }

    async update(
        branchid: string,
        id: string,
        params: UpdateMessageTemplateParams
    ): Promise<MessageTemplateEntity> {
        return this.updateMessageTemplateUsecase.execute(branchid, id, params);
    }

    async delete(branchid: string, id: string): Promise<void> {
        return this.deleteMessageTemplateUsecase.execute(branchid, id);
    }

    async findAll(branchid: string): Promise<MessageTemplateEntity[]> {
        return this.listMessageTemplatesUsecase.execute(branchid);
    }

    async findById(branchid: string, id: string): Promise<MessageTemplateEntity> {
        return this.findMessageTemplateByIdUsecase.execute(branchid, id);
    }
}
