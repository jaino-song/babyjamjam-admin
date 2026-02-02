import { MessageTemplateEntity } from "domain/entities/message-template.entity";

export interface IMessageTemplateRepository {
    findById(organizationid: string, id: string): Promise<MessageTemplateEntity | null>;
    findAll(organizationid: string): Promise<MessageTemplateEntity[]>;
    create(organizationid: string, template: MessageTemplateEntity): Promise<MessageTemplateEntity>;
    update(organizationid: string, template: MessageTemplateEntity): Promise<MessageTemplateEntity>;
    delete(organizationid: string, id: string): Promise<void>;
}

export const MESSAGE_TEMPLATE_REPOSITORY = "MESSAGE_TEMPLATE_REPOSITORY";
