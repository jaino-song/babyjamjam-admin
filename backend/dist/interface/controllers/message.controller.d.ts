import { MessageService } from "application/services/message.service";
import { CreateMessageDto, UpdateMessageDto } from "interface/dto/message.dto";
export declare class MessageController {
    private readonly messageService;
    constructor(messageService: MessageService);
    create(dto: CreateMessageDto): Promise<import("../../domain/entities/message.entity").MessageEntity>;
    findById(id: string): Promise<import("../../domain/entities/message.entity").MessageEntity>;
    update(id: string, dto: UpdateMessageDto): Promise<import("../../domain/entities/message.entity").MessageEntity>;
    delete(id: string): Promise<void>;
}
