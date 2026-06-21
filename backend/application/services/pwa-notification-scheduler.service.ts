import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationService } from "./notification.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { BRANCH_REPOSITORY, IBranchRepository } from "domain/repositories/branch.repository.interface";

const TARGET_ROLES = ['admin', 'manager', 'user'];
const DAYS_THRESHOLD = 7;

// Resolve the login URL from the same per-env vars auth.controller's resolveFrontendURL uses,
// so the email CTA stays in sync with the deployed frontend domain. Fallback covers test/dev
// runs where the env vars are not set; production picks up PRODUCTION_FRONTEND_URL.
function resolveNotificationLoginUrl(): string {
    const nodeEnv = process.env['NODE_ENV'];
    const base = nodeEnv === "production" ? process.env['PRODUCTION_FRONTEND_URL']
        : nodeEnv === "preview" ? process.env['PREVIEW_FRONTEND_URL']
        : process.env['DEVELOPMENT_FRONTEND_URL'];
    const normalized = (base ?? "https://admin.babyjamjam.com").trim().replace(/\/+$/, "");
    return `${normalized}/login`;
}

const NOTIFICATION_EMAIL_CONTEXT = {
    ctaUrl: resolveNotificationLoginUrl(),
    ctaLabel: "로그인해서 확인하기",
};

@Injectable()
export class PwaNotificationSchedulerService {
    private readonly logger = new Logger(PwaNotificationSchedulerService.name);

    constructor(
        private readonly notificationService: NotificationService,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        @Inject(BRANCH_REPOSITORY)
        private readonly branchRepository: IBranchRepository,
    ) {}

    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async sendDailySummaryNotifications(): Promise<void> {
        this.logger.log("[PWA Scheduler] Starting daily summary notifications...");

        const branches = await this.branchRepository.findAllActive();

        for (const org of branches) {
            this.logger.log(`[PWA Scheduler] Processing org: ${org.name} (${org.id})`);
            await Promise.allSettled([
                this.notifyUpcomingServices(org.id),
                this.notifyEndingServices(org.id),
                this.notifyIncompleteContracts(org.id),
                this.notifyContractsNotSent(org.id),
            ]);
        }

        this.logger.log("[PWA Scheduler] Daily summary notifications completed");
    }

    private async notifyUpcomingServices(branchId: string): Promise<void> {
        try {
            const clients = await this.clientRepository.findStartingWithinDays(
                branchId,
                DAYS_THRESHOLD
            );

            if (clients.length === 0) {
                this.logger.log("[PWA Scheduler] No upcoming services within 7 days");
                return;
            }

            const result = await this.notificationService.sendToRoles(
                TARGET_ROLES,
                "서비스 시작 예정",
                `현재 7일 내로 시작이 예정된 서비스가 ${clients.length}건 있어요. 로그인해서 확인해 보세요.`,
                { url: "/clients/filtered?filter=starting-soon" },
                NOTIFICATION_EMAIL_CONTEXT,
            );

            this.logger.log(`[PWA Scheduler] Upcoming services notification: ${result.sent} sent, ${result.failed} failed`);
        } catch (error) {
            this.logger.error("[PWA Scheduler] Failed to send upcoming services notification", error);
        }
    }

    private async notifyEndingServices(branchId: string): Promise<void> {
        try {
            const clients = await this.clientRepository.findEndingWithinDays(
                branchId,
                DAYS_THRESHOLD
            );

            if (clients.length === 0) {
                this.logger.log("[PWA Scheduler] No ending services within 7 days");
                return;
            }

            const result = await this.notificationService.sendToRoles(
                TARGET_ROLES,
                "서비스 종료 예정",
                `현재 7일 내로 종료가 예정된 서비스가 ${clients.length}건 있어요. 필요한 후속 조치가 있는지 로그인해서 확인해 보세요.`,
                { url: "/clients/filtered?filter=ending-soon" },
                NOTIFICATION_EMAIL_CONTEXT,
            );

            this.logger.log(`[PWA Scheduler] Ending services notification: ${result.sent} sent, ${result.failed} failed`);
        } catch (error) {
            this.logger.error("[PWA Scheduler] Failed to send ending services notification", error);
        }
    }

    private async notifyIncompleteContracts(branchId: string): Promise<void> {
        try {
            const clients = await this.clientRepository.findWithIncompleteContractsStartingWithinDays(
                branchId,
                DAYS_THRESHOLD
            );

            if (clients.length === 0) {
                this.logger.log("[PWA Scheduler] No incomplete contracts for upcoming services");
                return;
            }

            const result = await this.notificationService.sendToRoles(
                TARGET_ROLES,
                "⚠️ 계약서 미완료",
                `서비스 시작이 예정되어 있지만 아직 완료되지 않은 계약서가 ${clients.length}건 있어요. 고객 응대 전에 계약서 상태를 로그인해서 확인해 보세요.`,
                { url: "/clients/filtered?filter=incomplete-contracts" },
                NOTIFICATION_EMAIL_CONTEXT,
            );

            this.logger.log(`[PWA Scheduler] Incomplete contracts notification: ${result.sent} sent, ${result.failed} failed`);
        } catch (error) {
            this.logger.error("[PWA Scheduler] Failed to send incomplete contracts notification", error);
        }
    }

    private async notifyContractsNotSent(branchId: string): Promise<void> {
        try {
            const clients = await this.clientRepository.findWithoutContractSentStartingWithinDays(
                branchId,
                DAYS_THRESHOLD
            );

            if (clients.length === 0) {
                this.logger.log("[PWA Scheduler] No clients without contracts sent");
                return;
            }

            for (const client of clients) {
                await this.notificationService.sendToRoles(
                    TARGET_ROLES,
                    "📄 계약서 미발송",
                    `${client.name} 님에게 아직 계약서가 발송되지 않았어요. 서비스 일정 전에 계약서를 발송할 수 있도록 로그인해서 확인해 보세요.`,
                    { url: `/clients?id=${client.id}` },
                    NOTIFICATION_EMAIL_CONTEXT,
                );
            }

            this.logger.log(`[PWA Scheduler] Contracts not sent notification: ${clients.length} clients notified`);
        } catch (error) {
            this.logger.error("[PWA Scheduler] Failed to send contracts not sent notification", error);
        }
    }

}
