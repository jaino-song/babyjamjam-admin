import { lockServiceRecordWriteSet } from "application/policies/service-record-write-lock.policy";
import { randomUUID } from "node:crypto";

import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { serviceRecordScheduleBlockerSql } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { getEffectiveClientServiceStatus } from "domain/repositories/client.repository.interface";
import {
    SERVICE_RECORD_LINK_RESCHEDULED_REASON,
    SERVICE_RECORD_LINK_ENDED_REASON,
    SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
    SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_RECORD_LINK_SMS_TITLE,
    SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
    getServiceRecordLinkScheduledFor,
    getServiceRecordTokenExpiresAt,
    getServiceRecordServiceEndedAt,
    serviceRecordAutomaticJobKey,
} from "domain/constants/service-record-link-message";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { findUnsupportedRequiredMessageTriggerVariables } from "domain/constants/message-trigger-variable-sources";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
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
import {
    MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY,
    IMessageTriggerRuleBranchOverrideRepository,
} from "domain/repositories/message-trigger-rule-branch-override.repository.interface";
import { ServiceRecordTokenService } from "./service-record-token.service";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import { MessageTemplateAutomationLockService } from "./message-template-automation-lock.service";
import { MessageAutomationBranchLockService } from "./message-automation-branch-lock.service";
import { MessageAutomationActivationService } from "./message-automation-activation.service";
import {
    buildServiceRecordLinkMessage,
    DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL,
} from "./service-record-link-automation-effect-recipe";
import { captureServiceRecordError } from "infrastructure/observability/service-record-sentry";
import type { AgentAutomationTaskCommitReference } from "domain/entities/agent-automation-consent";
import { SERVICE_STATUS } from "domain/value-objects/service-status.vo";
import {
    findRecordLinkTerminalSibling,
    hasApprovedRecordLinkSender,
    hasRecordLinkAcceptance,
    lockRecordLinkSchedule,
    matchesRecordLinkOccurrence,
    observePreBookingRecordLinkAssignment,
    observeRecordLinkBlock,
    permitsRecordLinkRecovery,
    readRecordLinkAssignment,
    readRecordLinkEpoch,
    recordLinkAssignmentMatches,
    recordLinkClientStatus,
    recordLinkTransition,
    RECORD_LINK_RECOVERY_PREFIX,
    RECORD_LINK_RECOVERY_REASON,
    type RecordLinkStatusInputs,
} from "infrastructure/database/repositories/record-link-recovery.repository";

const RECOVERY_BATCH_SIZE = 100;
const RECOVERY_BACKOFF_MS = 5 * 60_000;
type RecoveryCandidate = { id: string; branch_id: string };

const AUTOMATIC_SCHEDULING_LEASE_MINUTES = 10;
const AUTOMATIC_SCHEDULING_RETRY_DELAY_MS = AUTOMATIC_SCHEDULING_LEASE_MINUTES * 60 * 1000;

interface AutomaticSchedulingClaim {
    id: string;
    claimVersion: string;
    dedupeKey: string;
}

function readStoredCustomVariables(
    value: Prisma.JsonValue | null,
): Array<{ key: string; required: boolean }> {
    if (!Array.isArray(value)) return [];

    return value.flatMap((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
        const candidate = item as Record<string, unknown>;
        if (typeof candidate["key"] !== "string" || typeof candidate["required"] !== "boolean") return [];
        return [{ key: candidate["key"], required: candidate["required"] }];
    });
}

/**
 * Issues / revokes the no-login 제공기록지 link for an assignment (BJJ-247).
 * Assignment flows schedule the SMS for noon KST the day before service start; the existing
 * Message trigger scheduler later dispatches it and writes retryable SMS logs.
 */
