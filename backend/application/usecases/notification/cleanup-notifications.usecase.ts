import { Injectable, Inject } from "@nestjs/common";
import {
    INotificationRepository,
    NOTIFICATION_REPOSITORY,
} from "domain/repositories/notification.repository.interface";

/**
 * Cleanup Notifications Use Case
 *
 * 오래된 알림을 정리하여 DB 용량 및 성능 관리.
 */
@Injectable()
export class CleanupNotificationsUsecase {
    constructor(
        @Inject(NOTIFICATION_REPOSITORY)
        private notificationRepository: INotificationRepository,
    ) {}

    /**
     * 지정된 일수보다 오래된 알림 삭제
     * @param days 보관 기간 (일)
     * @returns 삭제된 알림 개수
     */
    async execute(branchid: string, days: number): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        return this.notificationRepository.deleteOlderThan(branchid, cutoffDate);
    }
}
