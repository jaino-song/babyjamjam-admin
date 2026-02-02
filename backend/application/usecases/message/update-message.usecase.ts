import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MessageEntity } from "domain/entities/message.entity";
import { IMessageRepository, MESSAGE_REPOSITORY } from "domain/repositories/message.repository.interface";

@Injectable()
export class UpdateMessageUsecase {
    constructor(
        @Inject(MESSAGE_REPOSITORY)
        private readonly messageRepository: IMessageRepository,
    ) {}

    async execute(
        organizationid: string,
        id: number,
        title: string,
        text: string
    ): Promise<MessageEntity> {
        const message = await this.messageRepository.findById(organizationid, id);
        if (!message) {
            throw new NotFoundException(`Message with id ${id} not found`);
        }

        message.edit(title, text);

        return this.messageRepository.update(organizationid, message);
    }
}