@Injectable()
export class ServiceRecordLinkService {
    private readonly logger = new Logger(ServiceRecordLinkService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokenService: ServiceRecordTokenService,
        private readonly configService: ConfigService,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY)
        private readonly jobRepository: IMessageTriggerJobRepository,
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        @Inject(MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY)
        private readonly overrideRepository: IMessageTriggerRuleBranchOverrideRepository,
        private readonly automationLock: MessageTemplateAutomationLockService =
            new MessageTemplateAutomationLockService(prisma),
        @Optional() private readonly lifecycleService?: ServiceRecordLifecycleService,
        @Optional() private readonly branchLock?: MessageAutomationBranchLockService,
        @Optional() private readonly automationActivationService?: MessageAutomationActivationService,
    ) {}

    /** The owning write has already acquired the automation branch lock. */
    async observeAssignmentInTransaction(tx: Prisma.TransactionClient, branchId: string, scheduleId: number): Promise<boolean> {
        return observePreBookingRecordLinkAssignment(tx, branchId, scheduleId);
    }

    /** Persist the actual exit alongside the client write so crash recovery never guesses it. */
    async recordClientTransitionInTransaction(
        tx: Prisma.TransactionClient, branchId: string, clientId: number, before: RecordLinkStatusInputs,
        allowRecovery = true,
    ): Promise<void> {
        const now = new Date();
        if (recordLinkClientStatus(before, now) !== SERVICE_STATUS.PRE_BOOKING) return;
        const client = await tx.client.findFirst({
            where: { id: clientId, branchId, deletedAt: null },
            select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true },
        });
        if (!client) return;
        const after = recordLinkClientStatus(client, now);
        if (after === SERVICE_STATUS.PRE_BOOKING) return;
        const schedules = await tx.employee_schedule.findMany({
            where: { branchId, clientId, replaced: false, terminatedAt: null },
            include: { client: true, primaryEmployee: true },
            orderBy: { id: "asc" },
        });
        for (const schedule of schedules) {
            await observeRecordLinkBlock(tx, schedule, now, after);
        }
        await recordLinkTransition(tx, branchId, clientId, after, now, allowRecovery);
    }

    async recheckClientRecovery(branchId: string, clientId: number): Promise<void> {
        await this.recheckRecovery({ branchId, clientId });
    }

    async sweepRecovery(now = new Date()): Promise<number> {
        return this.recheckRecovery({}, now);
    }

    private async recheckRecovery(scope: { branchId?: string; clientId?: number; scheduleId?: number }, now = new Date()): Promise<number> {
        const refresh = scope.scheduleId !== undefined;
        const candidates = await this.prisma.$queryRaw<RecoveryCandidate[]>(Prisma.sql`
            SELECT id, branch_id FROM message_trigger_job
            WHERE recovery_reason = ${RECORD_LINK_RECOVERY_REASON}
              AND recovery_state = 'eligible' AND recovery_epoch IS NOT NULL
              AND branch_id IS NOT NULL
              ${refresh ? Prisma.empty : Prisma.sql`AND next_check_at <= ${now}`}
              ${scope.branchId ? Prisma.sql`AND branch_id = ${scope.branchId}::uuid` : Prisma.empty}
              ${scope.clientId !== undefined ? Prisma.sql`AND client_id = ${scope.clientId}` : Prisma.empty}
              ${scope.scheduleId !== undefined ? Prisma.sql`AND employee_schedule_id = ${scope.scheduleId}` : Prisma.empty}
            ORDER BY next_check_at, id LIMIT ${RECOVERY_BATCH_SIZE}
        `);
        let admitted = 0;
        for (const candidate of candidates) {
            try {
                if (await this.recoverCandidate(candidate, now, refresh)) {
                    admitted++;
                    continue;
                }
            } catch (error) {
                captureServiceRecordError(error, { operation: "link-schedule", handled: true });
            }
            // A candidate still due after a transient preparation error should
            // move behind other candidates on the next bounded sweep.
            await this.branchLock!.runExclusive(candidate.branch_id, tx => tx.message_trigger_job.updateMany({
                where: { id: candidate.id, branchId: candidate.branch_id, recoveryState: "eligible", nextCheckAt: { lte: now } },
                data: { nextCheckAt: new Date(now.getTime() + RECOVERY_BACKOFF_MS) },
            }));
        }
        return admitted;
    }

    private async recoverCandidate(candidate: RecoveryCandidate, now: Date, refresh: boolean): Promise<boolean> {
        if (!this.branchLock || !this.automationActivationService) throw new ServiceUnavailableException("Message automation activation is not configured");
        const read = async (tx: Prisma.TransactionClient) => {
            const original = await tx.message_trigger_job.findFirst({
                where: { id: candidate.id, branchId: candidate.branch_id, recoveryState: "eligible",
                    recoveryReason: RECORD_LINK_RECOVERY_REASON, status: "canceled", canceledByUser: false,
                    ...(refresh ? {} : { nextCheckAt: { lte: now } }) },
            });
            if (!original?.recoveryEpoch) return null;
            const terminal = () => tx.message_trigger_job.update({
                where: { id: original.id, branchId: candidate.branch_id },
                data: { recoveryState: "ineligible_terminal", nextCheckAt: null },
            });
            const schedule = original.employeeScheduleId
                ? await readRecordLinkAssignment(tx, candidate.branch_id, original.employeeScheduleId)
                : null;
            if (!original.clientId || !recordLinkAssignmentMatches(schedule, candidate.branch_id, original.clientId, now)
                || !matchesRecordLinkOccurrence(original.payload, schedule)
                || !permitsRecordLinkRecovery(recordLinkClientStatus(schedule.client, now))
                || !(await hasApprovedRecordLinkSender(tx, candidate.branch_id))
                || (await readRecordLinkEpoch(tx, candidate.branch_id))?.getTime() !== original.recoveryEpoch.getTime()) {
                await terminal();
                return null;
            }
            const rule = await tx.message_trigger_rule.findUnique({
                where: { id: SERVICE_RECORD_LINK_RULE_ID, deletedAt: null, branchId: null, isActive: true },
                select: { id: true },
            });
            if (!rule || !(await this.automationActivationService!.getTriggerDispatchEnabled(candidate.branch_id, tx))) {
                await terminal();
                return null;
            }
            if (await findRecordLinkTerminalSibling(tx, schedule, original.id) || await hasRecordLinkAcceptance(tx, schedule)) {
                await terminal();
                return null;
            }
            const other = await tx.message_trigger_job.findFirst({
                where: { branchId: candidate.branch_id, employeeScheduleId: schedule.id, templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                    id: { not: original.id }, OR: [
                        { status: { in: ["pending", "processing", "dispatching", "sent", "needs_setup", "failed"] } },
                        { canceledByUser: true },
                    ] },
                select: { status: true, canceledByUser: true },
            });
            if (other?.canceledByUser || other?.status === "sent" || other?.status === "failed") {
                await terminal();
                return null;
            }
            const due = new Date(Math.max(original.scheduledFor.getTime(), getServiceRecordLinkScheduledFor(schedule.startDate).getTime()));
            if (due > now || other) {
                await tx.message_trigger_job.update({
                    where: { id: original.id, branchId: candidate.branch_id },
                    data: { nextCheckAt: due > now ? due : new Date(now.getTime() + RECOVERY_BACKOFF_MS) },
                });
                return null;
            }
            return { original, schedule };
        };

        // Link and case preparation use their own transaction boundaries.
        // Re-read all eligibility and assignment fields at the actual insert.
        const eligible = await this.branchLock.runExclusive(candidate.branch_id, read);
        if (!eligible) return false;
        const { jobEnqueued } = await this.issueServiceRecordLinkJob(eligible.schedule.id, {
            scheduledFor: now,
            isManualSend: false,
            recordMissingPhoneFailure: false,
            branchId: candidate.branch_id,
            recovery: async (tx, pendingJob, linkToken) => {
                await lockServiceRecordWriteSet(tx, { branchId: candidate.branch_id, clientId: eligible.schedule.clientId });
                await lockRecordLinkSchedule(tx, eligible.schedule.id);
                const current = await read(tx);
                if (!current || current.schedule.incarnationId !== eligible.schedule.incarnationId
                    || current.schedule.primaryEmployee.phone !== pendingJob.recipientPhone
                    || current.schedule.client.name !== pendingJob.payload.clientName
                    || current.schedule.primaryEmployee.name !== pendingJob.payload.employeeName
                    || this.formatDate(current.schedule.startDate) !== pendingJob.payload.templateVariables["serviceStartDate"]
                    || this.formatDate(current.schedule.endDate) !== pendingJob.payload.templateVariables["serviceEndDate"]) return false;

                const token = await tx.service_record_token.findFirst({
                    where: { branchId: candidate.branch_id, scheduleId: current.schedule.id,
                        employeeId: current.schedule.primaryEmployeeId, linkTokenHash: linkToken,
                        active: true, revokedAt: null, lockedAt: null, expiresAt: { gt: now } },
                    select: { id: true },
                });
                if (!token) return false;
                const { original, schedule } = current;
                if (await this.jobRepository.hasAcceptedOccurrence(pendingJob, tx)) {
                    await tx.message_trigger_job.update({
                        where: { id: original.id, branchId: candidate.branch_id },
                        data: { recoveryState: "ineligible_terminal", nextCheckAt: null },
                    });
                    return false;
                }
                await tx.message_trigger_job.create({ data: {
                    branchId: candidate.branch_id,
                    ruleId: SERVICE_RECORD_LINK_RULE_ID,
                    clientId: schedule.clientId,
                    employeeScheduleId: schedule.id,
                    scheduledFor: new Date(Math.max(Date.now(), now.getTime(), original.scheduledFor.getTime(),
                        getServiceRecordLinkScheduledFor(schedule.startDate).getTime())),
                    recipientType: pendingJob.recipientType,
                    recipientPhone: pendingJob.recipientPhone,
                    templateKey: pendingJob.templateKey,
                    dedupeKey: RECORD_LINK_RECOVERY_PREFIX + original.id,
                    payload: pendingJob.payload as unknown as Prisma.InputJsonValue,
                    originalJobId: original.id,
                    recoveryReason: RECORD_LINK_RECOVERY_REASON,
                    recoveryEpoch: original.recoveryEpoch,
                } });
                await tx.message_trigger_job.update({
                    where: { id: original.id, branchId: candidate.branch_id },
                    data: { recoveryState: "admitted", nextCheckAt: null },
                });
                return true;
            },
        });
        return jobEnqueued;
    }

    /** Backward-compatible wrapper: now schedules the SMS instead of sending immediately. */
    async issueAndSend(scheduleId: number): Promise<void> {
        await this.scheduleForServiceStart(scheduleId);
    }

    /** Ensure the assignment link exists and reserve its normal service-start message slot. */
    async scheduleForServiceStart(
        scheduleId: number,
        options: { taskAutomationReference?: AgentAutomationTaskCommitReference; rescheduleAutomatic?: boolean; branchId?: string } = {},
    ): Promise<boolean> {
        try {
            if (options.rescheduleAutomatic && options.branchId
                && await this.recheckRecovery({ branchId: options.branchId, scheduleId })) return true;
            const { scheduledFor, employeeId, jobEnqueued } = await this.issueServiceRecordLinkJob(scheduleId, {
                scheduledFor: null,
                recordMissingPhoneFailure: true,
                isManualSend: false,
                taskAutomationReference: options.taskAutomationReference,
                rescheduleAutomatic: options.rescheduleAutomatic,
                branchId: options.branchId,
            });
            if (jobEnqueued) {
                this.logger.log(
                    `Service record link SMS scheduled for provider ${employeeId} schedule ${scheduleId} at ${scheduledFor.toISOString()}`
                );
            }
            return jobEnqueued;
        } catch (error) {
            // Missing/legacy no-branch schedules were a silent no-op before the refactor; keep them log-free.
            if (error instanceof NotFoundException) return false;
            captureServiceRecordError(error, {
                operation: "link-schedule",
                handled: false,
                scheduleId,
            });
            this.logger.error(`Failed to schedule service-record link for schedule ${scheduleId}: ${error}`);
            throw error;
        }
    }

    /**
     * Reuse the assignment's active link when possible and enqueue immediate dispatch.
     * Unlike the assignment hook, errors are intentionally surfaced to the caller.
     */
    async sendNow(
        scheduleId: number,
        preparedLinkToken?: string,
        recipientPhone?: string,
    ): Promise<{ scheduledFor: Date; jobId: string }> {
        const scheduledFor = new Date();
        const result = await this.issueServiceRecordLinkJob(scheduleId, {
            scheduledFor,
            recordMissingPhoneFailure: false,
            allowLateReissue: true,
            preparedLinkToken,
            isManualSend: true,
            recipientPhone,
        });
        if (!result.jobId) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/scheduleId",
                code: "INVALID_VALUE",
                detail: "제공기록지 링크 발송 작업을 생성하지 못했습니다",
                location: "body",
            }));
        }
        this.logger.log(
            `Service record link SMS manually scheduled for provider ${result.employeeId} schedule ${scheduleId} at ${result.scheduledFor.toISOString()}`
        );
        return { scheduledFor: result.scheduledFor, jobId: result.jobId };
    }

    /**
     * Return the active assignment URL when one exists. Otherwise prepare the exact
     * inactive URL shown in the admin composer until sendNow activates the same row.
     */
    async prepareLink(scheduleId: number, recipientPhone?: string): Promise<{
        serviceRecordUrl: string;
        preparedLinkToken: string;
        expiresAt: Date;
    }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: {
                primaryEmployee: true,
                client: { select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true } },
            },
        });
        if (!schedule || !schedule.branchId || schedule.replaced) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        this.assertClientCanReceiveLink(schedule.client);
        const employee = schedule.primaryEmployee;
        const resolvedRecipientPhone = this.resolveRecipientPhone(employee.phone, recipientPhone);
        if (!resolvedRecipientPhone || !this.resolveRecipientPhone(employee.phone)) {
            throw new BadRequestException(problemBody("INVALID_PROVIDER_PHONE", {
                pointer: "/recipientPhone",
                code: "INVALID_VALUE",
                detail: "제공인력 전화번호가 없습니다",
                location: "body",
            }));
        }

        const serviceRecordCase = await this.lifecycleService?.ensureForClient(schedule.clientId);
        const expiresAt = this.resolveExpiry(serviceRecordCase?.endDate ?? schedule.endDate, true);
        const tokenParams = {
            branchId: schedule.branchId,
            scheduleId,
            ...(serviceRecordCase ? { serviceRecordCaseId: serviceRecordCase.id } : {}),
            employeeId: employee.id,
            expectedPhone: employee.phone,
            expiresAt,
        };
        const { linkToken } = await this.tokenService.reuseActiveLink(tokenParams, { includeLocked: false })
            ?? await this.tokenService.prepareLink(tokenParams);

        return {
            serviceRecordUrl: this.buildServiceRecordUrl(linkToken),
            preparedLinkToken: linkToken,
            expiresAt,
        };
    }

    /** Reset the phone challenge without changing the assignment URL or sending an SMS. */
    async resetLink(scheduleId: number): Promise<{
        serviceRecordUrl: string;
        expiresAt: Date;
    }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: {
                primaryEmployee: true,
                client: { select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true } },
            },
        });
        if (!schedule || !schedule.branchId || schedule.replaced) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        this.assertClientCanReceiveLink(schedule.client);
        const employee = schedule.primaryEmployee;
        const resolvedRecipientPhone = this.resolveRecipientPhone(employee.phone);
        if (!resolvedRecipientPhone || !this.resolveRecipientPhone(employee.phone)) {
            throw new BadRequestException(problemBody("INVALID_PROVIDER_PHONE", {
                pointer: "/recipientPhone",
                code: "INVALID_VALUE",
                detail: "제공인력 전화번호가 없습니다",
                location: "body",
            }));
        }

        // The cancel runs under the schedule fence and commits before
        // `issueLink` below: `issueLink` opens its own transaction (a
        // `service-record-link:` advisory lock and a case row lock) that must
        // never be requested from inside the fence. The reset keeps the token
        // active (same URL), so a send racing it is not refused for its token;
        // the job it leaves behind still carries a valid link.
        await this.cancelPendingServiceRecordJobsUnderFence(scheduleId, "Service record link reset without resend");
        await this.supersedeRetryableServiceRecordSmsLogs(scheduleId, "Service record link reset without resend");

        const serviceRecordCase = await this.lifecycleService?.ensureForClient(schedule.clientId);
        const expiresAt = this.resolveExpiry(serviceRecordCase?.endDate ?? schedule.endDate, true);
        const { linkToken } = await this.tokenService.issueLink({
            branchId: schedule.branchId,
            scheduleId,
            employeeId: employee.id,
            ...(serviceRecordCase ? { serviceRecordCaseId: serviceRecordCase.id } : {}),
            expectedPhone: employee.phone,
            expiresAt,
            resetChallenge: true,
        });

        return {
            serviceRecordUrl: this.buildServiceRecordUrl(linkToken),
            expiresAt,
        };
    }

    /** Revoke an assignment's service-record access (replacement / termination). */
    async revoke(scheduleId: number): Promise<void> {
        try {
            // One fence for the job cancel and the token revocation, on one
            // connection (jobs are locked first, tokens after). A send that
            // prepared its link before this revoke is then either already
            // enqueued (and cancelled here) or re-checks the token under the
            // same fence afterwards and refuses. In-flight (`dispatching`) jobs
            // are only logged: the SMS already left and the link dies with the
            // token.
            await this.cancelPendingServiceRecordJobsUnderFence(
                scheduleId,
                "Service record access revoked",
                (transaction) => this.tokenService.revokeForSchedule(scheduleId, transaction),
            );
            this.logger.log(`Service record access revoked for schedule ${scheduleId}`);
        } catch (error) {
            this.logger.error(`Failed to revoke service-record link for schedule ${scheduleId}: ${error}`);
            throw error;
        }
    }

    async extendExpiryForEndDate(scheduleId: number, endDate: Date): Promise<void> {
        try {
            const record = await this.lifecycleService?.ensureForSchedule(scheduleId);
            const expiresAt = getServiceRecordTokenExpiresAt(record?.endDate ?? endDate);
            if (record) {
                await this.tokenService.extendExpiryForCase(record.id, expiresAt);
            } else {
                await this.tokenService.extendExpiryForSchedule(scheduleId, expiresAt);
            }
        } catch (error) {
            this.logger.error(`Failed to extend service-record token expiry for schedule ${scheduleId}: ${error}`);
            throw error;
        }
    }

    /**
     * Cancel the schedule's pending/processing link jobs under the schedule
     * fence (revoke / reset). Returns the ids of jobs the dispatcher already
     * moved to `dispatching`: those are left untouched (the SMS may be on its
     * way) and each caller decides what that means. `afterCancel` runs in the
     * fence's transaction, after the jobs are locked and cancelled.
     */
    private async cancelPendingServiceRecordJobsUnderFence(
        scheduleId: number,
        reason: string,
        afterCancel?: (transaction: Prisma.TransactionClient) => Promise<void>,
    ): Promise<string[]> {
        const { inFlightJobIds } = await this.jobRepository.cancelPendingUnderScheduleFence(
            SERVICE_RECORD_LINK_RULE_ID,
            scheduleId,
            reason,
            afterCancel,
        );
        this.logInFlightLinkJobs(scheduleId, reason, inFlightJobIds);
        return inFlightJobIds;
    }

    private logInFlightLinkJobs(scheduleId: number, reason: string, inFlightJobIds: string[]): void {
        if (inFlightJobIds.length === 0) return;
        this.logger.warn(
            `Schedule ${scheduleId}: ${inFlightJobIds.length} service-record link job(s) already dispatching were left untouched (${reason}): ${inFlightJobIds.join(", ")}`,
        );
    }

    private async supersedeRetryableServiceRecordSmsLogs(
        scheduleId: number,
        reason: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<void> {
        const logs = await this.logRepository.findRetryableServiceRecordSmsByScheduleId(scheduleId, transaction);
        for (const log of logs) {
            log.markRetrySuperseded(reason);
            await this.logRepository.update(log, transaction);
        }
    }

    private assertClientCanReceiveLink(client: {
        serviceStatus: string | null;
        bookingConfirmedAt: Date | null;
        startDate: Date | null;
        endDate: Date | null;
    }): void {
        if (getEffectiveClientServiceStatus(client.serviceStatus, client.startDate, client.endDate, client.bookingConfirmedAt) === "pre_booking") {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/scheduleId",
                code: "INVALID_VALUE",
                detail: "예약 전 고객에게는 제공기록지 링크를 보낼 수 없습니다",
                location: "body",
            }));
        }
    }

    private async issueServiceRecordLinkJob(
        scheduleId: number,
        options: {
            scheduledFor: Date | null;
            recordMissingPhoneFailure: boolean;
            allowLateReissue?: boolean;
            preparedLinkToken?: string;
            isManualSend: boolean;
            recipientPhone?: string;
            taskAutomationReference?: AgentAutomationTaskCommitReference;
            rescheduleAutomatic?: boolean;
            branchId?: string;
            recovery?: (transaction: Prisma.TransactionClient, pendingJob: MessageTriggerJobEntity, linkToken: string) => Promise<boolean>;
        },
    ): Promise<{
        scheduledFor: Date;
        employeeId: number;
        jobEnqueued: boolean;
        jobId: string | null;
    }> {
        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: { primaryEmployee: true, client: true },
        });
        if (!schedule || !schedule.branchId || schedule.replaced) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        if ((options.rescheduleAutomatic || options.recovery || options.branchId !== undefined)
            && options.branchId !== schedule.branchId) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if (options.isManualSend) this.assertClientCanReceiveLink(schedule.client);
        await this.ensureSystemRule(schedule.branchId, options.isManualSend);
        const employee = schedule.primaryEmployee;
        const resolvedRecipientPhone = this.resolveRecipientPhone(
            employee.phone,
            options.recipientPhone,
        );

        const scheduledFor = options.scheduledFor ?? getServiceRecordLinkScheduledFor(schedule.startDate);
        const originalKey = serviceRecordAutomaticJobKey(scheduleId);
        const original = !options.isManualSend
            ? await this.prisma.message_trigger_job.findUnique({ where: { dedupeKey: originalKey, branchId: schedule.branchId } }) : null;
        const originalEmployeeId = (original?.payload as { employeeId?: unknown } | null)?.employeeId;
        const replacedRecipient = original?.clientId === schedule.clientId && original.employeeScheduleId === scheduleId
            && typeof originalEmployeeId === "number" && Number.isSafeInteger(originalEmployeeId) && originalEmployeeId !== employee.id;
        const automaticDedupeKey = replacedRecipient ? serviceRecordAutomaticJobKey(scheduleId, employee.id) : originalKey;
        let automaticSchedulingClaim: AutomaticSchedulingClaim | null = null;
        const automaticReplacement = !options.recovery && options.rescheduleAutomatic
            ? replacedRecipient
                ? await this.prisma.message_trigger_job.findUnique({ where: { dedupeKey: automaticDedupeKey, branchId: schedule.branchId } })
                : original
            : null;
        if (automaticReplacement && (automaticReplacement.branchId !== schedule.branchId
            || automaticReplacement.employeeScheduleId !== scheduleId || automaticReplacement.clientId !== schedule.clientId)) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if (!options.isManualSend) {
            // 종료일은 KST 자정까지 유효하므로 종료일 당일의 늦은 등록도 발송한다.
            if (
                schedule.terminatedAt
                || getEffectiveClientServiceStatus(
                    schedule.client.serviceStatus,
                    schedule.client.startDate,
                    schedule.client.endDate,
                    schedule.client.bookingConfirmedAt,
                ) === "pre_booking"
                || schedule.client?.serviceStatus === "completed"
                || schedule.client?.serviceStatus === "terminated"
                || getServiceRecordServiceEndedAt(schedule.endDate).getTime() <= Date.now()
            ) {
                return { scheduledFor, employeeId: employee.id, jobEnqueued: false, jobId: null };
            }
            if (!options.recovery && !automaticReplacement) {
                automaticSchedulingClaim = await this.claimAutomaticScheduling({
                    branchId: schedule.branchId,
                    scheduleId,
                    clientId: schedule.clientId,
                    clientName: schedule.client?.name ?? "고객",
                    employeeId: employee.id,
                    employeeName: employee.name,
                    recipientPhone: resolvedRecipientPhone,
                    scheduledFor,
                    dedupeKey: automaticDedupeKey,
                    serviceStartDate: this.formatDate(schedule.startDate),
                    serviceEndDate: this.formatDate(schedule.endDate),
                });
                if (!automaticSchedulingClaim) {
                    return {
                        scheduledFor,
                        employeeId: employee.id,
                        jobEnqueued: false,
                        jobId: null,
                    };
                }
            }
        }

        try {
            const serviceRecordCase = await this.lifecycleService?.ensureForClient(schedule.clientId);
            if (options.preparedLinkToken) {
                if (!resolvedRecipientPhone || !this.resolveRecipientPhone(employee.phone)) {
                    throw new BadRequestException(problemBody("INVALID_PROVIDER_PHONE", {
                pointer: "/recipientPhone",
                code: "INVALID_VALUE",
                detail: "제공인력 전화번호가 없습니다",
                location: "body",
            }));
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
                    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                        pointer: "/scheduleId",
                        code: "INVALID_VALUE",
                        detail: "준비된 제공기록지 링크가 만료되었거나 유효하지 않습니다",
                        location: "body",
                    }));
                }
            }

            // Neither path cancels anything up front. A manual send cancels the
            // old pending job and enqueues its replacement (and supersedes the
            // retryable logs) in ONE repository transaction below, so it can
            // refuse when the dispatcher already claimed a job. The automatic
            // path's claim only starts when the schedule has no pending,
            // processing, dispatching or sent job (nor a failed delivery), so
            // any such row seen afterwards is a newer send, most likely a
            // manual one, which the fenced promotion refuses to join.
            // Cancelling it here would silently lose that accepted send.
            if (!resolvedRecipientPhone || !this.resolveRecipientPhone(employee.phone)) {
                if (!options.recordMissingPhoneFailure) {
                    throw new BadRequestException(problemBody("INVALID_PROVIDER_PHONE", {
                pointer: "/recipientPhone",
                code: "INVALID_VALUE",
                detail: "제공인력 전화번호가 없습니다",
                location: "body",
            }));
                }

                this.logger.warn(
                    `Schedule ${scheduleId}: provider ${employee.id} has no phone on file; service-record link NOT sent. Set the employee's phone first.`,
                );
                await this.recordPermanentFailure({
                    branchId: schedule.branchId,
                    scheduleId,
                    clientId: schedule.clientId,
                    clientName: schedule.client?.name ?? "고객",
                    employeeId: employee.id,
                    employeeName: employee.name,
                    receiver: options.recipientPhone ?? employee.phone,
                    reason: "제공인력 전화번호 누락",
                });
                return {
                    scheduledFor,
                    employeeId: employee.id,
                    jobEnqueued: false,
                    jobId: null,
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
                const tokenParams = {
                    branchId: schedule.branchId,
                    scheduleId,
                    employeeId: employee.id,
                    ...(serviceRecordCase ? { serviceRecordCaseId: serviceRecordCase.id } : {}),
                    expectedPhone: employee.phone,
                    expiresAt,
                };
                ({ linkToken } = await this.tokenService.reuseActiveLink(tokenParams)
                    ?? await this.tokenService.issueLink(tokenParams));
            }

            const url = this.buildServiceRecordUrl(linkToken);
            const clientName = schedule.client?.name ?? "고객";
            const message = buildServiceRecordLinkMessage({
                clientName,
                employeeName: employee.name,
                serviceRecordUrl: url,
            });

            const pendingJob = MessageTriggerJobEntity.create({
                branchId: schedule.branchId,
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                scheduledFor,
                clientId: schedule.clientId,
                employeeScheduleId: scheduleId,
                recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                recipientPhone: resolvedRecipientPhone,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupeKey: options.isManualSend
                    ? `${originalKey}:manual:${randomUUID()}`
                    : automaticDedupeKey,
                payload: {
                    clientId: schedule.clientId,
                    ...(options.recovery ? { scheduleId, scheduleIncarnationId: schedule.incarnationId } : {}),
                    clientName,
                    employeeId: employee.id,
                    employeeName: employee.name,
                    memberId: `employee:${employee.id}`,
                    recipientName: employee.name,
                    recipientPhone: resolvedRecipientPhone,
                    buttonUrl: url,
                    messageBody: message,
                    templateVariables: {
                        clientName,
                        employeeName: employee.name,
                        serviceRecordUrl: url,
                        serviceStartDate: this.formatDate(schedule.startDate),
                        serviceEndDate: this.formatDate(schedule.endDate),
                    },
                    ...(options.taskAutomationReference
                        ? { taskAutomationReference: options.taskAutomationReference }
                        : {}),
                },
            });
            // The fence re-checks, after the job locks, that this link token was
            // not revoked while it was being prepared: a revoke is serialized
            // with the fence and cancels only what already exists.
            const linkGuard = { requireActiveLinkToken: linkToken };
            const promote = (transaction?: Prisma.TransactionClient) => this.jobRepository.promoteAutomaticSchedulingClaim(
                automaticSchedulingClaim!.id,
                automaticSchedulingClaim!.claimVersion,
                pendingJob,
                transaction,
                linkGuard,
            );
            let persistedJob: MessageTriggerJobEntity | null;
            if (options.recovery) {
                const admitted = await this.branchLock!.runExclusive(schedule.branchId,
                    (transaction) => options.recovery!(transaction, pendingJob, linkToken));
                persistedJob = admitted ? pendingJob : null;
            } else if (automaticReplacement) {
                if (!this.branchLock || !this.automationActivationService) throw new ServiceUnavailableException("Message automation activation is not configured");
                persistedJob = await this.branchLock.runExclusive(schedule.branchId, async (transaction) => {
                    await lockServiceRecordWriteSet(transaction, { branchId: schedule.branchId!, clientId: schedule.clientId });
                    const current = await transaction.employee_schedule.findFirst({
                        where: { id: scheduleId, branchId: schedule.branchId, clientId: schedule.clientId },
                        include: { primaryEmployee: true, client: true },
                    });
                    if (!current || current.replaced || current.terminatedAt || current.startDate.getTime() !== schedule.startDate.getTime()
                        || current.endDate.getTime() !== schedule.endDate.getTime() || current.primaryEmployeeId !== schedule.primaryEmployeeId
                        || current.primaryEmployee.name !== employee.name || current.primaryEmployee.phone !== employee.phone
                        || current.client.name !== schedule.client.name || current.client.serviceStatus !== schedule.client.serviceStatus
                        || current.client.startDate?.getTime() !== schedule.client.startDate?.getTime()
                        || current.client.endDate?.getTime() !== schedule.client.endDate?.getTime()
                        || current.client.bookingConfirmedAt?.getTime() !== schedule.client.bookingConfirmedAt?.getTime()) {
                        throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                    }
                    if (!(await this.automationActivationService!.getTriggerDispatchEnabled(schedule.branchId!, transaction))) return null;
                    const override = await transaction.message_trigger_rule_branch_override.findUnique({
                        where: { branchId_ruleId: { branchId: schedule.branchId!, ruleId: SERVICE_RECORD_LINK_RULE_ID } },
                    });
                    if (override?.isActive === false) return null;
                    const result = await this.jobRepository.replacePendingJobsUnlessInFlight(pendingJob,
                        SERVICE_RECORD_LINK_RESCHEDULED_REASON, { ...linkGuard, automaticOnly: true, transaction });
                    if (result.kind === "protected" || result.kind === "canceled") return null;
                    if (result.kind !== "replaced") throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                    return result.job;
                });
            } else if (automaticSchedulingClaim) {
                persistedJob = await this.branchLock!.runExclusive(
                    schedule.branchId,
                    (transaction) => promote(transaction),
                );
            } else if (options.isManualSend) {
                // The retry-log supersession runs inside the replacement's
                // transaction: if it fails, the replacement rolls back with it
                // instead of throwing after a committed (and still dispatchable)
                // send, which an operator retry would then duplicate.
                const replaced = await this.jobRepository.replacePendingJobsUnlessInFlight(
                    pendingJob,
                    SERVICE_RECORD_LINK_RESCHEDULED_REASON,
                    { requireActiveLinkToken: linkToken },
                    (transaction) => this.supersedeRetryableServiceRecordSmsLogs(
                        scheduleId,
                        SERVICE_RECORD_LINK_RESCHEDULED_REASON,
                        transaction,
                    ),
                );
                if (
                    replaced.kind === "protected"
                    || replaced.kind === "canceled"
                    || replaced.kind === "in_flight"
                    || replaced.kind === "lock_timeout"
                    || replaced.kind === "link_revoked"
                ) {
                    // Never queue a second send behind one the dispatcher
                    // already claimed; the caller re-reads the (sending) status.
                    // A lock held past the fence's lock_timeout is the same
                    // answer: nothing was written, try again. So is a link that
                    // was revoked while the send was being prepared: nothing was
                    // written and the caller re-reads the schedule.
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                }
                persistedJob = replaced.job;
            } else {
                persistedJob = await this.jobRepository.upsertPending(pendingJob);
            }

            if (!persistedJob) {
                return {
                    scheduledFor,
                    employeeId: employee.id,
                    jobEnqueued: false,
                    jobId: null,
                };
            }

            return {
                scheduledFor,
                employeeId: employee.id,
                jobEnqueued: true,
                jobId: persistedJob.id,
            };
        } finally {
            if (automaticSchedulingClaim) {
                await this.releaseAutomaticSchedulingClaim(automaticSchedulingClaim);
            }
        }
    }

    private async claimAutomaticScheduling(params: {
        branchId: string;
        scheduleId: number;
        clientId: number;
        clientName: string;
        employeeId: number;
        employeeName: string;
        recipientPhone: string | null;
        scheduledFor: Date;
        dedupeKey: string;
        serviceStartDate: string;
        serviceEndDate: string;
    }): Promise<AutomaticSchedulingClaim | null> {
        const payload = {
            clientId: params.clientId,
            clientName: params.clientName,
            employeeId: params.employeeId,
            employeeName: params.employeeName,
            memberId: `employee:${params.employeeId}`,
            recipientName: params.employeeName,
            recipientPhone: params.recipientPhone ?? "",
            buttonUrl: null,
            messageBody: null,
            templateVariables: {
                clientName: params.clientName,
                employeeName: params.employeeName,
                serviceRecordUrl: "",
                serviceStartDate: params.serviceStartDate,
                serviceEndDate: params.serviceEndDate,
            },
        };
        const claimInTransaction = async (transaction: Prisma.TransactionClient) => {
            if (!this.automationActivationService || !this.branchLock) {
                throw new ServiceUnavailableException("Message automation activation is not configured");
            }
            if (!(await this.automationActivationService.getTriggerDispatchEnabled(params.branchId, transaction))) {
                return [] as Array<{ id: string; claim_version: string }>;
            }
            const rule = await transaction.message_trigger_rule.findUnique({
                where: { id: SERVICE_RECORD_LINK_RULE_ID, deletedAt: null },
                select: { branchId: true, isActive: true },
            });
            const override = await transaction.message_trigger_rule_branch_override.findUnique({
                where: { branchId_ruleId: { branchId: params.branchId, ruleId: SERVICE_RECORD_LINK_RULE_ID } },
            });
            if (!rule || rule.branchId !== null || !rule.isActive || override?.isActive === false) {
                return [] as Array<{ id: string; claim_version: string }>;
            }
            return transaction.$queryRaw<Array<{ id: string; claim_version: string }>>(Prisma.sql`
            INSERT INTO "message_trigger_job" (
                branch_id,
                rule_id,
                status,
                scheduled_for,
                canceled_at,
                cancel_reason,
                canceled_by_user,
                client_id,
                employee_schedule_id,
                recipient_type,
                recipient_phone,
                template_key,
                dedupe_key,
                payload,
                attempts,
                next_attempt_at,
                updated_at
            )
            SELECT
                ${params.branchId}::uuid,
                ${SERVICE_RECORD_LINK_RULE_ID},
                'failed',
                ${params.scheduledFor},
                NULL,
                ${SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON},
                false,
                ${params.clientId},
                ${params.scheduleId},
                ${MessageTriggerRecipientType.PRIMARY_EMPLOYEE},
                ${params.recipientPhone},
                ${MessageTriggerTemplateKey.SERVICE_RECORD_LINK},
                ${params.dedupeKey},
                ${JSON.stringify(payload)}::jsonb,
                0,
                clock_timestamp() + (${AUTOMATIC_SCHEDULING_LEASE_MINUTES} * interval '1 minute'),
                clock_timestamp()
            WHERE NOT EXISTS (
                SELECT 1
                FROM "message_trigger_job" AS blocker
                WHERE blocker."employee_schedule_id" = ${params.scheduleId}
                  AND blocker.branch_id = ${params.branchId}::uuid
                  AND blocker."rule_id" = ${SERVICE_RECORD_LINK_RULE_ID}
                  AND ${serviceRecordScheduleBlockerSql({
                      status: Prisma.sql`blocker."status"`,
                      cancelReason: Prisma.sql`blocker."cancel_reason"`,
                      canceledByUser: Prisma.sql`blocker."canceled_by_user"`,
                      payload: Prisma.sql`blocker.payload`,
                      employeeId: params.employeeId,
                  })}
            )
            ON CONFLICT ("dedupe_key") DO UPDATE SET
                status = 'failed',
                scheduled_for = EXCLUDED.scheduled_for,
                canceled_at = NULL,
                cancel_reason = ${SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON},
                canceled_by_user = false,
                recipient_phone = EXCLUDED.recipient_phone,
                payload = EXCLUDED.payload,
                attempts = 0,
                next_attempt_at = clock_timestamp() + (${AUTOMATIC_SCHEDULING_LEASE_MINUTES} * interval '1 minute'),
                updated_at = clock_timestamp()
            WHERE (
                "message_trigger_job"."status" = 'failed'
                AND "message_trigger_job"."cancel_reason" = ${SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON}
                AND (
                    "message_trigger_job"."next_attempt_at" IS NULL
                    OR "message_trigger_job"."next_attempt_at" <= clock_timestamp()
                )
            ) OR (
                "message_trigger_job"."status" = 'canceled'
                AND "message_trigger_job"."canceled_by_user" = false
                AND "message_trigger_job"."cancel_reason" IN (
                    ${SERVICE_RECORD_LINK_RESCHEDULED_REASON},
                    ${SERVICE_RECORD_LINK_ENDED_REASON},
                    ${SERVICE_RECORD_LINK_BRANCH_DISABLED_REASON}
                )
            )
            RETURNING id, updated_at::text AS claim_version;
            `);
        };

        const claimed = await this.branchLock!.runExclusive(params.branchId, claimInTransaction);

        const [claim] = claimed;
        return claim
            ? {
                id: claim.id,
                claimVersion: claim.claim_version,
                dedupeKey: params.dedupeKey,
            }
            : null;
    }

    private async releaseAutomaticSchedulingClaim(claim: AutomaticSchedulingClaim): Promise<void> {
        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE "message_trigger_job"
            SET next_attempt_at = clock_timestamp() + (${AUTOMATIC_SCHEDULING_RETRY_DELAY_MS} * interval '1 millisecond'),
                updated_at = clock_timestamp()
            WHERE id = ${claim.id}
              AND dedupe_key = ${claim.dedupeKey}
              AND status = 'failed'
              AND cancel_reason = ${SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON}
              AND canceled_by_user = false
              AND updated_at = ${claim.claimVersion}::timestamptz;
        `);
    }

    private async ensureSystemRule(branchId?: string, allowParentDisabled = true): Promise<void> {
        const ensure = (transaction?: Prisma.TransactionClient) => this.automationLock.runExclusive(
            SystemTemplateKey.SERVICE_RECORD_LINK,
            async (writeTransaction) => {
                if (branchId && !allowParentDisabled) {
                    if (!(await this.automationActivationService!.getTriggerDispatchEnabled(branchId, writeTransaction))) {
                        return;
                    }
                }
                const template = await writeTransaction.system_template.findUnique({
                    where: { templateKey: SystemTemplateKey.SERVICE_RECORD_LINK },
                    select: { customVariables: true },
                });
                const unsupportedVariables = findUnsupportedRequiredMessageTriggerVariables(
                    MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                    readStoredCustomVariables(template?.customVariables ?? null),
                );
                if (unsupportedVariables.length > 0) {
                    throw new BadRequestException({
                        ...problemBody("VALIDATION_FAILED", {
                            pointer: "/templateKey",
                            code: "INVALID_VALUE",
                            detail: "활성 자동 발송 규칙에서 입력할 수 없는 필수 템플릿 변수가 있습니다.",
                            location: "body",
                        }),
                        unsupportedVariables,
                    });
                }

                // The `update: {}` upsert below still returns the row when it already exists, which
                // the realtime hint reads as a change: the 5-minute reconciler would broadcast
                // `message` to every branch each cycle for candidates it then refuses. Only write
                // when the rule is absent (serialised by the lock above, so no create race).
                const existingRule = await writeTransaction.message_trigger_rule.findUnique({
                    where: { id: SERVICE_RECORD_LINK_RULE_ID, deletedAt: null },
                    select: { id: true },
                });
                if (existingRule) return;

                await writeTransaction.message_trigger_rule.upsert({
                    where: { id: SERVICE_RECORD_LINK_RULE_ID },
                    create: {
                        id: SERVICE_RECORD_LINK_RULE_ID,
                        branchId: null,
                        name: SERVICE_RECORD_LINK_SMS_TITLE,
                        isActive: true,
                        eventType: MessageTriggerEventType.SERVICE_START,
                        offsetType: MessageTriggerOffsetType.SAME_DAY,
                        offsetDays: 0,
                        recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                        templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                        isDefault: false,
                        jobsStale: false,
                    },
                    update: {},
                });
            },
            transaction,
        );
        if (branchId && !allowParentDisabled) {
            if (!this.branchLock || !this.automationActivationService) {
                throw new ServiceUnavailableException("Message automation activation is not configured");
            }
            await this.branchLock.runExclusive(branchId, (transaction) => ensure(transaction));
            return;
        }
        await ensure();
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
                SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
                null,
                params.receiver,
                params.clientId,
                `[아가잼잼] ${params.clientName}님 제공기록지 작성 링크 발송 실패`,
                {
                    automationKey: SERVICE_RECORD_LINK_SMS_AUTOMATION_KEY,
                    triggerType: SERVICE_RECORD_LINK_SMS_TRIGGER_TYPE,
                    title: SERVICE_RECORD_LINK_SMS_TITLE,
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

    private normalizePhone(phone: string): string {
        return phone.replace(/\D/g, "");
    }

    private resolveRecipientPhone(employeePhone: string, recipientPhone?: string): string | null {
        const candidate = recipientPhone?.trim() || employeePhone;
        const normalized = this.normalizePhone(candidate);
        if (!/^01[016789]\d{7,8}$/.test(normalized)) {
            return null;
        }

        return recipientPhone ? normalized : employeePhone;
    }

    private buildServiceRecordUrl(linkToken: string): string {
        const base = this.configService
            .get<string>("MOBILE_SERVICE_RECORD_BASE_URL", DEFAULT_MOBILE_SERVICE_RECORD_BASE_URL)
            .replace(/\/+$/, "");
        return `${base}/service-record/${linkToken}`;
    }

    private resolveExpiry(endDate: Date, allowLateReissue: boolean): Date {
        const normalExpiry = getServiceRecordTokenExpiresAt(endDate);
        if (!allowLateReissue || normalExpiry.getTime() > Date.now()) return normalExpiry;
        return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
}
