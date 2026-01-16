import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { CleanupNotificationsUsecase } from "application/usecases/notification";

const RETENTION_DAYS = 30;

@Injectable()
export class NotificationCleanupSchedulerService {
    private readonly logger = new Logger(NotificationCleanupSchedulerService.name);

    constructor(
        private readonly cleanupNotificationsUsecase: CleanupNotificationsUsecase,
    ) {}

    @Cron("0 2 * * *", { timeZone: "Asia/Seoul" })
    async cleanupOldNotifications(): Promise<void> {
        this.logger.log("[Notification Cleanup] Starting cleanup...");

        try {
            const deletedCount = await this.cleanupNotificationsUsecase.execute(RETENTION_DAYS);
            this.logger.log(`[Notification Cleanup] Deleted ${deletedCount} notifications older than ${RETENTION_DAYS} days`);
        } catch (error) {
            this.logger.error("[Notification Cleanup] Failed to cleanup notifications", error);
        }
    }
}
