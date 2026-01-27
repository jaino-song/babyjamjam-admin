import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";

type PushSubscriptionRow = {
    id: number;
    user_id: string;
    endpoint: string;
    p256dh_key: string;
    auth_key: string;
    user_agent: string | null;
    created_at: Date;
};

export class PushSubscriptionMapper {
    static toDomain(row: PushSubscriptionRow): PushSubscriptionEntity {
        return PushSubscriptionEntity.reconstitute(
            row.id,
            row.user_id,
            row.endpoint,
            row.p256dh_key,
            row.auth_key,
            row.user_agent,
            row.created_at,
        );
    }

    static toPrismaCreate(entity: PushSubscriptionEntity) {
        return {
            user_id: entity.userId,
            endpoint: entity.endpoint,
            p256dh_key: entity.p256dhKey,
            auth_key: entity.authKey,
            user_agent: entity.userAgent,
        };
    }
}
