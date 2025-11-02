import { CreateMessageUsecase, DeleteMessageUsecase, FindMessageByIdUsecase, UpdateMessageUsecase } from "application/usecases/message";
import { MessageEntity } from "domain/entities/message.entity";
export declare class MessageService {
    private readonly createMessageUsecase;
    private readonly findMessageByIdUsecase;
    private readonly updateMessageUsecase;
    private readonly deleteMessageUsecase;
    constructor(createMessageUsecase: CreateMessageUsecase, findMessageByIdUsecase: FindMessageByIdUsecase, updateMessageUsecase: UpdateMessageUsecase, deleteMessageUsecase: DeleteMessageUsecase);
    create(title: string, text: string): Promise<MessageEntity>;
    findById(id: number): Promise<MessageEntity | null>;
    update(id: number, title: string, text: string): Promise<MessageEntity>;
    delete(id: number): Promise<void>;
}
