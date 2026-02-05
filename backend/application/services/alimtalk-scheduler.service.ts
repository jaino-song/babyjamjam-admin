import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AlimtalkService } from "./alimtalk.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

@Injectable()
export class AlimtalkSchedulerService {
    private readonly logger = new Logger(AlimtalkSchedulerService.name);

    constructor(
        private readonly alimtalkService: AlimtalkService,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository
    ) {}

    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async checkContractReminders(): Promise<void> {
        this.logger.log("[Scheduler] Starting contract reminder check...");

        try {
            // todo: iterate over all organizations
            const organizationid = "";
            const now = new Date();

            const threeDaysLater = new Date(now);
            threeDaysLater.setDate(threeDaysLater.getDate() + 3);

            const oneDayLater = new Date(now);
            oneDayLater.setDate(oneDayLater.getDate() + 1);

            const clientsFor3Days = await this.clientRepository.findByStartDate(
                organizationid,
                threeDaysLater
            );
            this.logger.log(`[Scheduler] Found ${clientsFor3Days.length} clients for 3-day reminder`);

            for (const client of clientsFor3Days) {
                try {
                    const serviceStartDate = this.formatDate(client.startDate!);
                    await this.alimtalkService.sendContractReminder3DaysAlimtalk(client, serviceStartDate);
                } catch (error) {
                    this.logger.error(
                        `[Scheduler] Failed to send 3-day reminder for client ${client.id}`,
                        error instanceof Error ? error.stack : String(error)
                    );
                }
            }

            const clientsFor1Day = await this.clientRepository.findByStartDate(
                organizationid,
                oneDayLater
            );
            this.logger.log(`[Scheduler] Found ${clientsFor1Day.length} clients for 1-day reminder`);

            for (const client of clientsFor1Day) {
                try {
                    const serviceStartDate = this.formatDate(client.startDate!);
                    await this.alimtalkService.sendContractReminder1DayAlimtalk(client, serviceStartDate);
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

    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async checkSurveyRequests(): Promise<void> {
        this.logger.log("[Scheduler] Starting survey request check...");

        try {
            // todo: iterate over all organizations
            const organizationid = "";
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const clients = await this.clientRepository.findByEndDate(organizationid, yesterday);
            this.logger.log(`[Scheduler] Found ${clients.length} clients for survey request`);

            for (const client of clients) {
                try {
                    const serviceEndDate = this.formatDate(client.endDate!);
                    const employeeName = "담당자";
                    const surveyLink = "https://example.com/survey";

                    await this.alimtalkService.sendSurveyRequestAlimtalk(
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

    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async checkPaymentReminders(): Promise<void> {
        this.logger.log("[Scheduler] Starting payment reminder check...");

        try {
            // todo: iterate over all organizations
            const organizationid = "";
            const reminderIntervals = [3, 7];

            for (const days of reminderIntervals) {
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() - days);

                const clients = await this.clientRepository.findByCreatedDate(
                    organizationid,
                    targetDate
                );
                this.logger.log(
                    `[Scheduler] Found ${clients.length} clients for ${days}-day payment reminder`
                );

                for (const client of clients) {
                    try {
                        const registrationDate = this.formatDate(targetDate);
                        await this.alimtalkService.sendPaymentReminderAlimtalk(
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

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
}
