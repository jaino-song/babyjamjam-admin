import { normalizePhone } from "application/utils/normalize-phone";
import { AligoDefaultSenderPolicyService } from "./aligo-default-sender-policy.service";
import { parseMessageQuietHold, type MessageQuietHold } from "domain/message-policy-evaluator";
import { isSelectedMessageJobExpired } from "./message-trigger-recipes";
import { MessageQuietHoursService, isQuietHoursCanceled, recordQuietHoursRefusal, runSmsQuietHoursAdmission, QUIET_HOURS_CANCEL_REASON, QUIET_HOURS_DEFER_REASON } from "./message-quiet-hours.service";
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { SystemSettingService } from "./system-setting.service";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { MessageAutomationActivationService, type AutomaticRetryRulePolicy } from "application/services/message-automation-activation.service";
import {
    RULE_RETRY_DISABLED_REASON,
    TARGET_CLIENT_STATUS_MISMATCH_REASON,
    targetClientStatusAllowsSend,
} from "application/policies/message-trigger-target-client-status.policy";
import { SmsAutomationSafeguardService, smsAutomationSafeguardReason } from "application/services/sms-automation-safeguard.service";
import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
import { SmsTriggerDeliveryService, type SmsTriggerDeliverySnapshot } from "application/services/sms-trigger-delivery.service";
import { parseKstSchedule } from "application/utils/kst-schedule";
import {
    MessageLogEntity,
    isRetryFamilyBlocker,
    withoutAligoHistoryBookkeeping,
    SMS_MANUAL_PROVIDER_REJECTED_RETRY_SAFETY,
    SMS_PARTIAL_RETRY_SAFETY,
} from "domain/entities/message-log.entity";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
    MessageRetryInvocation,
} from "domain/repositories/message-log.repository.interface";
import {
    buildSmsProviderAcceptanceFingerprint,
    buildSmsProviderAcceptanceKey,
    SmsProviderAcceptanceService,
    SmsProviderReconciliationInput,
} from "./sms-provider-acceptance.service";
import {
    classifySmsProviderRejection,
    classifySmsProviderOutcome,
    countSmsRecipients,
} from "./sms-provider-outcome.service";
import { readAutomationRetrySeal, type AutomationRetrySealState } from "./automation-retry-seal";
import { MessageTriggerJobEntity, type MessageTriggerJobPayload, type MessageTriggerJobStatus } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { getEffectiveClientServiceStatus } from "domain/repositories/client.repository.interface";
import { SERVICE_RECORD_LINK_PRE_BOOKING_REASON, SERVICE_RECORD_LINK_RESCHEDULED_REASON, SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY } from "domain/constants/service-record-link-message";
import { MESSAGE_TRIGGER_JOB_REPOSITORY, IMessageTriggerJobRepository } from "domain/repositories/message-trigger-job.repository.interface";

const INVALID_RETRY_SCHEDULE_REASON =
    "예약 발송 일시 형식이 올바르지 않아 재시도하지 않았습니다. 예약일과 예약시간을 확인해 주세요.";
const PARTIAL_RETRY_SUPERSEDED_REASON =
    "부분 발송 결과의 실패 수신자를 식별할 수 없어 자동 재전송을 중단했습니다. 수신자별로 확인 후 수동 발송해 주세요.";
const UNCERTAIN_RETRY_SUPERSEDED_REASON =
    "문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.";
const AUTOMATION_RETRY_SEAL_INVALID_REASON =
    "자동 문자 권한 증거가 현재 작업과 일치하지 않아 자동 재전송을 중단했습니다. 작업을 다시 검토해 주세요.";

export class SmsRetryTimingPolicyUnavailableError extends ServiceUnavailableException {
    constructor() {
        super("SMS retry timing policy is unavailable");
    }
}

interface RetrySchedule {
    scheduledDate?: string;
    scheduledTime?: string;
    scheduledAtMs: number | null;
}

type AutomaticRetryBoundary =
    | { kind: "terminal"; log: MessageLogEntity }
    | { kind: "claimed"; log: null }
    | {
        kind: "ready";
        schedule: RetrySchedule;
        retryLog: MessageLogEntity;
        providerAttempt: MessageLogEntity;
        retryDelayMs: number;
        authorizedSnapshot?: Readonly<SmsTriggerDeliverySnapshot>;
    };

type AutomaticRetryAuthorityState =
    | Extract<AutomationRetrySealState, { kind: "legacy" | "invalid" }>
    | (Extract<AutomationRetrySealState, { kind: "valid" }> & {
        snapshot: Readonly<SmsTriggerDeliverySnapshot>;
    });

