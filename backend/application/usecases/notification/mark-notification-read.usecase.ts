import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    INotificationRepository,
    NOTIFICATION_REPOSITORY,
} from "domain/repositories/notification.repository.interface";
import { NotificationEntity } from "domain/entities/notification.entity";

/**
 * Mark Notification Read Use Case
 *
 * 알림을 읽음 처리.
 */
@Injectable()
export class MarkNotificationReadUsecase {
    constructor(
        @Inject(NOTIFICATION_REPOSITORY)
        private notificationRepository: INotificationRepository,
    ) {}

    async execute(
        branchid: string,
        notificationId: number,
        userId: string
    ): Promise<NotificationEntity> {
        const notification = await this.notificationRepository.findById(branchid, notificationId);

        if (!notification) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        // 본인의 알림인지 확인. 타인의 알림은 존재하지 않는 것과 같이 404로
        // 응답해 알림 식별자의 존재 여부를 노출하지 않는다.
        if (notification.userId !== userId) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        if (notification.readAt) return notification;
        return this.notificationRepository.updateReadAt(branchid, notificationId, new Date());
    }

    async markAllAsRead(branchid: string, userId: string): Promise<void> {
        await this.notificationRepository.markAllAsReadByUserId(branchid, userId);
    }
}
