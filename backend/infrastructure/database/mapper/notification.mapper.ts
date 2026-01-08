import { NotificationEntity } from "domain/entities/notification.entity";
import { Prisma } from "@prisma/client";

type NotificationRow = {
    id: number;
    user_id: string;
    title: string;
    body: string;
    data: Prisma.JsonValue | null;
    sent_at: Date;
    read_at: Date | null;
};

export class NotificationMapper {
    static toDomain(row: NotificationRow): NotificationEntity {
        return NotificationEntity.reconstitute(
            row.id,
            row.user_id,
            row.title,
            row.body,
            row.data as Record<string, unknown> | null,
            row.sent_at,
            row.read_at,
        );
    }

    static toPrismaCreate(entity: NotificationEntity) {
        return {
            user_id: entity.userId,
            title: entity.title,
            body: entity.body,
            data: entity.data as Prisma.InputJsonValue | undefined,
        };
    }

    static toPrismaUpdate(entity: NotificationEntity) {
        return {
            read_at: entity.readAt,
        };
    }
}
