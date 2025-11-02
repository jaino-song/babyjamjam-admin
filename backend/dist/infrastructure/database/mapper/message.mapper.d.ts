import { MessageEntity } from "domain/entities/message.entity";
type MessageRow = {
    id: number;
    title: string | null;
    text: string | null;
    created_at: Date;
    edited_at: Date | null;
};
export declare class MessageMapper {
    static toDomain(row: MessageRow): MessageEntity;
    static toPrismaCreate(entity: MessageEntity): {
        title: string;
        text: string;
    };
    static toPrismaUpdate(entity: MessageEntity): {
        title: string;
        text: string;
        edited_at: Date;
    };
}
export {};
