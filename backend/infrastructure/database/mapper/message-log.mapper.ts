import { Prisma } from "@prisma/client";

import { MessageLogEntity, MessageLogStatus } from "domain/entities/message-log.entity";

type MessageLogRow = {
    id: number;
    branchId: string | null;
    provider: string;
    templateKey: string;
    triggerJobId: string | null;
    receiver: string;
    clientId: number | null;
    messageBody: string;
    variables: Prisma.JsonValue;
    status: string;
    aligoMid: string | null;
    errorMessage: string | null;
    attempts: number;
    lastAttemptAt: Date | null;
    nextRetryAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export class MessageLogMapper {
    static toDomain(row: MessageLogRow): MessageLogEntity {
        return MessageLogEntity.reconstitute(
            row.id,
            row.branchId,
            row.provider,
            row.templateKey,
            row.triggerJobId,
            row.receiver,
            row.clientId,
            row.messageBody,
            (row.variables as Record<string, string>) ?? {},
            row.status as MessageLogStatus,
            row.aligoMid,
            row.errorMessage,
            row.attempts,
            row.lastAttemptAt,
            row.nextRetryAt,
            row.createdAt,
            row.updatedAt,
        );
    }

    static toPrismaCreate(entity: MessageLogEntity) {
        return {
            branchId: entity.branchId,
            provider: entity.provider,
            templateKey: entity.templateKey,
            triggerJobId: entity.triggerJobId,
            receiver: entity.receiver,
            clientId: entity.clientId,
            messageBody: entity.messageBody,
            variables: entity.variables as Prisma.InputJsonValue,
            status: entity.status,
            aligoMid: entity.aligoMid,
            errorMessage: entity.errorMessage,
            attempts: entity.attempts,
            lastAttemptAt: entity.lastAttemptAt,
            nextRetryAt: entity.nextRetryAt,
        };
    }

    static toPrismaUpdate(entity: MessageLogEntity) {
        return {
            status: entity.status,
            aligoMid: entity.aligoMid,
            errorMessage: entity.errorMessage,
            attempts: entity.attempts,
            lastAttemptAt: entity.lastAttemptAt,
            nextRetryAt: entity.nextRetryAt,
        };
    }
}
