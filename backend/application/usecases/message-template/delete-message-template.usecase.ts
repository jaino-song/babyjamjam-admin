import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { IMessageTemplateRepository, MESSAGE_TEMPLATE_REPOSITORY } from "domain/repositories/message-template.repository.interface";

@Injectable()
export class DeleteMessageTemplateUsecase {
    constructor(
        @Inject(MESSAGE_TEMPLATE_REPOSITORY)
        private readonly messageTemplateRepository: IMessageTemplateRepository,
    ) {}

    async execute(id: string): Promise<void> {
        const existing = await this.messageTemplateRepository.findById(id);
        if (!existing) {
            throw new NotFoundException(`Template with id ${id} not found`);
        }

        await this.messageTemplateRepository.delete(id);
    }
}
