import { IMessageRepository } from "domain/repositories/message.repository.interface";
import { MessageEntity } from "domain/entities/message.entity";
import { PrismaService } from "../prisma.service";
export declare class SbMessageRepository implements IMessageRepository {
    private prismaService;
    constructor(prismaService: PrismaService);
    findById(id: number): Promise<MessageEntity | null>;
    create(message: MessageEntity): Promise<MessageEntity>;
    update(message: MessageEntity): Promise<MessageEntity>;
    delete(id: number): Promise<void>;
}
