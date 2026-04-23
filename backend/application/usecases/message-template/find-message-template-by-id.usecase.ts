import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository, MESSAGE_TEMPLATE_REPOSITORY } from "domain/repositories/message-template.repository.interface";

@Injectable()
export class FindMessageTemplateByIdUsecase {
    constructor(
        @Inject(MESSAGE_TEMPLATE_REPOSITORY)
        private readonly messageTemplateRepository: IMessageTemplateRepository,
    ) {}

    async execute(branchid: string, id: string): Promise<MessageTemplateEntity> {
        const template = await this.messageTemplateRepository.findById(branchid, id);
        if (!template) {
            throw new NotFoundException(`Template with id ${id} not found`);
        }
        return template;
    }
}
