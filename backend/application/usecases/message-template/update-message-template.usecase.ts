import { Inject, Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { MessageTemplateEntity, TemplateVariable } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository, MESSAGE_TEMPLATE_REPOSITORY } from "domain/repositories/message-template.repository.interface";

export type UpdateMessageTemplateParams = {
    name?: string;
    content?: string;
    variables?: TemplateVariable[];
};

@Injectable()
export class UpdateMessageTemplateUsecase {
    constructor(
        @Inject(MESSAGE_TEMPLATE_REPOSITORY)
        private readonly messageTemplateRepository: IMessageTemplateRepository,
    ) {}

    async execute(id: string, params: UpdateMessageTemplateParams): Promise<MessageTemplateEntity> {
        const existing = await this.messageTemplateRepository.findById(id);
        if (!existing) {
            throw new NotFoundException(`Template with id ${id} not found`);
        }

        existing.update(params);

        const validation = existing.validateVariables();
        if (!validation.valid) {
            throw new BadRequestException(validation.errors.join(", "));
        }

        return this.messageTemplateRepository.update(existing);
    }
}
