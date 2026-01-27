import { MessageTemplateEntity, TemplateVariable } from "domain/entities/message-template.entity";
import { Prisma } from "@prisma/client";

type MessageTemplateRow = {
    id: string;
    name: string;
    content: string;
    variables: Prisma.JsonValue;
    created_at: Date;
    updated_at: Date;
};

export class MessageTemplateMapper {
    static toDomain(row: MessageTemplateRow): MessageTemplateEntity {
        const variables = (row.variables as unknown as TemplateVariable[]) || [];
        return MessageTemplateEntity.reconstitute(
            row.id,
            row.name,
            row.content,
            variables,
            row.created_at,
            row.updated_at,
        );
    }

    static toPrismaCreate(entity: MessageTemplateEntity): Prisma.message_templateCreateInput {
        return {
            name: entity.name,
            content: entity.content,
            variables: entity.variables as unknown as Prisma.InputJsonValue,
        };
    }

    static toPrismaUpdate(entity: MessageTemplateEntity): Prisma.message_templateUpdateInput {
        return {
            name: entity.name,
            content: entity.content,
            variables: entity.variables as unknown as Prisma.InputJsonValue,
        };
    }
}
