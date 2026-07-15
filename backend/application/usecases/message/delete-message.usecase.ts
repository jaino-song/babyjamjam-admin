import { Inject, Injectable } from "@nestjs/common";
import { IMessageRepository, MESSAGE_REPOSITORY } from "domain/repositories/message.repository.interface";

@Injectable()
export class DeleteMessageUsecase {
    constructor(
        @Inject(MESSAGE_REPOSITORY)
        private readonly messageRepository: IMessageRepository,
    ) {}

    async execute(branchid: string, id: number): Promise<void> {
        await this.messageRepository.delete(branchid, id);
    }
}