@Injectable()
export class SmsRetryService {
    private readonly logger = new Logger(SmsRetryService.name);
    private readonly quietDeferredLogs = new WeakSet<MessageLogEntity>();

    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        @Optional()
        private readonly acceptanceService?: SmsProviderAcceptanceService,
        @Optional()
        private readonly messageAutomationActivationService?: MessageAutomationActivationService,
        @Optional()
        private readonly automationAuthority?: AgentAutomationJobAuthorityService,
        @Optional()
        private readonly smsTriggerDeliveryService?: SmsTriggerDeliveryService,
        @Optional()
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY)
        private readonly jobRepository?: IMessageTriggerJobRepository,
        // Required in production (no @Optional): the safeguard must never fail open.
        private readonly smsAutomationSafeguard?: SmsAutomationSafeguardService,
        // Nest injection is mandatory; legacy direct callers fail closed at timing lookup.
        private readonly systemSettingService?: SystemSettingService,
        private readonly quietHours?: MessageQuietHoursService,
        private readonly defaultSender?: AligoDefaultSenderPolicyService,
    ) {}

    async getRetryDelayMs(branchId: string | null): Promise<number> {
        if (!branchId || !this.systemSettingService) throw new SmsRetryTimingPolicyUnavailableError();
        try {
            const { configuration } = await this.systemSettingService.getMessageAutomationPolicyConfig(branchId);
            return configuration.smsRetryIntervalMinutes * 60 * 1000;
        } catch {
            throw new SmsRetryTimingPolicyUnavailableError();
        }
    }

    async retryById(branchId: string, logId: number): Promise<MessageLogEntity> {
        const sourceLog = await this.logRepository.findByIdInBranch(branchId, logId);
        if (!sourceLog || sourceLog.provider !== "aligo_sms") {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        if (sourceLog.status !== "failed") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        if (sourceLog.isPartialProviderOutcome()) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if (sourceLog.isProviderOutcomeUncertain()) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        // A prior retry attempt of this source ended without an accountable
        // outcome (partial batch or unclassified provider result). The
        // attempt row carries the marker, and the source row is fenced with
        // the same durable retrySafety value; refuse the whole-list resend
        // either way.
        if (sourceLog.variables["retrySafety"] === "uncertain") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if (sourceLog.providerAcceptanceState === "reconciled_delivered") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        if (
            sourceLog.errorMessage === SERVICE_RECORD_LINK_RESCHEDULED_REASON
            || sourceLog.errorMessage === SERVICE_RECORD_LINK_PRE_BOOKING_REASON
        ) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        const family = await this.logRepository.findRetryFamilyInBranch(branchId, sourceLog.id);
        if (family.some((log) => isQuietHoursCanceled(log) || (log.id !== sourceLog.id && isRetryFamilyBlocker(log)))) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        if (
            sourceLog.templateKey === SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY
            && await this.logRepository.hasNewerServiceRecordSmsInBranch(branchId, sourceLog)
        ) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        const retryLog = await this.retry(sourceLog, "manual");
        if (!retryLog) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        return retryLog;
    }

    async retry(
        sourceLog: MessageLogEntity,
        invocation: MessageRetryInvocation = "manual",
    ): Promise<MessageLogEntity | null> {
        if (isQuietHoursCanceled(sourceLog)) return sourceLog;
        if (sourceLog.variables["quietHoursDisposition"] === "DEFER") {
            if (sourceLog.status === "pending" && sourceLog.providerAcceptanceState === "prepared"
                && sourceLog.providerCallStartedAt === null && sourceLog.providerAcceptedAt === null && sourceLog.aligoMid === null
                && ["manual", "automatic"].includes(sourceLog.variables["retryInvocation"] ?? "")) {
                return this.resumeQuietRetry(sourceLog, invocation);
            }
            // 실제 거절 이후에는 안정된 quiet 이력을 보존한 채 기존 재시도 경로를 따른다.
            // 그 외 pending/시작됨/불확실/수락됨 상태를 새 시도로 되살리지 않는다.
            if (sourceLog.status !== "failed" || sourceLog.providerAcceptanceState !== "rejected") return sourceLog;
        }
        if (invocation === "automatic" && sourceLog.variables["origin"] === "ADMIN_DIRECT"
            && sourceLog.variables["manualQueueMode"] === "internal") return sourceLog;
        if (sourceLog.templateKey === SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY) {
            const client = await this.logRepository.findServiceRecordLinkClientState(sourceLog);
            if (client && getEffectiveClientServiceStatus(client.serviceStatus, client.startDate, client.endDate, client.bookingConfirmedAt) === "pre_booking") {
                if (invocation === "automatic") {
                    // The failed job would otherwise block re-issuing the link once the
                    // client leaves 예약 전; a system-cancelled row is revivable by the claim.
                    if (this.jobRepository && sourceLog.branchId && sourceLog.triggerJobId) {
                        await this.jobRepository.cancelFailedServiceRecordLinkJobForPreBooking(
                            sourceLog.triggerJobId,
                            sourceLog.branchId,
                        );
                    }
                    sourceLog.markRetrySuperseded(SERVICE_RECORD_LINK_PRE_BOOKING_REASON);
                    await this.logRepository.update(sourceLog);
                    return sourceLog;
                }
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/id",
                    code: "INVALID_VALUE",
                    detail: "예약 전 고객에게는 제공기록지 링크를 보낼 수 없습니다",
                    location: "path",
                }));
            }
        }
        if (
            invocation === "automatic"
            && sourceLog.branchId
            && sourceLog.triggerJobId
            && !this.messageAutomationActivationService
        ) {
            throw new ServiceUnavailableException("Message automation retry fence is not configured");
        }
        if (
            invocation === "automatic"
            && this.messageAutomationActivationService
            && sourceLog.branchId
            && sourceLog.triggerJobId
        ) {
            const boundary = await this.messageAutomationActivationService.runAutomaticRetryIfEnabled(
                sourceLog.branchId,
                sourceLog.triggerJobId,
                async (transaction, rulePolicy): Promise<AutomaticRetryBoundary> => {
                    const policySkip = await this.supersedeForRulePolicy(transaction, sourceLog, rulePolicy);
                    if (policySkip) return { kind: "terminal", log: policySkip };

                    // Send-time safeguard: an automatic retry is as automatic as
                    // the first send. Superseding (no retry row) leaves nothing
                    // to reschedule, so a blocked log cannot hot-loop.
                    const safeguardSkip = await this.supersedeForSmsSafeguard(sourceLog, transaction);
                    if (safeguardSkip) return { kind: "terminal", log: safeguardSkip };

                    if (sourceLog.isPartialProviderOutcome()) {
                        sourceLog.markRetrySuperseded(PARTIAL_RETRY_SUPERSEDED_REASON);
                        await this.logRepository.update(sourceLog, transaction);
                        return { kind: "terminal", log: sourceLog };
                    }

                    const schedule = this.parseRetrySchedule(sourceLog);
                    if (!schedule) {
                        sourceLog.markRetrySuperseded(INVALID_RETRY_SCHEDULE_REASON);
                        await this.logRepository.update(sourceLog, transaction);
                        return { kind: "terminal", log: sourceLog };
                    }

                    const retryAuthority = await this.verifyAutomaticRetryAuthority(transaction, sourceLog);
                    const retryDelayMs = await this.getRetryDelayMs(sourceLog.branchId);
                    const retryDraft = this.createRetryAttempt(sourceLog, retryDelayMs);
                    if (retryAuthority.kind === "valid") {
                        this.applyAuthorizedSnapshot(retryDraft, retryAuthority.snapshot);
                    }
                    const retryStart = await this.logRepository.startRetryAttempt(
                        sourceLog,
                        retryDraft,
                        invocation,
                        transaction,
                    );
                    if (retryStart.kind === "lost") return { kind: "claimed", log: null };
                    if (retryStart.kind === "suppressed") return { kind: "terminal", log: retryStart.log };
                    const retryLog = retryStart.log;

                    if (retryAuthority.kind === "invalid") {
                        retryLog.markRetrySuperseded(AUTOMATION_RETRY_SEAL_INVALID_REASON);
                        await this.logRepository.update(retryLog, transaction);
                        return { kind: "terminal", log: retryLog };
                    }

                    try {
                        await this.messageSenderApprovalService.ensureApproved(retryLog.branchId ?? sourceLog.branchId!);
                    } catch (approvalError) {
                        const reason = approvalError instanceof Error ? approvalError.message : String(approvalError);
                        retryLog.status = "failed";
                        retryLog.errorMessage = reason;
                        retryLog.attempts += 1;
                        retryLog.lastAttemptAt = new Date(Date.now());
                        retryLog.nextRetryAt = null;
                        await this.logRepository.update(retryLog, transaction);
                        return { kind: "terminal", log: retryLog };
                    }

                    const providerAttempt = await this.admitRetry(sourceLog, retryLog, transaction, invocation);
                    if (!providerAttempt) return { kind: "terminal", log: retryLog };
                    if (!this.acceptanceService) {
                        await this.logRepository.update(providerAttempt, transaction);
                    }
                    return {
                        kind: "ready",
                        schedule,
                        retryLog,
                        providerAttempt,
                        retryDelayMs,
                        ...(retryAuthority.kind === "valid" ? { authorizedSnapshot: retryAuthority.snapshot } : {}),
                    };
                },
            );
            if (!boundary.applies) {
                // Manual receipt/SR jobs use the existing retry path even when
                // the automation parent is disabled.
            } else {
                if (!boundary.allowed || !boundary.value) return null;
                if (boundary.value.kind === "terminal") return this.quietDeferredLogs.has(boundary.value.log)
                    ? this.logRepository.findByIdInBranch(sourceLog.branchId!, boundary.value.log.id) : boundary.value.log;
                if (boundary.value.kind === "claimed") return null;
                return this.sendRetryAttempt(
                    sourceLog,
                    boundary.value.schedule,
                    boundary.value.retryLog,
                    boundary.value.providerAttempt,
                    invocation,
                    boundary.value.retryDelayMs,
                    boundary.value.authorizedSnapshot,
                );
            }
        }

        // Automatic retries of jobs the activation boundary does not own
        // (AI-agent SMS) reach here; admin-direct jobs pass inside the check.
        if (invocation === "automatic") {
            const safeguardSkip = await this.supersedeForSmsSafeguard(sourceLog);
            if (safeguardSkip) return safeguardSkip;
        }

        if (sourceLog.isPartialProviderOutcome()) {
            sourceLog.markRetrySuperseded(PARTIAL_RETRY_SUPERSEDED_REASON);
            await this.logRepository.update(sourceLog);
            this.logger.warn(
                `[Retry] Skipped partial SMS log ${sourceLog.id}; recipient-level verification is required`,
            );
            return sourceLog;
        }

        const schedule = this.parseRetrySchedule(sourceLog);
        if (!schedule) {
            sourceLog.markRetrySuperseded(INVALID_RETRY_SCHEDULE_REASON);
            await this.logRepository.update(sourceLog);
            this.logger.warn(`[Retry] SMS log ${sourceLog.id} has an invalid historical schedule; retry stopped`);
            return sourceLog;
        }

        const retryDelayMs = await this.getRetryDelayMs(sourceLog.branchId);
        const retryStart = await this.logRepository.startRetryAttempt(
            sourceLog,
            this.createRetryAttempt(sourceLog, retryDelayMs),
            invocation,
        );
        if (retryStart.kind === "lost") {
            this.logger.warn(`[Retry] SMS log ${sourceLog.id} was already claimed`);
            return null;
        }
        if (retryStart.kind === "suppressed") {
            this.logger.warn(
                `[Retry] Skipped automatic service-end SMS log ${sourceLog.id}; client was already notified`,
            );
            return retryStart.log;
        }
        const retryLog = retryStart.log;

        if (retryLog.branchId) {
            try {
                await this.messageSenderApprovalService.ensureApproved(retryLog.branchId);
            } catch (approvalError) {
                const reason = approvalError instanceof Error ? approvalError.message : String(approvalError);
                this.logger.warn(`[Retry] SMS blocked by approval gate for log ${retryLog.id} (branchId=${retryLog.branchId}): ${reason}`);
                retryLog.status = "failed";
                retryLog.errorMessage = reason;
                retryLog.attempts += 1;
                retryLog.lastAttemptAt = new Date(Date.now());
                retryLog.nextRetryAt = null;
                await this.logRepository.update(retryLog);
                return retryLog;
            }
        }

        const providerAttempt = await this.admitRetry(sourceLog, retryLog, undefined, invocation);
        if (!providerAttempt) return this.quietDeferredLogs.has(retryLog) ? this.logRepository.findByIdInBranch(retryLog.branchId!, retryLog.id) : retryLog;

        return this.sendRetryAttempt(sourceLog, schedule, retryLog, providerAttempt, invocation, retryDelayMs);
    }

    private async admitRetry(source: MessageLogEntity, retry: MessageLogEntity, transaction?: Prisma.TransactionClient, invocation: MessageRetryInvocation = "automatic"): Promise<MessageLogEntity | null> {
        return runSmsQuietHoursAdmission(this.quietHours, this.systemSettingService, retry.branchId, retry.receiver,
            async (decision, tx, revision) => {
                if (decision.action === "DEFER") {
                    if (!tx || !revision) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                    const old = parseMessageQuietHold(retry.variables);
                    const job = retry.triggerJobId ? await tx.message_trigger_job.findFirst({ where: { id: retry.triggerJobId, branchId: retry.branchId } }) : null;
                    const hold: MessageQuietHold = { releaseAt: new Date(Math.max(old?.releaseAt.getTime() ?? 0, decision.reevaluateAt.getTime())),
                        originalScheduledFor: old?.originalScheduledFor ?? job?.scheduledFor ?? retry.createdAt,
                        policyRevision: old && decision.reevaluateAt <= old.releaseAt ? old.policyRevision : revision, reason: QUIET_HOURS_DEFER_REASON };
                    const sender = this.defaultSender?.read();
                    if (!sender || sender.availability !== "available") throw new SmsRetryTimingPolicyUnavailableError();
                    await this.logRepository.transitionQuietRetry(retry, hold, false, tx, undefined, invocation, sender.identityDigest);
                    this.quietDeferredLogs.add(retry);
                    return null;
                }
                if (decision.action !== "ALLOW") {
                    if (!tx) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                    const refused = await tx.message_log.updateMany({
                        where: { id: retry.id, branchId: retry.branchId, providerAcceptanceState: "prepared",
                            providerAcceptanceKey: retry.providerAcceptanceKey,
                            providerAcceptanceFingerprint: retry.providerAcceptanceFingerprint },
                        data: { status: "failed", nextRetryAt: null,
                            errorMessage: decision.action === "CANCEL" ? QUIET_HOURS_CANCEL_REASON : QUIET_HOURS_DEFER_REASON,
                            variables: { ...retry.variables, quietHoursDisposition: decision.action } },
                    });
                    if (refused.count !== 1) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                    recordQuietHoursRefusal(source, decision);
                    recordQuietHoursRefusal(retry, decision);
                    await this.logRepository.update(source, tx);
                    return null;
                }
                return this.acceptanceService
                    ? this.acceptanceService.beginProviderCall(retry, tx)
                    : this.beginProviderCallWithoutBoundary(retry);
            }, transaction);
    }

    /** Resume the same prepared acceptance; never create another retry attempt for quiet waiting. */
    private async resumeQuietRetry(retry: MessageLogEntity, invocation: MessageRetryInvocation): Promise<MessageLogEntity | null> {
        const hold = parseMessageQuietHold(retry.variables);
        const sourceId = Number(retry.variables["retryOfLogId"]);
        if (!hold || !retry.branchId || !this.quietHours || !Number.isSafeInteger(sourceId) || sourceId <= 0) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        if (retry.status !== "pending" || retry.providerAcceptanceState !== "prepared" || retry.providerCallStartedAt !== null
            || retry.providerAcceptedAt !== null || retry.aligoMid !== null) return retry;
        if (!retry.nextRetryAt || retry.nextRetryAt.getTime() > Date.now()) return retry;
        // Approval reads use the root client. Resolve them before taking a
        // branch connection; an unavailable/revoked approval leaves the hold intact.
        try {
            await this.messageSenderApprovalService.ensureApproved(retry.branchId);
        } catch {
            return retry;
        }
        const retryDelayMs = await this.getRetryDelayMs(retry.branchId);
        const resume = (transaction?: Prisma.TransactionClient, rulePolicy?: AutomaticRetryRulePolicy) => this.quietHours!.runAdmission(retry.branchId!, retry.receiver, async (_decision, tx) => {
            if (!tx) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            const current = await this.logRepository.findByIdInBranch(retry.branchId!, retry.id, tx);
            const source = await this.logRepository.findByIdInBranch(retry.branchId!, sourceId, tx);
            if (!current || !source || current.status !== "pending" || current.provider !== "aligo_sms" || source.provider !== "aligo_sms"
                || current.providerAcceptanceState !== "prepared" || current.providerCallStartedAt !== null
                || current.providerAcceptedAt !== null || current.aligoMid !== null
                || current.providerAcceptanceKey !== retry.providerAcceptanceKey || current.providerAcceptanceFingerprint !== retry.providerAcceptanceFingerprint
                || current.variables["retryOfLogId"] !== String(sourceId)
                || !["manual", "automatic"].includes(current.variables["retryInvocation"] ?? "")
                || current.variables["retryInvocation"] !== retry.variables["retryInvocation"]
                || current.triggerJobId !== retry.triggerJobId
                || current.triggerJobId !== source.triggerJobId || current.receiver !== source.receiver || current.messageBody !== source.messageBody
                || current.isPartialProviderOutcome() || current.isManualProviderRejection()
                || (current.variables["retryInvocation"] === "automatic" && source.isManualProviderRejection())
                || source.isProviderOutcomeUncertain() || source.variables["retrySafety"] === "uncertain"
                || source.providerAcceptanceState === "accepted" || source.providerAcceptanceState === "reconciled_delivered"
                || source.status !== "failed" || source.isPartialProviderOutcome()) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            const sender = this.defaultSender?.read();
            if (!sender || sender.availability !== "available" || sender.identityDigest !== current.variables["retrySenderIdentity"]) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            const identity = current.clientId != null && !current.variables["employeeId"]
                ? await tx.client.findFirst({ where: { id: current.clientId, branchId: current.branchId!, deletedAt: null }, select: { phone: true } })
                : Number(current.variables["employeeId"]) > 0 ? await tx.employee.findFirst({ where: { id: Number(current.variables["employeeId"]), branchId: current.branchId!, deletedAt: null }, select: { phone: true } }) : null;
            if (identity && normalizePhone(identity.phone) !== normalizePhone(current.receiver)) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            if ((current.clientId != null || Number(current.variables["employeeId"]) > 0) && !identity) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            const currentHold = parseMessageQuietHold(current.variables);
            if (!currentHold || !current.nextRetryAt || current.nextRetryAt.getTime() > Date.now()) return null;
            const explicitManual = current.variables["retryInvocation"] === "manual";
            if (!explicitManual) {
                const enabled = await this.systemSettingService!.getMessageSettingsPolicyEnabled(current.branchId!, "sms-retry", async key => {
                    const row = await tx.system_setting.findUnique({ where: { key } });
                    if (row && row.value !== "true" && row.value !== "false") throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                    return row?.value ?? null;
                });
                if (!enabled) return null;
                if (await this.supersedeForRulePolicy(tx, current, rulePolicy)) return null;
            }
            const safeguard = !explicitManual ? await this.supersedeForSmsSafeguard(current, tx) : null;
            if (safeguard) return null;
            const authority = await this.verifyAutomaticRetryAuthority(tx, source);
            if (authority.kind === "invalid") return null;
            if (current.triggerJobId) {
                const job = this.jobRepository && await this.jobRepository.findByIdInBranch(current.branchId!, current.triggerJobId, tx);
                if (!job || job.scheduledFor.getTime() !== currentHold.originalScheduledFor.getTime()) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                if (current.templateKey === SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY) {
                    const schedule = job.employeeScheduleId ? await tx.employee_schedule.findFirst({ where: { id: job.employeeScheduleId, branchId: current.branchId! } }) : null;
                    let token: string | null = null;
                    try { token = new URL(job.payload.buttonUrl ?? "").pathname.split("/service-record/")[1] ?? null; } catch { /* Invalid links fail closed below. */ }
                    const valid = token && schedule && !schedule.replaced && !schedule.terminatedAt
                        && schedule.primaryEmployeeId === job.payload.employeeId
                        ? await tx.service_record_token.findFirst({ where: { branchId: current.branchId!, scheduleId: schedule.id,
                            employeeId: schedule.primaryEmployeeId!, linkTokenHash: token, active: true, revokedAt: null, expiresAt: { gt: new Date(Date.now()) } } }) : null;
                    if (!valid) { await this.logRepository.transitionQuietRetry(current, currentHold, true, tx, "stale_link"); return null; }
                }
                const policy = await this.systemSettingService!.getMessageAutomationPolicyConfig(current.branchId!, tx);
                if (isSelectedMessageJobExpired(job,
                    policy.configuration.pastExpiryHours, new Date(Date.now()), currentHold.releaseAt)) {
                    await this.logRepository.transitionQuietRetry(current, currentHold, true, tx, "expired_after_quiet");
                    return null;
                }
            }
            if (explicitManual) {
                const enabled = await this.systemSettingService!.getMessageSettingsPolicyEnabled(current.branchId!, "duplicate-send-confirmation", async key => {
                    const row = await tx.system_setting.findUnique({ where: { key } });
                    if (row && row.value !== "true" && row.value !== "false") throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                    return row?.value ?? null;
                });
                if (enabled) {
                    const policy = await this.systemSettingService!.getMessageAutomationPolicyConfig(current.branchId!, tx);
                    const at = new Date(Date.now());
                    const matches = await this.logRepository.findSmsDuplicateMatches({ branchId: current.branchId!, receivers: current.receiver.split(",").map(phone => normalizePhone(phone)).filter((phone): phone is string => Boolean(phone)),
                        messageBody: current.messageBody.replace(/\r\n/g, "\n").trim(), from: new Date(at.getTime() - policy.configuration.duplicateWindowHours * 3_600_000), to: at }, tx);
                    if (matches.some(match => match.sentAt >= current.createdAt)) {
                        await this.logRepository.transitionQuietRetry(current, currentHold, true, tx, "duplicate_at_release"); return null;
                    }
                }
            }
            const result = await runSmsQuietHoursAdmission(this.quietHours, this.systemSettingService, current.branchId, current.receiver,
                async (decision, finalTx) => {
                    if (!finalTx) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                    if (decision.action !== "ALLOW") {
                        await this.logRepository.transitionQuietRetry(current, decision.action === "DEFER"
                            ? { ...currentHold, releaseAt: new Date(Math.max(currentHold.releaseAt.getTime(), decision.reevaluateAt.getTime())) } : currentHold,
                            decision.action === "CANCEL", finalTx);
                        return null;
                    }
                    const providerAttempt = this.acceptanceService ? await this.acceptanceService.beginProviderCall(current, finalTx) : this.beginProviderCallWithoutBoundary(current);
                    return { source, current, providerAttempt, explicitManual, ...(authority.kind === "valid" ? { snapshot: authority.snapshot } : {}) };
                }, tx, currentHold.releaseAt);
            return result;
        }, transaction);
        let admitted: Awaited<ReturnType<typeof resume>> = null;
        if (retry.variables["retryInvocation"] !== "manual") {
            if (!retry.triggerJobId || !this.messageAutomationActivationService) return retry;
            // The existing automatic retry boundary owns the branch transaction.
            // Quiet admission and its final provider CAS reuse that transaction.
            const boundary = await this.messageAutomationActivationService.runAutomaticRetryIfEnabled(
                retry.branchId, retry.triggerJobId, (tx, rulePolicy) => resume(tx, rulePolicy),
            );
            if (boundary.applies) {
                if (!boundary.allowed) return retry;
                admitted = boundary.value ?? null;
            } else {
                admitted = await resume();
            }
        } else {
            admitted = await resume();
        }
        if (!admitted) return this.logRepository.findByIdInBranch(retry.branchId, retry.id);
        return this.sendRetryAttempt(admitted.source, { scheduledAtMs: null }, admitted.current, admitted.providerAttempt, admitted.explicitManual ? "manual" : invocation, retryDelayMs, admitted.snapshot);
    }

    /**
     * 규칙 메시지-04 at the automatic retry boundary, using the rule values read
     * under the boundary's lock (so a toggle changed after the retry was
     * scheduled still applies). Both outcomes are non-failure skips: the source
     * log is superseded with a greppable reason token, nothing is sent and
     * nothing is rescheduled. Manual [재발송] never reaches this method.
     */
    private async supersedeForRulePolicy(
        transaction: Prisma.TransactionClient,
        sourceLog: MessageLogEntity,
        rulePolicy: AutomaticRetryRulePolicy | undefined,
    ): Promise<MessageLogEntity | null> {
        if (!rulePolicy) return null;
        if (!rulePolicy.retryOnFailure) {
            sourceLog.markRetrySuperseded(RULE_RETRY_DISABLED_REASON);
            await this.logRepository.update(sourceLog, transaction);
            return sourceLog;
        }
        // A job with no client is not subject to the target-status gate.
        if (rulePolicy.targetClientStatus === "all" || !sourceLog.branchId || rulePolicy.clientId === null) return null;
        const client = await transaction.client.findFirst({
            where: { id: rulePolicy.clientId, branchId: sourceLog.branchId },
            select: { serviceStatus: true, startDate: true, endDate: true, bookingConfirmedAt: true },
        });
        if (targetClientStatusAllowsSend(rulePolicy.targetClientStatus, client)) return null;
        sourceLog.markRetrySuperseded(TARGET_CLIENT_STATUS_MISMATCH_REASON);
        await this.logRepository.update(sourceLog, transaction);
        return sourceLog;
    }

    /**
     * Gate an automatic retry of a job-bound log on the SMS automation
     * safeguard (rule, recipient flag, branch switch). Job-less logs are never
     * automatically retried and are left to their existing handling.
     */
    private async supersedeForSmsSafeguard(
        sourceLog: MessageLogEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageLogEntity | null> {
        if (!this.smsAutomationSafeguard || !sourceLog.branchId || !sourceLog.triggerJobId) return null;
        const decision = await this.smsAutomationSafeguard.checkJobById(sourceLog.branchId, sourceLog.triggerJobId, transaction);
        if (decision.allowed) return null;
        this.smsAutomationSafeguard.warnBlocked(`retry of message log ${sourceLog.id} (job ${sourceLog.triggerJobId})`, decision);
        sourceLog.markRetrySuperseded(smsAutomationSafeguardReason(decision.level));
        await (transaction ? this.logRepository.update(sourceLog, transaction) : this.logRepository.update(sourceLog));
        return sourceLog;
    }

    /**
     * Automatic task-owned retries must prove the same persisted job, seal and
     * provider snapshot that produced the failed log. Legacy rows without a
     * job seal retain the existing retry path for backward compatibility.
     */
    private async verifyAutomaticRetryAuthority(
        transaction: Prisma.TransactionClient,
        sourceLog: MessageLogEntity,
    ): Promise<AutomaticRetryAuthorityState> {
        if (!sourceLog.branchId || !sourceLog.triggerJobId) return { kind: "legacy" };
        try {
            const row = await transaction.message_trigger_job.findUnique({ where: { id: sourceLog.triggerJobId } });
            if (!row || row.branchId !== sourceLog.branchId) {
                return { kind: "invalid", reason: "retry source job is missing or cross-branch" };
            }
            const job = MessageTriggerJobEntity.reconstitute(
                row.id,
                row.branchId,
                row.ruleId,
                row.status as MessageTriggerJobStatus,
                row.scheduledFor,
                row.sentAt,
                row.canceledAt,
                row.cancelReason,
                row.clientId,
                row.employeeScheduleId,
                row.recipientType as MessageTriggerRecipientType,
                row.recipientPhone,
                row.templateKey as MessageTriggerTemplateKey,
                row.dedupeKey,
                (row.payload as unknown as MessageTriggerJobPayload) ?? {
                    memberId: "",
                    recipientName: "",
                    recipientPhone: "",
                    templateVariables: {},
                },
                row.createdAt,
                row.updatedAt,
                row.attempts,
                row.nextAttemptAt,
                row.claimToken,
            );
            const seal = readAutomationRetrySeal(job, sourceLog.variables);
            if (seal.kind !== "valid") return seal;
            if (!this.automationAuthority || !this.smsTriggerDeliveryService) {
                return { kind: "invalid", reason: "automatic retry authority is not configured" };
            }
            let canonicalSnapshot: Readonly<SmsTriggerDeliverySnapshot> | undefined;
            const authority = await this.automationAuthority.checkAutomaticJob(
                transaction,
                job,
                "dispatch",
                async (current, tx) => {
                    canonicalSnapshot = await this.smsTriggerDeliveryService!.resolveCanonicalDeliverySnapshot(current, tx);
                    return canonicalSnapshot;
                },
                seal.snapshotHash,
            );
            if (authority.status !== "allowed" || agentBindingHash(authority.seal) !== seal.sealDigest
                || !canonicalSnapshot || canonicalSnapshot.snapshotHash !== seal.snapshotHash) {
                return { kind: "invalid", reason: "retry authority no longer matches current source" };
            }
            return { ...seal, snapshot: canonicalSnapshot };
        } catch (error) {
            this.logger.warn(`[Retry] Automatic authority verification failed: ${error instanceof Error ? error.message : String(error)}`);
            return { kind: "invalid", reason: "retry authority could not be verified" };
        }
    }

    private applyAuthorizedSnapshot(
        log: MessageLogEntity,
        snapshot: Readonly<SmsTriggerDeliverySnapshot>,
    ): void {
        log.receiver = snapshot.receiver;
        log.recipientName = snapshot.recipientName;
        log.recipientPhone = snapshot.receiver;
        log.messageBody = snapshot.message;
        log.variables = {
            ...log.variables,
            title: snapshot.title,
            msgType: snapshot.requestedDeliveryType,
        };
        log.providerAcceptanceFingerprint = buildSmsProviderAcceptanceFingerprint({
            branchId: log.branchId,
            triggerJobId: log.triggerJobId,
            templateKey: log.templateKey,
            receiver: snapshot.receiver,
            message: snapshot.message,
            variables: log.variables,
            retryAttempt: log.attempts,
        });
    }

    private async sendRetryAttempt(
        sourceLog: MessageLogEntity,
        schedule: RetrySchedule,
        retryLog: MessageLogEntity,
        providerAttempt: MessageLogEntity,
        invocation: MessageRetryInvocation,
        retryDelayMs: number,
        authorizedSnapshot?: Readonly<SmsTriggerDeliverySnapshot>,
    ): Promise<MessageLogEntity> {
        const isScheduledInFuture = schedule.scheduledAtMs !== null && schedule.scheduledAtMs > Date.now();
        const scheduledDate = isScheduledInFuture ? schedule.scheduledDate : undefined;
        const scheduledTime = isScheduledInFuture ? schedule.scheduledTime : undefined;

        try {
            const result = await this.aligoService.sendSms({
                senderPhone: this.stringVariable(retryLog, "senderPhone"),
                receiver: authorizedSnapshot?.receiver ?? providerAttempt.receiver,
                message: authorizedSnapshot?.message ?? providerAttempt.messageBody,
                recipientName: authorizedSnapshot?.recipientName
                    ?? providerAttempt.recipientName
                    ?? this.stringVariable(providerAttempt, "recipientName")
                    ?? undefined,
                title: authorizedSnapshot?.title ?? this.stringVariable(providerAttempt, "title") ?? undefined,
                msgType: authorizedSnapshot?.requestedDeliveryType ?? this.smsMessageTypeVariable(providerAttempt, "msgType"),
                ...(scheduledDate ? { scheduledDate } : {}),
                ...(scheduledTime ? { scheduledTime } : {}),
                ...(this.booleanVariable(retryLog, "testMode") ? { testMode: true } : {}),
            });

            const providerOutcome = classifySmsProviderOutcome(
                result,
                countSmsRecipients(authorizedSnapshot?.receiver ?? providerAttempt.receiver),
            );
            if (providerOutcome === "rejected") {
                this.markSmsRetryRejected(providerAttempt, this.providerResponseMessage(result), invocation, retryDelayMs);
                // 수동 재시도의 주차 정책은 변경하지 않는다.
                if (invocation === "automatic") {
                    const rejection = classifySmsProviderRejection(result);
                    if (rejection.kind === "permanent") {
                        providerAttempt.nextRetryAt = null;
                        providerAttempt.errorMessage = `발송 실패: ${rejection.reason}`;
                        providerAttempt.variables = {
                            ...providerAttempt.variables,
                            retrySafety: "permanent-provider-rejected",
                        };
                    } else if (providerAttempt.nextRetryAt && !(await this.ruleStillPermitsAutomaticRetry(sourceLog))) {
                        // 규칙 메시지-04: the toggle was read at admission, before the
                        // provider call. Decide the next attempt from the rule's
                        // CURRENT value, as for a rule that was off at first send.
                        providerAttempt.nextRetryAt = null;
                    }
                }
                await this.logRepository.update(providerAttempt);
                this.logger.warn(`[Retry] SMS retry rejected for log ${providerAttempt.id}: ${this.providerResponseMessage(result)}`);
                return providerAttempt;
            }
            if (providerOutcome === "partial") {
                this.markSmsRetryPartial(providerAttempt, this.providerResponseMessage(result));
                await this.logRepository.update(providerAttempt);
                // Aligo's batch response never identifies which recipients
                // failed. Fence the source row itself: it stays `failed` in
                // history, and its durable retrySafety marker forbids another
                // whole-recipient-list resend even after a restart.
                await this.fenceSourceLogAfterUnidentifiableOutcome(
                    sourceLog,
                    SMS_PARTIAL_RETRY_SAFETY,
                    `${this.providerResponseMessage(result)} ${PARTIAL_RETRY_SUPERSEDED_REASON}`.trim(),
                );
                this.logger.warn(
                    `[Retry] SMS retry partially accepted for log ${providerAttempt.id}; automatic retry stopped`,
                );
                return providerAttempt;
            }
            if (providerOutcome === "unknown") {
                this.markSmsRetryUncertain(providerAttempt, "문자 발송 결과를 확인할 수 없어 자동 재전송을 중단했습니다.");
                await this.logRepository.update(providerAttempt);
                await this.fenceSourceLogAfterUnidentifiableOutcome(
                    sourceLog,
                    "uncertain",
                    UNCERTAIN_RETRY_SUPERSEDED_REASON,
                );
                this.logger.warn(
                    `[Retry] SMS retry result was not classifiable for log ${providerAttempt.id}; automatic retry stopped`,
                );
                return providerAttempt;
            }

            providerAttempt.variables = { ...providerAttempt.variables, retrySafety: "accepted" };
            if (isScheduledInFuture) {
                providerAttempt.status = "pending";
                providerAttempt.aligoMid = result.response.msg_id ? String(result.response.msg_id) : null;
                providerAttempt.lastAttemptAt = new Date(Date.now());
                providerAttempt.nextRetryAt = null;
                providerAttempt.attempts += 1;
            } else {
                providerAttempt.markSent(result.response.msg_id ? String(result.response.msg_id) : undefined);
            }
            providerAttempt.providerAcceptanceState = "accepted";
            providerAttempt.providerAcceptedAt = new Date(Date.now());
            if (providerAttempt.aligoMid) {
                // Reserved sends are delivered at the reserved time, so the
                // 30-minute carrier check counts from then; otherwise from now.
                providerAttempt.scheduleCarrierCheck(
                    isScheduledInFuture && schedule.scheduledAtMs !== null
                        ? new Date(schedule.scheduledAtMs)
                        : providerAttempt.providerAcceptedAt,
                );
            }
            await this.logRepository.update(providerAttempt);
            this.logger.log(`[Retry] Successfully resent SMS ${providerAttempt.templateKey} to ${providerAttempt.receiver}`);
            return providerAttempt;
        } catch (error) {
            this.markSmsRetryUncertain(providerAttempt, error instanceof Error ? error.message : String(error));
            await this.logRepository.update(providerAttempt);
            await this.fenceSourceLogAfterUnidentifiableOutcome(
                sourceLog,
                "uncertain",
                UNCERTAIN_RETRY_SUPERSEDED_REASON,
            );
            this.logger.warn(
                `[Retry] SMS result uncertain for log ${providerAttempt.id}; automatic retry stopped: ${error}`,
            );
            return providerAttempt;
        }
    }

    /**
     * Whether the rule's CURRENT 실패 시 재전송 still allows scheduling another
     * automatic attempt after a provider rejection (the provider call has
     * already happened). Off means no; a missing rule row means yes. A failed
     * read is not permission: the rejection is final. Never throws, so the
     * caller's outcome handling cannot misread a lookup failure as uncertain.
     */
    private async ruleStillPermitsAutomaticRetry(sourceLog: MessageLogEntity): Promise<boolean> {
        if (sourceLog.variables["origin"] === "ADMIN_DIRECT" && sourceLog.variables["manualQueueMode"] === "internal") return false;
        if (!this.messageAutomationActivationService || !sourceLog.branchId || !sourceLog.triggerJobId) return true;
        try {
            return await this.messageAutomationActivationService
                .readJobRuleRetryPermission(sourceLog.branchId, sourceLog.triggerJobId) !== "off";
        } catch (error) {
            this.logger.warn(
                `[Retry] Could not read the current retry policy for log ${sourceLog.id}; the rejection is final: ${
                    error instanceof Error ? error.name : "unknown error"
                }`,
            );
            return false;
        }
    }

    /**
     * Persist the whole-list resend ban on the row the user can still retry.
     * A retry attempt is a separate history row; without this fence the source
     * row stays an ordinary retryable failure and a restarted process (or a
     * second manual request) would replay the full recipient list even though
     * a prior attempt's per-recipient outcome cannot be accounted for.
     */
    private async fenceSourceLogAfterUnidentifiableOutcome(
        sourceLog: MessageLogEntity,
        retrySafety: (typeof SMS_PARTIAL_RETRY_SAFETY) | "uncertain",
        reason: string,
    ): Promise<void> {
        try {
            sourceLog.status = "failed";
            sourceLog.nextRetryAt = null;
            sourceLog.errorMessage = reason;
            sourceLog.variables = {
                ...sourceLog.variables,
                retrySafety,
            };
            await this.logRepository.update(sourceLog);
        } catch (fenceError) {
            // The attempt row is already fenced; never mask its outcome with a
            // source-fence persistence failure, but keep the gap visible.
            this.logger.warn(
                `[Retry] Failed to fence source log ${sourceLog.id} after an unidentifiable outcome: ${fenceError}`,
            );
        }
    }

    async reconcileById(
        branchId: string,
        logId: number,
        outcome: SmsProviderReconciliationInput["outcome"],
        actor: string,
        reason: string,
        providerMessageId?: string | null,
    ): Promise<MessageLogEntity> {
        if (!this.acceptanceService) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        return this.acceptanceService.reconcile({
            branchId,
            logId,
            outcome,
            actor,
            reason,
            providerMessageId,
        });
    }

    private createRetryAttempt(sourceLog: MessageLogEntity, retryDelayMs: number): MessageLogEntity {
        const now = new Date(Date.now());
        const recoveryAt = new Date(now.getTime() + retryDelayMs);
        const retryAttempt = sourceLog.attempts + 1;
        const providerAcceptanceKey = buildSmsProviderAcceptanceKey(
            "retry",
            `${sourceLog.providerAcceptanceKey ?? `legacy:${sourceLog.id}`}:revision:${sourceLog.updatedAt.toISOString()}:attempt:${retryAttempt}`,
        );
        const providerAcceptanceFingerprint = sourceLog.providerAcceptanceFingerprint
            ?? buildSmsProviderAcceptanceFingerprint({
                branchId: sourceLog.branchId,
                triggerJobId: sourceLog.triggerJobId,
                templateKey: sourceLog.templateKey,
                receiver: sourceLog.receiver,
                message: sourceLog.messageBody,
                variables: sourceLog.variables,
                retryAttempt,
            });
        const sourceVariables = withoutAligoHistoryBookkeeping(sourceLog.variables);
        delete sourceVariables["retryInvocation"];
        delete sourceVariables["retrySenderIdentity"];
        return MessageLogEntity.reconstitute(
            0,
            sourceLog.branchId,
            sourceLog.provider,
            sourceLog.templateKey,
            sourceLog.triggerJobId,
            sourceLog.receiver,
            sourceLog.clientId,
            sourceLog.messageBody,
            {
                ...sourceVariables,
                retryOfLogId: String(sourceLog.id),
                retryAttempt: String(retryAttempt),
                // Persist the attempt conservatively before the provider call. If the
                // process exits after submission but before the result update, the
                // scheduler must not submit the same SMS again automatically.
                retrySafety: "uncertain",
            },
            "pending",
            null,
            null,
            sourceLog.attempts,
            null,
            recoveryAt,
            now,
            now,
            sourceLog.recipientName,
            sourceLog.recipientPhone,
            providerAcceptanceKey,
            providerAcceptanceFingerprint,
            "prepared",
        );
    }

    private parseRetrySchedule(log: MessageLogEntity): RetrySchedule | null {
        const rawDate: unknown = log.variables["scheduledDate"];
        const rawTime: unknown = log.variables["scheduledTime"];
        const isExplicitlyScheduled = log.variables["triggerType"] === "scheduled";
        const hasDate = rawDate !== undefined && rawDate !== null;
        const hasTime = rawTime !== undefined && rawTime !== null;

        if (!hasDate && !hasTime) {
            // 내부 큐 예약은 job의 due 시각에 이미 실행되므로 제공자 예약 필드가 없다.
            if (log.templateKey === "manual_sms" && log.triggerJobId
                && log.variables["origin"] === "ADMIN_DIRECT" && log.variables["manualQueueMode"] === "internal") {
                return { scheduledAtMs: null };
            }
            return isExplicitlyScheduled ? null : { scheduledAtMs: null };
        }
        if (!hasDate || !hasTime || typeof rawDate !== "string" || typeof rawTime !== "string") {
            return null;
        }
        if (!/^\d{8}$/.test(rawDate) || !/^\d{4}$/.test(rawTime)) {
            return null;
        }

        const isoDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
        const isoTime = `${rawTime.slice(0, 2)}:${rawTime.slice(2, 4)}`;
        const scheduledAt = parseKstSchedule(isoDate, isoTime);
        if (!scheduledAt) {
            return null;
        }

        return {
            scheduledDate: rawDate,
            scheduledTime: rawTime,
            scheduledAtMs: scheduledAt.getTime(),
        };
    }

    private markSmsRetryRejected(
        log: MessageLogEntity,
        errorMessage: string,
        invocation: MessageRetryInvocation,
        retryDelayMs: number,
    ): void {
        log.status = "failed";
        log.providerAcceptanceState = "rejected";
        log.providerAcceptedAt = null;
        log.errorMessage = errorMessage;
        log.attempts += 1;
        log.lastAttemptAt = new Date(Date.now());
        log.variables = {
            ...log.variables,
            retrySafety: invocation === "manual"
                ? SMS_MANUAL_PROVIDER_REJECTED_RETRY_SAFETY
                : "provider-rejected",
        };
        if (invocation === "manual") {
            // A user-initiated history retry is a separate authorization event.
            // Keep the failed row available for a later deliberate retry, but
            // do not turn the provider's definitive rejection into an
            // unannounced worker submission.
            log.nextRetryAt = null;
            return;
        }
        // Trigger-delivery retries retain their existing bounded automatic
        // policy. Their provider-rejected marker remains distinct from the
        // manual marker above so a scheduler tick can continue that path.
        // 규칙 메시지-04: this attempt was admitted with the rule's 실패 시 재전송
        // on; sendRetryAttempt re-checks the rule's CURRENT value before keeping
        // this schedule, and the next pick is superseded at the boundary too.
        log.nextRetryAt = log.canRetry()
            ? new Date(Date.now() + retryDelayMs)
            : null;
    }

    private markSmsRetryPartial(log: MessageLogEntity, errorMessage: string): void {
        log.status = "failed";
        log.providerAcceptanceState = "uncertain";
        log.providerAcceptedAt = null;
        log.errorMessage = `${errorMessage} ${PARTIAL_RETRY_SUPERSEDED_REASON}`.trim();
        log.attempts += 1;
        log.lastAttemptAt = new Date(Date.now());
        log.nextRetryAt = null;
        log.variables = {
            ...log.variables,
            retrySafety: SMS_PARTIAL_RETRY_SAFETY,
        };
    }

    private markSmsRetryUncertain(log: MessageLogEntity, errorMessage: string): void {
        log.status = "failed";
        log.errorMessage = `${errorMessage} 문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.`;
        log.attempts += 1;
        log.lastAttemptAt = new Date(Date.now());
        log.nextRetryAt = null;
        log.variables = {
            ...log.variables,
            retrySafety: "uncertain",
        };
        log.providerAcceptanceState = log.providerAcceptanceState === "started"
            ? "uncertain"
            : log.providerAcceptanceState;
    }

    private beginProviderCallWithoutBoundary(log: MessageLogEntity): MessageLogEntity {
        if (log.providerAcceptanceState !== "prepared" && log.providerAcceptanceState !== "legacy") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        log.providerAcceptanceState = "started";
        log.providerCallStartedAt = new Date(Date.now());
        return log;
    }

    private providerResponseMessage(result: unknown): string {
        if (!this.isRecord(result)) {
            return "문자 발송 요청이 실패했습니다.";
        }
        const response = result["response"];
        if (!this.isRecord(response)) {
            return "문자 발송 요청이 실패했습니다.";
        }
        const message = response["message"];
        return typeof message === "string" && message.trim()
            ? message
            : "문자 발송 요청이 실패했습니다.";
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    private stringVariable(log: MessageLogEntity, key: string): string | undefined {
        const value = log.variables[key];
        return typeof value === "string" && value.trim() ? value : undefined;
    }

    private smsMessageTypeVariable(
        log: MessageLogEntity,
        key: string,
    ): "SMS" | "LMS" | "AUTO" | undefined {
        const value = this.stringVariable(log, key);
        return value === "SMS" || value === "LMS" || value === "AUTO" ? value : undefined;
    }

    private booleanVariable(log: MessageLogEntity, key: string): boolean {
        return this.stringVariable(log, key) === "true";
    }
}
