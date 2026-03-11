import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { CleanupNotificationsUsecase } from "application/usecases/notification";
import {
    IOrganizationRepository,
    ORGANIZATION_REPOSITORY,
} from "domain/repositories/organization.repository.interface";

const RETENTION_DAYS = 30;

@Injectable()
export class NotificationCleanupSchedulerService {
    private readonly logger = new Logger(NotificationCleanupSchedulerService.name);

    constructor(
        private readonly cleanupNotificationsUsecase: CleanupNotificationsUsecase,
        @Inject(ORGANIZATION_REPOSITORY)
        private readonly organizationRepository: IOrganizationRepository,
    ) {}

    @Cron("0 2 * * *", { timeZone: "Asia/Seoul" })
    async cleanupOldNotifications(): Promise<void> {
        this.logger.log("[Notification Cleanup] Starting cleanup...");

        try {
            const organizations = await this.organizationRepository.findAllActive();

            if (organizations.length === 0) {
                this.logger.log("[Notification Cleanup] No active organizations found");
                return;
            }

            let deletedCount = 0;
            for (const organization of organizations) {
                deletedCount += await this.cleanupNotificationsUsecase.execute(
                    organization.id,
                    RETENTION_DAYS,
                );
            }

            this.logger.log(
                `[Notification Cleanup] Deleted ${deletedCount} notifications older than ${RETENTION_DAYS} days across ${organizations.length} organizations`,
            );
        } catch (error) {
            this.logger.error("[Notification Cleanup] Failed to cleanup notifications", error);
        }
    }
}
