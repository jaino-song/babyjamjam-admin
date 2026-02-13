import { Inject, Injectable } from "@nestjs/common";
import { MessageEntity } from "domain/entities/message.entity";
import { IMessageRepository, MESSAGE_REPOSITORY } from "domain/repositories/message.repository.interface";

@Injectable()
export class ListMessagesUsecase {
    constructor(
        @Inject(MESSAGE_REPOSITORY)
        private readonly messageRepository: IMessageRepository,
    ) {}

    execute(organizationid: string): Promise<MessageEntity[]> {
        return this.messageRepository.findAll(organizationid);
    }
}
