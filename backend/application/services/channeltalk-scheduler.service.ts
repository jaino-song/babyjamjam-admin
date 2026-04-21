import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { ChannelTalkService } from "./channeltalk.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { BRANCH_REPOSITORY, IBranchRepository } from "domain/repositories/branch.repository.interface";
import { EMPLOYEE_SCHEDULE_REPOSITORY, IEmployeeScheduleRepository } from "domain/repositories/employee-schedule.repository.interface";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { AlimtalkTriggerService } from "./alimtalk-trigger.service";
import { AlimtalkTriggerEventType } from "domain/constants/alimtalk-trigger-catalog";

@Injectable()
export class ChannelTalkSchedulerService {
    private readonly logger = new Logger(ChannelTalkSchedulerService.name);

    constructor(
        private readonly channelTalkService: ChannelTalkService,
        private readonly configService: ConfigService,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        @Inject(BRANCH_REPOSITORY)
        private readonly branchRepository: IBranchRepository,
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly employeeScheduleRepository: IEmployeeScheduleRepository,
        @Inject(EMPLOYEE_REPOSITORY)
        private readonly employeeRepository: IEmployeeRepository,
        @Optional() private readonly triggerService?: AlimtalkTriggerService,
    ) {}

    /**
     * Check and send contract reminders (3 days and 1 day before service start)
     * Runs daily at 9 AM KST
     */
    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async checkContractReminders(): Promise<void> {
        this.logger.log("[Scheduler] Starting contract reminder check...");

        try {
            const branches = await this.branchRepository.findAllActive();

            for (const org of branches) {
                if (
                    this.triggerService &&
                    (await this.triggerService.hasActiveRulesForEvents(org.id, [
                        AlimtalkTriggerEventType.SERVICE_START,
                    ]))
                ) {
                    this.logger.log(`[Scheduler] Skipping legacy service-start reminders for org ${org.id}`);
                    continue;
                }
                this.logger.log(`[Scheduler] Processing contract reminders for org: ${org.name} (${org.id})`);
                const now = new Date();

                const threeDaysLater = new Date(now);
                threeDaysLater.setDate(threeDaysLater.getDate() + 3);

                const oneDayLater = new Date(now);
                oneDayLater.setDate(oneDayLater.getDate() + 1);

                const clientsFor3Days = await this.clientRepository.findByStartDate(
                    org.id,
                    threeDaysLater
                );
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

                const clientsFor1Day = await this.clientRepository.findByStartDate(
                    org.id,
                    oneDayLater
                );
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
            const branches = await this.branchRepository.findAllActive();

            for (const org of branches) {
                if (
                    this.triggerService &&
                    (await this.triggerService.hasActiveRulesForEvents(org.id, [
                        AlimtalkTriggerEventType.SERVICE_END,
                    ]))
                ) {
                    this.logger.log(`[Scheduler] Skipping legacy service-end reminders for org ${org.id}`);
                    continue;
                }
                this.logger.log(`[Scheduler] Processing survey requests for org: ${org.name} (${org.id})`);
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);

                const clients = await this.clientRepository.findByEndDate(org.id, yesterday);
                this.logger.log(`[Scheduler] Found ${clients.length} clients for survey request`);

                for (const client of clients) {
                    try {
                        const serviceEndDate = this.formatDate(client.endDate!);
                        const employeeName = await this.getEmployeeNameForClient(org.id, client.id);
                        const surveyBaseUrl = this.configService.get<string>('SURVEY_BASE_URL', 'https://example.com/survey');
                        const surveyLink = `${surveyBaseUrl}?clientId=${client.id}`;

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
     */
    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async checkPaymentReminders(): Promise<void> {
        this.logger.log("[Scheduler] Starting payment reminder check...");

        try {
            const branches = await this.branchRepository.findAllActive();

            for (const org of branches) {
                this.logger.log(`[Scheduler] Processing payment reminders for org: ${org.name} (${org.id})`);
                const reminderIntervals = [3, 7];

                for (const days of reminderIntervals) {
                    const targetDate = new Date();
                    targetDate.setDate(targetDate.getDate() - days);

                    const clients = await this.clientRepository.findByCreatedDate(
                        org.id,
                        targetDate
                    );
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
            }

            this.logger.log("[Scheduler] Payment reminder check completed");
        } catch (error) {
            this.logger.error(
                "[Scheduler] Payment reminder check failed",
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    // 클라이언트에 배정된 담당 직원 이름을 조회
    private async getEmployeeNameForClient(branchId: string, clientId: number): Promise<string> {
        try {
            const schedules = await this.employeeScheduleRepository.findByClientId(branchId, clientId);
            const activeSchedule = schedules.find(s => !s.replaced);
            if (!activeSchedule) return "담당자";

            const employee = await this.employeeRepository.findById(branchId, activeSchedule.primaryEmployeeId);
            return employee?.name ?? "담당자";
        } catch {
            return "담당자";
        }
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
}
