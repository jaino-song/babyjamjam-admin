import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository, MESSAGE_TEMPLATE_REPOSITORY } from "domain/repositories/message-template.repository.interface";

@Injectable()
export class GetMessageTemplateUsecase {
    constructor(
        @Inject(MESSAGE_TEMPLATE_REPOSITORY)
        private readonly repository: IMessageTemplateRepository,
    ) {}

    async execute(organizationid: string, id: string): Promise<MessageTemplateEntity> {
        const entity = await this.repository.findById(organizationid, id);
        if (!entity) {
            throw new NotFoundException(`Template with id ${id} not found`);
        }
        return entity;
    }
}
