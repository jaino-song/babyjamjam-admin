import { MessageEntity } from "domain/entities/message.entity";

type MessageRow = {
    id: number;
    title: string | null;
    text: string | null;
    createdAt: Date;
    editedAt: Date | null;
};

export class MessageMapper {
    static toDomain(row: MessageRow): MessageEntity {
        return new MessageEntity(
            row.id,
            row.title || '',
            row.text || '',
            row.createdAt,
            row.editedAt,
        );
    }

    static toPrismaCreate(entity: MessageEntity) {
        return {
            title: entity.title,
            text: entity.text,
        };
    }

    static toPrismaUpdate(entity: MessageEntity) {
        return {
            title: entity.title,
            text: entity.text,
            editedAt: entity.editedAt,
        };
    }
}


