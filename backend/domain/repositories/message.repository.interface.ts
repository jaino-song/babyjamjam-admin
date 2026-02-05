import { MessageEntity } from "../entities/message.entity";

export interface IMessageRepository {
    findById(organizationid: string, id: number): Promise<MessageEntity | null>;
    create(organizationid: string, message: MessageEntity): Promise<MessageEntity>;
    update(organizationid: string, message: MessageEntity): Promise<MessageEntity>;
    delete(organizationid: string, id: number): Promise<void>;
}

export const MESSAGE_REPOSITORY = 'MESSAGE_REPOSITORY';
