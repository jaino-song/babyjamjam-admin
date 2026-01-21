import { MessageTemplateEntity } from "domain/entities/message-template.entity";

export interface IMessageTemplateRepository {
    findById(id: string): Promise<MessageTemplateEntity | null>;
    findAll(): Promise<MessageTemplateEntity[]>;
    create(template: MessageTemplateEntity): Promise<MessageTemplateEntity>;
    update(template: MessageTemplateEntity): Promise<MessageTemplateEntity>;
    delete(id: string): Promise<void>;
}

export const MESSAGE_TEMPLATE_REPOSITORY = "MESSAGE_TEMPLATE_REPOSITORY";
