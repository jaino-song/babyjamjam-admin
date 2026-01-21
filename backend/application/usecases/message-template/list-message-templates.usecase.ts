import { Inject, Injectable } from "@nestjs/common";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository, MESSAGE_TEMPLATE_REPOSITORY } from "domain/repositories/message-template.repository.interface";

@Injectable()
export class ListMessageTemplatesUsecase {
    constructor(
        @Inject(MESSAGE_TEMPLATE_REPOSITORY)
        private readonly messageTemplateRepository: IMessageTemplateRepository,
    ) {}

    async execute(): Promise<MessageTemplateEntity[]> {
        return this.messageTemplateRepository.findAll();
    }
}
