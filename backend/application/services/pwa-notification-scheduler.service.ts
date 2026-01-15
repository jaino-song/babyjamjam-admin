import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationService } from "./notification.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

const TARGET_ROLES = ['admin', 'manager', 'user'];
const DAYS_THRESHOLD = 7;

@Injectable()
export class PwaNotificationSchedulerService {
    private readonly logger = new Logger(PwaNotificationSchedulerService.name);

    constructor(
        private readonly notificationService: NotificationService,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async sendDailySummaryNotifications(): Promise<void> {
        this.logger.log("[PWA Scheduler] Starting daily summary notifications...");

        await Promise.allSettled([
            this.notifyUpcomingServices(),
            this.notifyEndingServices(),
            this.notifyIncompleteContracts(),
        ]);

        this.logger.log("[PWA Scheduler] Daily summary notifications completed");
    }

    private async notifyUpcomingServices(): Promise<void> {
        try {
            const clients = await this.clientRepository.findStartingWithinDays(DAYS_THRESHOLD);

            if (clients.length === 0) {
                this.logger.log("[PWA Scheduler] No upcoming services within 7 days");
                return;
            }

            const result = await this.notificationService.sendToRoles(
                TARGET_ROLES,
                "서비스 시작 예정",
                `일주일 내로 시작되는 서비스 ${clients.length}건을 확인해 보세요`,
                { url: "/clients?filter=starting-soon" },
            );

            this.logger.log(`[PWA Scheduler] Upcoming services notification: ${result.sent} sent, ${result.failed} failed`);
        } catch (error) {
            this.logger.error("[PWA Scheduler] Failed to send upcoming services notification", error);
        }
    }

    private async notifyEndingServices(): Promise<void> {
        try {
            const clients = await this.clientRepository.findEndingWithinDays(DAYS_THRESHOLD);

            if (clients.length === 0) {
                this.logger.log("[PWA Scheduler] No ending services within 7 days");
                return;
            }

            const result = await this.notificationService.sendToRoles(
                TARGET_ROLES,
                "서비스 종료 예정",
                `일주일 내로 종료되는 서비스 ${clients.length}건을 확인해 보세요`,
                { url: "/clients?filter=ending-soon" },
            );

            this.logger.log(`[PWA Scheduler] Ending services notification: ${result.sent} sent, ${result.failed} failed`);
        } catch (error) {
            this.logger.error("[PWA Scheduler] Failed to send ending services notification", error);
        }
    }

    private async notifyIncompleteContracts(): Promise<void> {
        try {
            const clients = await this.clientRepository.findWithIncompleteContractsStartingWithinDays(DAYS_THRESHOLD);

            if (clients.length === 0) {
                this.logger.log("[PWA Scheduler] No incomplete contracts for upcoming services");
                return;
            }

            const result = await this.notificationService.sendToRoles(
                TARGET_ROLES,
                "⚠️ 계약서 미완료",
                `서비스 시작 예정이지만 계약서가 미완료된 클라이언트 ${clients.length}건이 있습니다`,
                { url: "/clients?filter=incomplete-contracts" },
            );

            this.logger.log(`[PWA Scheduler] Incomplete contracts notification: ${result.sent} sent, ${result.failed} failed`);
        } catch (error) {
            this.logger.error("[PWA Scheduler] Failed to send incomplete contracts notification", error);
        }
    }
}
