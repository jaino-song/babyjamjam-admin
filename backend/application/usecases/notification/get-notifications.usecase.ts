import { Injectable, Inject } from "@nestjs/common";
import {
    INotificationRepository,
    NOTIFICATION_REPOSITORY,
} from "domain/repositories/notification.repository.interface";
import { NotificationEntity } from "domain/entities/notification.entity";

/**
 * Get Notifications Use Case
 *
 * 사용자의 알림 목록 조회.
 */
@Injectable()
export class GetNotificationsUsecase {
    constructor(
        @Inject(NOTIFICATION_REPOSITORY)
        private notificationRepository: INotificationRepository,
    ) {}

    async execute(
        organizationid: string,
        userId: string,
        options?: { limit?: number; offset?: number },
    ): Promise<NotificationEntity[]> {
        return this.notificationRepository.findByUserId(organizationid, userId, options);
    }

    async getUnread(organizationid: string, userId: string): Promise<NotificationEntity[]> {
        return this.notificationRepository.findUnreadByUserId(organizationid, userId);
    }

    async countUnread(organizationid: string, userId: string): Promise<number> {
        return this.notificationRepository.countUnreadByUserId(organizationid, userId);
    }
}
