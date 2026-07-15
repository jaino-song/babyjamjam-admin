import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";

type PushSubscriptionRow = {
    id: number;
    userId: string;
    endpoint: string;
    p256dhKey: string;
    authKey: string;
    userAgent: string | null;
    createdAt: Date;
};

export class PushSubscriptionMapper {
    static toDomain(row: PushSubscriptionRow): PushSubscriptionEntity {
        return PushSubscriptionEntity.reconstitute(
            row.id,
            row.userId,
            row.endpoint,
            row.p256dhKey,
            row.authKey,
            row.userAgent,
            row.createdAt,
        );
    }

    static toPrismaCreate(entity: PushSubscriptionEntity) {
        return {
            userId: entity.userId,
            endpoint: entity.endpoint,
            p256dhKey: entity.p256dhKey,
            authKey: entity.authKey,
            userAgent: entity.userAgent,
        };
    }
}
