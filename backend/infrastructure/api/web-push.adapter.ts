import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as webpush from "web-push";
import { IWebPushPort } from "domain/ports/web-push.port";
import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";

/**
 * Web Push Adapter
 *
 * web-push 라이브러리를 사용한 IWebPushPort 구현체.
 * VAPID 키로 서버 인증, 브라우저 Push Service에 알림 전송.
 */
@Injectable()
export class WebPushAdapter implements IWebPushPort {
    private readonly logger = new Logger(WebPushAdapter.name);
    private readonly vapidPublicKey: string;
    private readonly vapidPrivateKey: string;

    constructor(private configService: ConfigService) {
        this.vapidPublicKey = this.configService.getOrThrow<string>('VAPID_PUBLIC_KEY');
        this.vapidPrivateKey = this.configService.getOrThrow<string>('VAPID_PRIVATE_KEY');

        const vapidEmail = this.configService.get<string>('VAPID_EMAIL') || 'admin@example.com';

        // VAPID 설정 초기화
        webpush.setVapidDetails(
            `mailto:${vapidEmail}`,
            this.vapidPublicKey,
            this.vapidPrivateKey,
        );

        this.logger.log('Web Push adapter initialized with VAPID credentials');
    }

    async sendNotification(
        subscription: PushSubscriptionEntity,
        payload: string,
    ): Promise<boolean> {
        try {
            await webpush.sendNotification(
                subscription.toWebPushSubscription(),
                payload,
                {
                    TTL: 60 * 60 * 24, // 24 hours
                    urgency: 'normal',
                },
            );
            this.logger.debug(`Push notification sent to endpoint: ${subscription.endpoint.substring(0, 50)}...`);
            return true;
        } catch (error: unknown) {
            const webPushError = error as { statusCode?: number; body?: string };
            // 410 Gone = subscription expired/invalid, should be removed
            // 404 Not Found = subscription no longer valid
            if (webPushError.statusCode === 410 || webPushError.statusCode === 404) {
                this.logger.warn(`Subscription expired or invalid: ${subscription.endpoint.substring(0, 50)}...`);
                return false;
            }
            this.logger.error(`Failed to send push notification: ${webPushError.body || webPushError}`);
            return false;
        }
    }

    async sendNotificationToMany(
        subscriptions: PushSubscriptionEntity[],
        payload: string,
    ): Promise<Map<string, boolean>> {
        const results = new Map<string, boolean>();

        // 병렬로 전송하되 동시 연결 수 제한 (10개씩)
        const batchSize = 10;
        for (let i = 0; i < subscriptions.length; i += batchSize) {
            const batch = subscriptions.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(async (sub) => {
                    const success = await this.sendNotification(sub, payload);
                    return { endpoint: sub.endpoint, success };
                }),
            );
            batchResults.forEach(({ endpoint, success }) => {
                results.set(endpoint, success);
            });
        }

        const successCount = Array.from(results.values()).filter(Boolean).length;
        this.logger.log(`Sent notifications: ${successCount}/${subscriptions.length} successful`);

        return results;
    }

    getVapidPublicKey(): string {
        return this.vapidPublicKey;
    }
}
