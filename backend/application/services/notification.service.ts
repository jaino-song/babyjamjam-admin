import { Injectable } from "@nestjs/common";
import {
    SubscribePushUsecase,
    UnsubscribePushUsecase,
    SendNotificationUsecase,
    GetNotificationsUsecase,
    MarkNotificationReadUsecase,
    GetVapidKeyUsecase,
} from "application/usecases/notification";
import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";
import { NotificationEntity } from "domain/entities/notification.entity";

@Injectable()
export class NotificationService {
    constructor(
        private readonly subscribePushUsecase: SubscribePushUsecase,
        private readonly unsubscribePushUsecase: UnsubscribePushUsecase,
        private readonly sendNotificationUsecase: SendNotificationUsecase,
        private readonly getNotificationsUsecase: GetNotificationsUsecase,
        private readonly markNotificationReadUsecase: MarkNotificationReadUsecase,
        private readonly getVapidKeyUsecase: GetVapidKeyUsecase,
    ) {}

    // VAPID Key
    getVapidPublicKey(): string {
        return this.getVapidKeyUsecase.execute();
    }

    // Push Subscription
    subscribePush(
        userId: string,
        endpoint: string,
        p256dhKey: string,
        authKey: string,
        userAgent?: string,
    ): Promise<PushSubscriptionEntity> {
        return this.subscribePushUsecase.execute(userId, endpoint, p256dhKey, authKey, userAgent);
    }

    unsubscribePush(endpoint: string): Promise<void> {
        return this.unsubscribePushUsecase.execute(endpoint);
    }

    // Send Notifications
    sendNotification(
        userId: string,
        title: string,
        body: string,
        data?: Record<string, unknown>,
    ): Promise<NotificationEntity> {
        return this.sendNotificationUsecase.execute({ userId, title, body, data });
    }

    broadcastNotification(
        title: string,
        body: string,
        data?: Record<string, unknown>,
    ): Promise<{ sent: number; failed: number }> {
        return this.sendNotificationUsecase.broadcast({ title, body, data });
    }

    // Get Notifications
    getNotifications(
        userId: string,
        options?: { limit?: number; offset?: number },
    ): Promise<NotificationEntity[]> {
        return this.getNotificationsUsecase.execute(userId, options);
    }

    getUnreadNotifications(userId: string): Promise<NotificationEntity[]> {
        return this.getNotificationsUsecase.getUnread(userId);
    }

    countUnreadNotifications(userId: string): Promise<number> {
        return this.getNotificationsUsecase.countUnread(userId);
    }

    // Mark as Read
    markAsRead(notificationId: number, userId: string): Promise<NotificationEntity> {
        return this.markNotificationReadUsecase.execute(notificationId, userId);
    }

    markAllAsRead(userId: string): Promise<void> {
        return this.markNotificationReadUsecase.markAllAsRead(userId);
    }
}
