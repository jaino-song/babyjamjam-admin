import { Injectable, Inject, Logger } from "@nestjs/common";
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
import { IUserRepository, USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { EMAIL_PORT, EmailPort } from "domain/ports/email.port";
import { SystemSettingService } from "./system-setting.service";

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);

    constructor(
        private readonly subscribePushUsecase: SubscribePushUsecase,
        private readonly unsubscribePushUsecase: UnsubscribePushUsecase,
        private readonly sendNotificationUsecase: SendNotificationUsecase,
        private readonly getNotificationsUsecase: GetNotificationsUsecase,
        private readonly markNotificationReadUsecase: MarkNotificationReadUsecase,
        private readonly getVapidKeyUsecase: GetVapidKeyUsecase,
        @Inject(USER_REPOSITORY)
        private readonly userRepository: IUserRepository,
        @Inject(EMAIL_PORT)
        private readonly emailPort: EmailPort,
        private readonly systemSettingService: SystemSettingService,
    ) {}

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    private async sendEmailNotificationToUser(userId: string, title: string, body: string) {
        const user = await this.userRepository.findById(userId);
        if (!user?.email) {
            return;
        }

        const isEnabled = await this.systemSettingService.getUserEmailNotificationsEnabled(user.id);
        if (!isEnabled) {
            return;
        }

        const recipientName = this.escapeHtml(user.name ?? "사용자");
        const safeTitle = this.escapeHtml(title);
        const safeBody = this.escapeHtml(body).replace(/\n/g, "<br />");

        try {
            await this.emailPort.send({
                to: user.email,
                subject: `[아가잼잼] ${title}`,
                text: `${user.name ?? "사용자"}님, 새로운 알림이 도착했습니다.\n\n${title}\n${body}`,
                html: `
                  <div style="font-family: Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; line-height: 1.6; color: #17304d;">
                    <p style="margin: 0 0 12px;">${recipientName}님, 새로운 알림이 도착했습니다.</p>
                    <h1 style="margin: 0 0 12px; font-size: 18px; color: #12366a;">${safeTitle}</h1>
                    <p style="margin: 0;">${safeBody}</p>
                  </div>
                `,
            });
        } catch (error) {
            this.logger.error(
                `Failed to send notification email to user ${user.id}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    private async sendEmailNotificationsToUsers(userIds: string[], title: string, body: string) {
        await Promise.all(userIds.map((userId) => this.sendEmailNotificationToUser(userId, title, body)));
    }

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
    async sendNotification(
        organizationid: string,
        userId: string,
        title: string,
        body: string,
        data?: Record<string, unknown>,
    ): Promise<NotificationEntity> {
        const notification = await this.sendNotificationUsecase.execute(organizationid, { userId, title, body, data });
        await this.sendEmailNotificationToUser(userId, title, body);
        return notification;
    }

    async broadcastNotification(
        title: string,
        body: string,
        data?: Record<string, unknown>,
    ): Promise<{ sent: number; failed: number }> {
        const result = await this.sendNotificationUsecase.broadcast({ title, body, data });
        const users = await this.userRepository.findByRoles(["owner", "admin", "manager", "user"]);
        await this.sendEmailNotificationsToUsers(users.map((user) => user.id), title, body);
        return result;
    }

    // Get Notifications
    getNotifications(
        organizationid: string,
        userId: string,
        options?: { limit?: number; offset?: number },
    ): Promise<NotificationEntity[]> {
        return this.getNotificationsUsecase.execute(organizationid, userId, options);
    }

    getUnreadNotifications(organizationid: string, userId: string): Promise<NotificationEntity[]> {
        return this.getNotificationsUsecase.getUnread(organizationid, userId);
    }

    countUnreadNotifications(organizationid: string, userId: string): Promise<number> {
        return this.getNotificationsUsecase.countUnread(organizationid, userId);
    }

    // Mark as Read
    markAsRead(
        organizationid: string,
        notificationId: number,
        userId: string
    ): Promise<NotificationEntity> {
        return this.markNotificationReadUsecase.execute(organizationid, notificationId, userId);
    }

    markAllAsRead(organizationid: string, userId: string): Promise<void> {
        return this.markNotificationReadUsecase.markAllAsRead(organizationid, userId);
    }

    async sendToRoles(
        roles: string[],
        title: string,
        body: string,
        data?: Record<string, unknown>,
    ): Promise<{ sent: number; failed: number }> {
        const users = await this.userRepository.findByRoles(roles);
        if (users.length === 0) {
            return { sent: 0, failed: 0 };
        }
        const userIds = users.map(u => u.id);
        const result = await this.sendNotificationUsecase.sendToUsers({ userIds, title, body, data });
        await this.sendEmailNotificationsToUsers(userIds, title, body);
        return result;
    }
}
