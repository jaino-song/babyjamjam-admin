import { IMessageRepository } from "domain/repositories/message.repository.interface";
export declare class DeleteMessageUsecase {
    private readonly messageRepository;
    constructor(messageRepository: IMessageRepository);
    execute(id: number): Promise<void>;
}
