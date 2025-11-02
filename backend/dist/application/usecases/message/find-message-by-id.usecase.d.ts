import { MessageEntity } from "domain/entities/message.entity";
import { IMessageRepository } from "domain/repositories/message.repository.interface";
export declare class FindMessageByIdUsecase {
    private readonly messageRepository;
    constructor(messageRepository: IMessageRepository);
    execute(id: number): Promise<MessageEntity | null>;
}
