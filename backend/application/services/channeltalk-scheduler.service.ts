import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ChannelTalkService } from "./channeltalk.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

@Injectable()
export class ChannelTalkSchedulerService {
    private readonly logger = new Logger(ChannelTalkSchedulerService.name);

    constructor(
        private readonly channelTalkService: ChannelTalkService,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository
    ) {}

    /**
     * Check and send contract reminders (3 days and 1 day before service start)
     * Runs daily at 9 AM KST
     */
    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async checkContractReminders(): Promise<void> {
        this.logger.log("[Scheduler] Starting contract reminder check...");

        try {
            const now = new Date();

            // 3 days from now
            const threeDaysLater = new Date(now);
            threeDaysLater.setDate(threeDaysLater.getDate() + 3);

            // 1 day from now
            const oneDayLater = new Date(now);
            oneDayLater.setDate(oneDayLater.getDate() + 1);

            // Send 3-day reminders
            const clientsFor3Days = await this.clientRepository.findByStartDate(threeDaysLater);
            this.logger.log(`[Scheduler] Found ${clientsFor3Days.length} clients for 3-day reminder`);

            for (const client of clientsFor3Days) {
                try {
                    const serviceStartDate = this.formatDate(client.startDate!);
                    await this.channelTalkService.sendContractReminder3DaysAlimtalk(
                        client,
                        serviceStartDate
                    );
                } catch (error) {
                    this.logger.error(
                        `[Scheduler] Failed to send 3-day reminder for client ${client.id}`,
                        error instanceof Error ? error.stack : String(error)
                    );
                }
            }

            // Send 1-day reminders
            const clientsFor1Day = await this.clientRepository.findByStartDate(oneDayLater);
            this.logger.log(`[Scheduler] Found ${clientsFor1Day.length} clients for 1-day reminder`);

            for (const client of clientsFor1Day) {
                try {
                    const serviceStartDate = this.formatDate(client.startDate!);
                    await this.channelTalkService.sendContractReminder1DayAlimtalk(
                        client,
                        serviceStartDate
                    );
                } catch (error) {
                    this.logger.error(
                        `[Scheduler] Failed to send 1-day reminder for client ${client.id}`,
                        error instanceof Error ? error.stack : String(error)
                    );
                }
            }

            this.logger.log("[Scheduler] Contract reminder check completed");
        } catch (error) {
            this.logger.error(
                "[Scheduler] Contract reminder check failed",
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /**
     * Check and send survey requests (after service ends)
     * Runs daily at 9 AM KST
     */
    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async checkSurveyRequests(): Promise<void> {
        this.logger.log("[Scheduler] Starting survey request check...");

        try {
            // Check clients whose service ended yesterday
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const clients = await this.clientRepository.findByEndDate(yesterday);
            this.logger.log(`[Scheduler] Found ${clients.length} clients for survey request`);

            for (const client of clients) {
                try {
                    const serviceEndDate = this.formatDate(client.endDate!);
                    // TODO: Get actual employee name from employee_schedule
                    // For now, using placeholder
                    const employeeName = "담당자";
                    // TODO: Generate actual survey link
                    const surveyLink = "https://example.com/survey";

                    await this.channelTalkService.sendSurveyRequestAlimtalk(
                        client,
                        serviceEndDate,
                        employeeName,
                        surveyLink
                    );
                } catch (error) {
                    this.logger.error(
                        `[Scheduler] Failed to send survey request for client ${client.id}`,
                        error instanceof Error ? error.stack : String(error)
                    );
                }
            }

            this.logger.log("[Scheduler] Survey request check completed");
        } catch (error) {
            this.logger.error(
                "[Scheduler] Survey request check failed",
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /**
     * Check and send payment reminders
     * Runs daily at 9 AM KST
     * Note: Requires created_at field in client model (currently not available)
     */
    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async checkPaymentReminders(): Promise<void> {
        this.logger.log("[Scheduler] Starting payment reminder check...");

        try {
            // Payment reminder intervals (days after registration)
            const reminderIntervals = [3, 7];

            for (const days of reminderIntervals) {
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() - days);

                const clients = await this.clientRepository.findByCreatedDate(targetDate);
                this.logger.log(
                    `[Scheduler] Found ${clients.length} clients for ${days}-day payment reminder`
                );

                for (const client of clients) {
                    try {
                        const registrationDate = this.formatDate(targetDate);
                        await this.channelTalkService.sendPaymentReminderAlimtalk(
                            client,
                            registrationDate,
                            days
                        );
                    } catch (error) {
                        this.logger.error(
                            `[Scheduler] Failed to send payment reminder for client ${client.id}`,
                            error instanceof Error ? error.stack : String(error)
                        );
                    }
                }
            }

            this.logger.log("[Scheduler] Payment reminder check completed");
        } catch (error) {
            this.logger.error(
                "[Scheduler] Payment reminder check failed",
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /**
     * Format date to YYYY-MM-DD string
     */
    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
}
