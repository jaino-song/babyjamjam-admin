import { Injectable } from "@nestjs/common";
import {
    CreateMessageUsecase,
    DeleteMessageUsecase,
    FindMessageByIdUsecase,
    UpdateMessageUsecase,
} from "application/usecases/message";
import { MessageEntity } from "domain/entities/message.entity";

@Injectable()
export class MessageService {
    constructor(
        private readonly createMessageUsecase: CreateMessageUsecase,
        private readonly findMessageByIdUsecase: FindMessageByIdUsecase,
        private readonly updateMessageUsecase: UpdateMessageUsecase,
        private readonly deleteMessageUsecase: DeleteMessageUsecase,
    ) {}

    create(organizationid: string, title: string, text: string): Promise<MessageEntity> {
        return this.createMessageUsecase.execute(organizationid, title, text);
    }

    findById(organizationid: string, id: number): Promise<MessageEntity | null> {
        return this.findMessageByIdUsecase.execute(organizationid, id);
    }

    update(organizationid: string, id: number, title: string, text: string): Promise<MessageEntity> {
        return this.updateMessageUsecase.execute(organizationid, id, title, text);
    }

    delete(organizationid: string, id: number): Promise<void> {
        return this.deleteMessageUsecase.execute(organizationid, id);
    }
}
