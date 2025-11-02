import { MessageEntity } from "domain/entities/message.entity";
import { IMessageRepository } from "domain/repositories/message.repository.interface";
export declare class CreateMessageUsecase {
    private readonly messageRepository;
    constructor(messageRepository: IMessageRepository);
    execute(title: string, text: string): Promise<MessageEntity>;
}
