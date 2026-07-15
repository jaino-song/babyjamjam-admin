import { Injectable } from "@nestjs/common";
import {
    CreateMessageUsecase,
    DeleteMessageUsecase,
    FindMessageByIdUsecase,
    ListMessagesUsecase,
    UpdateMessageUsecase,
} from "application/usecases/message";
import { MessageEntity } from "domain/entities/message.entity";

@Injectable()
export class MessageService {
    constructor(
        private readonly createMessageUsecase: CreateMessageUsecase,
        private readonly listMessagesUsecase: ListMessagesUsecase,
        private readonly findMessageByIdUsecase: FindMessageByIdUsecase,
        private readonly updateMessageUsecase: UpdateMessageUsecase,
        private readonly deleteMessageUsecase: DeleteMessageUsecase,
    ) {}

    findAll(branchid: string): Promise<MessageEntity[]> {
        return this.listMessagesUsecase.execute(branchid);
    }

    create(branchid: string, title: string, text: string): Promise<MessageEntity> {
        return this.createMessageUsecase.execute(branchid, title, text);
    }

    findById(branchid: string, id: number): Promise<MessageEntity | null> {
        return this.findMessageByIdUsecase.execute(branchid, id);
    }

    update(branchid: string, id: number, title: string, text: string): Promise<MessageEntity> {
        return this.updateMessageUsecase.execute(branchid, id, title, text);
    }

    delete(branchid: string, id: number): Promise<void> {
        return this.deleteMessageUsecase.execute(branchid, id);
    }
}
