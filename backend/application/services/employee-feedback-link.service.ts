import { randomUUID } from "node:crypto";

import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
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
    MessageTriggerEventType,
    MessageTriggerOffsetType,
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
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";

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
        @Optional() private readonly lifecycleService?: ServiceRecordLifecycleService,
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
                isManualSend: false,
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
    async sendNow(scheduleId: number, preparedLinkToken?: string): Promise<{ scheduledFor: Date }> {
        const scheduledFor = new Date();
        const result = await this.issueFeedbackLinkJob(scheduleId, {
            scheduledFor,
            recordMissingPhoneFailure: false,
            allowLateReissue: true,
            preparedLinkToken,
            isManualSend: true,
        });
        this.logger.log(
            `Feedback link SMS manually scheduled for provider ${result.employeeId} schedule ${scheduleId} at ${result.scheduledFor.toISOString()}`
        );
        return { scheduledFor: result.scheduledFor };
    }

    /**
     * Create the exact URL shown in the admin composer without enqueueing a job or
     * revoking the currently active provider link. The returned token is inactive
     * until sendNow receives and activates it.
     */
    async prepareLink(scheduleId: number): Promise<{
        feedbackUrl: string;
        preparedLinkToken: string;
        expiresAt: Date;
    }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: { primaryEmployee: true },
        });
        if (!schedule || !schedule.branchId) {
            throw new NotFoundException("Assignment not found");
        }

        const employee = schedule.primaryEmployee;
        if (!this.normalizePhone(employee.phone)) {
            throw new BadRequestException("제공인력 전화번호가 없습니다");
        }

        const expiresAt = this.resolveExpiry(schedule.endDate, true);
        const { linkToken } = await this.tokenService.prepareLink({
            branchId: schedule.branchId,
            scheduleId,
            employeeId: employee.id,
            expectedPhone: employee.phone,
            expiresAt,
        });

        return {
            feedbackUrl: this.buildFeedbackUrl(linkToken),
            preparedLinkToken: linkToken,
            expiresAt,
        };
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
            const record = await this.lifecycleService?.ensureForSchedule(scheduleId);
            const expiresAt = getServiceFeedbackTokenExpiresAt(record?.endDate ?? endDate);
            if (record) {
                await this.tokenService.extendExpiryForCase(record.id, expiresAt);
            } else {
                await this.tokenService.extendExpiryForSchedule(scheduleId, expiresAt);
            }
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

    private async supersedeRetryableFeedbackSmsLogs(scheduleId: number, reason: string): Promise<void> {
        const logs = await this.logRepository.findRetryableServiceFeedbackSmsByScheduleId(scheduleId);
        for (const log of logs) {
            log.markRetrySuperseded(reason);
            await this.logRepository.update(log);
        }
    }

    private async issueFeedbackLinkJob(
        scheduleId: number,
        options: {
            scheduledFor: Date | null;
            recordMissingPhoneFailure: boolean;
            allowLateReissue?: boolean;
            preparedLinkToken?: string;
            isManualSend: boolean;
        },
    ): Promise<{ scheduledFor: Date; employeeId: number; jobEnqueued: boolean }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: { primaryEmployee: true, client: true },
        });
        if (!schedule || !schedule.branchId) {
            throw new NotFoundException("Assignment not found");
        }

        await this.ensureSystemRule();
        const serviceRecordCase = await this.lifecycleService?.ensureForClient(schedule.clientId);

        const employee = schedule.primaryEmployee;
        if (options.preparedLinkToken) {
            if (!this.normalizePhone(employee.phone)) {
                throw new BadRequestException("제공인력 전화번호가 없습니다");
            }

            const activated = await this.tokenService.activatePreparedLink({
                linkToken: options.preparedLinkToken,
                branchId: schedule.branchId,
                scheduleId,
                employeeId: employee.id,
                expectedPhone: employee.phone,
                expiresAt: this.resolveExpiry(
                    serviceRecordCase?.endDate ?? schedule.endDate,
                    options.allowLateReissue === true,
                ),
            });
            if (!activated) {
                throw new BadRequestException("준비된 제공기록지 링크가 만료되었거나 유효하지 않습니다");
            }
        }

        await this.cancelPendingFeedbackJobs(scheduleId, "Feedback link rescheduled");
        await this.supersedeRetryableFeedbackSmsLogs(scheduleId, "Feedback link rescheduled");

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

        let linkToken: string;
        if (options.preparedLinkToken) {
            linkToken = options.preparedLinkToken;
        } else {
            const expiresAt = this.resolveExpiry(
                serviceRecordCase?.endDate ?? schedule.endDate,
                options.allowLateReissue === true,
            );
            ({ linkToken } = await this.tokenService.issueLink({
                branchId: schedule.branchId,
                scheduleId,
                employeeId: employee.id,
                ...(serviceRecordCase ? { serviceRecordCaseId: serviceRecordCase.id } : {}),
                expectedPhone: employee.phone,
                expiresAt,
            }));
        }

        const url = this.buildFeedbackUrl(linkToken);
        const clientName = schedule.client?.name ?? "고객";
        const message = `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

${employee.name} 관리사님, ${clientName} 산모님의 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
${url}`;

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
                dedupeKey: this.buildDedupeKey(scheduleId, options.isManualSend),
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

    private async ensureSystemRule(): Promise<void> {
        await this.prisma.message_trigger_rule.upsert({
            where: { id: SERVICE_FEEDBACK_LINK_RULE_ID },
            create: {
                id: SERVICE_FEEDBACK_LINK_RULE_ID,
                branchId: null,
                name: SERVICE_FEEDBACK_LINK_SMS_TITLE,
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.SERVICE_FEEDBACK_LINK,
                isDefault: false,
                jobsStale: false,
            },
            update: {},
        });
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
                params.employeeName,
                params.receiver,
            ),
        );
    }

    private formatDate(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    private buildDedupeKey(scheduleId: number, isManualSend: boolean): string {
        const assignmentKey = `${SERVICE_FEEDBACK_LINK_RULE_ID}:schedule:${scheduleId}:primary`;
        if (!isManualSend) return assignmentKey;

        return `${assignmentKey}:manual:${randomUUID()}`;
    }

    private normalizePhone(phone: string): string {
        return phone.replace(/\D/g, "");
    }

    private buildFeedbackUrl(linkToken: string): string {
        const base = this.configService
            .get<string>("MOBILE_FEEDBACK_BASE_URL", "https://m.admin.babyjamjam.com")
            .replace(/\/+$/, "");
        return `${base}/feedback/${linkToken}`;
    }

    private resolveExpiry(endDate: Date, allowLateReissue: boolean): Date {
        const normalExpiry = getServiceFeedbackTokenExpiresAt(endDate);
        if (!allowLateReissue || normalExpiry.getTime() >= Date.now()) return normalExpiry;
        return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
}
