/**
 * PushSubscription Entity
 *
 * Web Push API 구독 정보를 저장하는 엔티티.
 * 브라우저에서 생성된 PushSubscription 객체의 필수 정보를 포함.
 */
export class PushSubscriptionEntity {
    constructor(
        public readonly id: number,
        public readonly userId: string,
        public readonly endpoint: string,      // Push service endpoint URL (FCM, Mozilla, etc.)
        public readonly p256dhKey: string,     // Public key for message encryption
        public readonly authKey: string,       // Auth secret for encryption
        public readonly userAgent: string | null,
        public readonly createdAt: Date,
    ) {}

    /**
     * Create a new subscription from browser PushSubscription object
     */
    static create(
        userId: string,
        endpoint: string,
        p256dhKey: string,
        authKey: string,
        userAgent?: string,
    ): PushSubscriptionEntity {
        return new PushSubscriptionEntity(
            0, // ID assigned by database
            userId,
            endpoint,
            p256dhKey,
            authKey,
            userAgent || null,
            new Date(),
        );
    }

    /**
     * Reconstitute from persistence layer
     */
    static reconstitute(
        id: number,
        userId: string,
        endpoint: string,
        p256dhKey: string,
        authKey: string,
        userAgent: string | null,
        createdAt: Date,
    ): PushSubscriptionEntity {
        return new PushSubscriptionEntity(
            id,
            userId,
            endpoint,
            p256dhKey,
            authKey,
            userAgent,
            createdAt,
        );
    }

    /**
     * Convert to web-push library format
     */
    toWebPushSubscription(): { endpoint: string; keys: { p256dh: string; auth: string } } {
        return {
            endpoint: this.endpoint,
            keys: {
                p256dh: this.p256dhKey,
                auth: this.authKey,
            },
        };
    }
}
