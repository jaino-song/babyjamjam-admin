import { MessageEntity } from "../entities/message.entity";

export interface IMessageRepository {
    findAll(branchid: string): Promise<MessageEntity[]>;
    findById(branchid: string, id: number): Promise<MessageEntity | null>;
    create(branchid: string, message: MessageEntity): Promise<MessageEntity>;
    update(branchid: string, message: MessageEntity): Promise<MessageEntity>;
    delete(branchid: string, id: number): Promise<void>;
}

export const MESSAGE_REPOSITORY = 'MESSAGE_REPOSITORY';
