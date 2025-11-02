import { MessageEntity } from "domain/entities/message.entity";
import { IMessageRepository } from "domain/repositories/message.repository.interface";
export declare class UpdateMessageUsecase {
    private readonly messageRepository;
    constructor(messageRepository: IMessageRepository);
    execute(id: number, title: string, text: string): Promise<MessageEntity>;
}
