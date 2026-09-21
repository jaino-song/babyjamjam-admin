import { ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { parseKstSchedule } from "application/utils/kst-schedule";
import { maskPhone } from "application/utils/mask";
import {
    MessageLogEntity,
    SMS_MANUAL_PROVIDER_REJECTED_RETRY_SAFETY,
    SMS_DELIVERY_RETRY_DELAY_MS,
    SMS_PARTIAL_RETRY_SAFETY,
} from "domain/entities/message-log.entity";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import {
    buildSmsProviderAcceptanceFingerprint,
    buildSmsProviderAcceptanceKey,
    SmsProviderAcceptanceService,
    SmsProviderReconciliationInput,
} from "./sms-provider-acceptance.service";
import {
    classifySmsProviderOutcome,
    countSmsRecipients,
} from "./sms-provider-outcome.service";

const INVALID_RETRY_SCHEDULE_REASON =
    "예약 발송 일시 형식이 올바르지 않아 재시도하지 않았습니다. 예약일과 예약시간을 확인해 주세요.";
const PARTIAL_RETRY_SUPERSEDED_REASON =
    "부분 발송 결과의 실패 수신자를 식별할 수 없어 자동 재전송을 중단했습니다. 수신자별로 확인 후 수동 발송해 주세요.";
const UNCERTAIN_RETRY_SUPERSEDED_REASON =
    "문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.";

interface RetrySchedule {
    scheduledDate?: string;
    scheduledTime?: string;
    scheduledAtMs: number | null;
}

type SmsRetryInvocation = "automatic" | "manual";

@Injectable()
export class SmsRetryService {
    private readonly logger = new Logger(SmsRetryService.name);

    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        @Optional()
        private readonly acceptanceService?: SmsProviderAcceptanceService,
    ) {}

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

        const retryLog = await this.retry(sourceLog, "manual");
        if (!retryLog) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        return retryLog;
    }

    async retry(
        sourceLog: MessageLogEntity,
        invocation: SmsRetryInvocation = "manual",
    ): Promise<MessageLogEntity | null> {
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

        const retryLog = await this.logRepository.startRetryAttempt(
            sourceLog,
            this.createRetryAttempt(sourceLog),
        );
        if (!retryLog) {
            this.logger.warn(`[Retry] SMS log ${sourceLog.id} was already claimed`);
            return null;
        }

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

        const providerAttempt = this.acceptanceService
            ? await this.acceptanceService.beginProviderCall(retryLog)
            : this.beginProviderCallWithoutBoundary(retryLog);

        try {
            const isScheduledInFuture = schedule.scheduledAtMs !== null && schedule.scheduledAtMs > Date.now();

            const scheduledDate = isScheduledInFuture ? schedule.scheduledDate : undefined;
            const scheduledTime = isScheduledInFuture ? schedule.scheduledTime : undefined;

            const result = await this.aligoService.sendSms({
                senderPhone: this.stringVariable(retryLog, "senderPhone"),
                receiver: providerAttempt.receiver,
                message: providerAttempt.messageBody,
                recipientName: providerAttempt.recipientName ?? this.stringVariable(providerAttempt, "recipientName") ?? undefined,
                title: this.stringVariable(providerAttempt, "title") ?? undefined,
                msgType: this.smsMessageTypeVariable(providerAttempt, "msgType"),
                ...(scheduledDate ? { scheduledDate } : {}),
                ...(scheduledTime ? { scheduledTime } : {}),
                ...(this.booleanVariable(retryLog, "testMode") ? { testMode: true } : {}),
            });

            const providerOutcome = classifySmsProviderOutcome(
                result,
                countSmsRecipients(providerAttempt.receiver),
            );
            if (providerOutcome === "rejected") {
                this.markSmsRetryRejected(
                    providerAttempt,
                    this.providerResponseMessage(result),
                    invocation,
                );
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
                this.markSmsRetryUncertain(
                    providerAttempt,
                    "문자 발송 결과를 확인할 수 없어 자동 재전송을 중단했습니다.",
                );
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

            providerAttempt.variables = {
                ...providerAttempt.variables,
                retrySafety: "accepted",
            };
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
            await this.logRepository.update(providerAttempt);
            this.logger.log(`[Retry] Successfully resent SMS ${providerAttempt.templateKey} to ${maskPhone(providerAttempt.receiver)}`);
            return providerAttempt;
        } catch (error) {
            this.markSmsRetryUncertain(
                providerAttempt,
                error instanceof Error ? error.message : String(error),
            );
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

    private createRetryAttempt(sourceLog: MessageLogEntity): MessageLogEntity {
        const now = new Date(Date.now());
        const recoveryAt = new Date(now.getTime() + SMS_DELIVERY_RETRY_DELAY_MS);
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
                ...sourceLog.variables,
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
        invocation: SmsRetryInvocation,
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
        log.nextRetryAt = log.canRetry()
            ? new Date(Date.now() + SMS_DELIVERY_RETRY_DELAY_MS)
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
