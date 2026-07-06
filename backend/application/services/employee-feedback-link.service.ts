import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    SERVICE_FEEDBACK_LINK_RULE_ID,
    SERVICE_FEEDBACK_LINK_SMS_AUTOMATION_KEY,
    SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_FEEDBACK_LINK_SMS_TITLE,
    SERVICE_FEEDBACK_LINK_SMS_TRIGGER_TYPE,
    getServiceFeedbackLinkScheduledFor,
    getServiceFeedbackTokenExpiresAt,
} from "domain/constants/service-feedback-link-message";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import {
    MESSAGE_TRIGGER_JOB_REPOSITORY,
    IMessageTriggerJobRepository,
} from "domain/repositories/message-trigger-job.repository.interface";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import { EmployeeFeedbackTokenService } from "./employee-feedback-token.service";

/**
 * Issues / revokes the no-login 제공기록지 link for an assignment (BJJ-247).
 * Assignment flows schedule the SMS for service-start day 15:00 KST; the existing
 * Message trigger scheduler later dispatches it and writes retryable SMS logs.
 */
@Injectable()
export class EmployeeFeedbackLinkService {
    private readonly logger = new Logger(EmployeeFeedbackLinkService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokenService: EmployeeFeedbackTokenService,
        private readonly configService: ConfigService,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY)
        private readonly jobRepository: IMessageTriggerJobRepository,
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
    ) {}

    /** Backward-compatible wrapper: now schedules the SMS instead of sending immediately. */
    async issueAndSend(scheduleId: number): Promise<void> {
        return this.scheduleForServiceStart(scheduleId);
    }

    /** Mint a fresh link and schedule the SMS for the assignment's service-start day 15:00 KST. */
    async scheduleForServiceStart(scheduleId: number): Promise<void> {
        try {
            const { scheduledFor, employeeId, jobEnqueued } = await this.issueFeedbackLinkJob(scheduleId, {
                scheduledFor: null,
                recordMissingPhoneFailure: true,
            });
            if (jobEnqueued) {
                this.logger.log(
                    `Feedback link SMS scheduled for provider ${employeeId} schedule ${scheduleId} at ${scheduledFor.toISOString()}`
                );
            }
        } catch (error) {
            // Missing/legacy no-branch schedules were a silent no-op before the refactor; keep them log-free.
            if (error instanceof NotFoundException) return;
            this.logger.error(`Failed to schedule feedback link for schedule ${scheduleId}: ${error}`);
        }
    }

    /**
     * Mint a fresh link and enqueue immediate dispatch from an admin action.
     * Unlike the assignment hook, errors are intentionally surfaced to the caller.
     */
    async sendNow(scheduleId: number): Promise<{ scheduledFor: Date }> {
        const scheduledFor = new Date();
        const result = await this.issueFeedbackLinkJob(scheduleId, {
            scheduledFor,
            recordMissingPhoneFailure: false,
        });
        this.logger.log(
            `Feedback link SMS manually scheduled for provider ${result.employeeId} schedule ${scheduleId} at ${result.scheduledFor.toISOString()}`
        );
        return { scheduledFor: result.scheduledFor };
    }

    /** Revoke an assignment's feedback access (replacement / termination). */
    async revoke(scheduleId: number): Promise<void> {
        try {
            await this.tokenService.revokeForSchedule(scheduleId);
            await this.cancelPendingFeedbackJobs(scheduleId, "Feedback access revoked");
            this.logger.log(`Feedback access revoked for schedule ${scheduleId}`);
        } catch (error) {
            this.logger.error(`Failed to revoke feedback link for schedule ${scheduleId}: ${error}`);
        }
    }

    async extendExpiryForEndDate(scheduleId: number, endDate: Date): Promise<void> {
        try {
            await this.tokenService.extendExpiryForSchedule(
                scheduleId,
                getServiceFeedbackTokenExpiresAt(endDate),
            );
        } catch (error) {
            this.logger.error(`Failed to extend feedback token expiry for schedule ${scheduleId}: ${error}`);
        }
    }

    private async cancelPendingFeedbackJobs(scheduleId: number, reason: string): Promise<void> {
        const jobs = await this.jobRepository.findPendingByRuleIdsAndEmployeeScheduleId(
            [SERVICE_FEEDBACK_LINK_RULE_ID],
            scheduleId,
        );
        for (const job of jobs) {
            job.cancel(reason);
            await this.jobRepository.update(job);
        }
    }

    private async issueFeedbackLinkJob(
        scheduleId: number,
        options: {
            scheduledFor: Date | null;
            recordMissingPhoneFailure: boolean;
        },
    ): Promise<{ scheduledFor: Date; employeeId: number; jobEnqueued: boolean }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: { primaryEmployee: true, client: true },
        });
        if (!schedule || !schedule.branchId) {
            throw new NotFoundException("Assignment not found");
        }

        await this.cancelPendingFeedbackJobs(scheduleId, "Feedback link rescheduled");

        const employee = schedule.primaryEmployee;
        if (!this.normalizePhone(employee.phone)) {
            if (!options.recordMissingPhoneFailure) {
                throw new BadRequestException("제공인력 전화번호가 없습니다");
            }

            this.logger.warn(
                `Schedule ${scheduleId}: provider ${employee.id} has no phone on file; feedback link NOT sent. Set the employee's phone first.`
            );
            await this.recordPermanentFailure({
                branchId: schedule.branchId,
                scheduleId,
                clientId: schedule.clientId,
                clientName: schedule.client?.name ?? "고객",
                employeeId: employee.id,
                employeeName: employee.name,
                receiver: employee.phone,
                reason: "제공인력 전화번호 누락",
            });
            return {
                scheduledFor: options.scheduledFor ?? getServiceFeedbackLinkScheduledFor(schedule.startDate),
                employeeId: employee.id,
                jobEnqueued: false,
            };
        }

        const { linkToken } = await this.tokenService.issueLink({
            branchId: schedule.branchId,
            scheduleId,
            employeeId: employee.id,
            expectedPhone: employee.phone,
            expiresAt: getServiceFeedbackTokenExpiresAt(schedule.endDate),
        });

        const base = this.configService
            .get<string>("MOBILE_FEEDBACK_BASE_URL", "https://m.admin.babyjamjam.com")
            .replace(/\/+$/, "");
        const url = `${base}/feedback/${linkToken}`;
        const clientName = schedule.client?.name ?? "고객";
        const message =
            `[아가잼잼] ${clientName}님 산모·신생아 서비스 제공기록지 작성 링크입니다.\n` +
            `링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.\n${url}`;

        const scheduledFor = options.scheduledFor ?? getServiceFeedbackLinkScheduledFor(schedule.startDate);
        await this.jobRepository.upsertPending(
            MessageTriggerJobEntity.create({
                branchId: schedule.branchId,
                ruleId: SERVICE_FEEDBACK_LINK_RULE_ID,
                scheduledFor,
                clientId: schedule.clientId,
                employeeScheduleId: scheduleId,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                recipientPhone: employee.phone,
                templateKey: MessageTriggerTemplateKey.SERVICE_FEEDBACK_LINK,
                dedupeKey: `${SERVICE_FEEDBACK_LINK_RULE_ID}:schedule:${scheduleId}:primary`,
                payload: {
                    clientId: schedule.clientId,
                    clientName,
                    employeeId: employee.id,
                    employeeName: employee.name,
                    memberId: `employee:${employee.id}`,
                    recipientName: employee.name,
                    recipientPhone: employee.phone,
                    buttonUrl: url,
                    messageBody: message,
                    templateVariables: {
                        clientName,
                        employeeName: employee.name,
                        feedbackUrl: url,
                        serviceStartDate: this.formatDate(schedule.startDate),
                        serviceEndDate: this.formatDate(schedule.endDate),
                    },
                },
            }),
        );

        return { scheduledFor, employeeId: employee.id, jobEnqueued: true };
    }

    private async recordPermanentFailure(params: {
        branchId: string;
        scheduleId: number;
        clientId: number;
        clientName: string;
        employeeId: number;
        employeeName: string;
        receiver: string;
        reason: string;
    }): Promise<void> {
        const now = new Date();
        await this.logRepository.save(
            MessageLogEntity.reconstitute(
                0,
                params.branchId,
                "aligo_sms",
                SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
                null,
                params.receiver,
                params.clientId,
                `[아가잼잼] ${params.clientName}님 제공기록지 작성 링크 발송 실패`,
                {
                    automationKey: SERVICE_FEEDBACK_LINK_SMS_AUTOMATION_KEY,
                    triggerType: SERVICE_FEEDBACK_LINK_SMS_TRIGGER_TYPE,
                    title: SERVICE_FEEDBACK_LINK_SMS_TITLE,
                    clientName: params.clientName,
                    employeeName: params.employeeName,
                    employeeId: String(params.employeeId),
                    scheduleId: String(params.scheduleId),
                    reason: params.reason,
                    msgType: "AUTO",
                },
                "failed",
                null,
                params.reason,
                1,
                now,
                null,
                now,
                now,
            ),
        );
    }

    private formatDate(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    private normalizePhone(phone: string): string {
        return phone.replace(/\D/g, "");
    }
}
