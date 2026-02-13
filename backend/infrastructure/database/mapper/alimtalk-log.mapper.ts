import { AlimtalkLogEntity, AlimtalkLogStatus } from "domain/entities/alimtalk-log.entity";
import { Prisma } from "@prisma/client";

type AlimtalkLogRow = {
    id: number;
    organizationId: string | null;
    provider: string;
    templateKey: string;
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

export class AlimtalkLogMapper {
    static toDomain(row: AlimtalkLogRow): AlimtalkLogEntity {
        return AlimtalkLogEntity.reconstitute(
            row.id,
            row.organizationId,
            row.provider,
            row.templateKey,
            row.receiver,
            row.clientId,
            row.messageBody,
            (row.variables as Record<string, string>) ?? {},
            row.status as AlimtalkLogStatus,
            row.aligoMid,
            row.errorMessage,
            row.attempts,
            row.lastAttemptAt,
            row.nextRetryAt,
            row.createdAt,
            row.updatedAt,
        );
    }

    static toPrismaCreate(entity: AlimtalkLogEntity) {
        return {
            organizationId: entity.organizationId,
            provider: entity.provider,
            templateKey: entity.templateKey,
            receiver: entity.receiver,
            clientId: entity.clientId,
            messageBody: entity.messageBody,
            variables: entity.variables as Prisma.InputJsonValue,
            status: entity.status,
        };
    }

    static toPrismaUpdate(entity: AlimtalkLogEntity) {
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
