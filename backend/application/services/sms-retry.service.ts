import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { maskPhone } from "application/utils/mask";
import { MessageLogEntity, SMS_DELIVERY_RETRY_DELAY_MS } from "domain/entities/message-log.entity";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";

@Injectable()
export class SmsRetryService {
    private readonly logger = new Logger(SmsRetryService.name);

    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
    ) {}

    async retryById(branchId: string, logId: number): Promise<MessageLogEntity> {
        const log = await this.logRepository.findByIdInBranch(branchId, logId);
        if (!log || log.provider !== "aligo_sms") {
            throw new NotFoundException("재발송할 메시지 기록을 찾을 수 없습니다.");
        }

        if (log.status !== "failed") {
            throw new ConflictException("실패한 메시지만 재발송할 수 있습니다.");
        }

        const scheduledLog = await this.logRepository.scheduleFailedForRetry(branchId, logId);
        if (!scheduledLog) {
            throw new ConflictException("이미 재발송이 진행 중입니다.");
        }

        return scheduledLog;
    }

    async retry(log: MessageLogEntity): Promise<void> {
        if (log.branchId) {
            try {
                await this.messageSenderApprovalService.ensureApproved(log.branchId);
            } catch (approvalError) {
                const reason = approvalError instanceof Error ? approvalError.message : String(approvalError);
                this.logger.warn(`[Retry] SMS blocked by approval gate for log ${log.id} (branchId=${log.branchId}): ${reason}`);
                log.status = "failed";
                log.errorMessage = reason;
                log.attempts += 1;
                log.lastAttemptAt = new Date(Date.now());
                log.nextRetryAt = null;
                await this.logRepository.update(log);
                return;
            }
        }

        try {
            const rawScheduledDate = this.stringVariable(log, "scheduledDate");
            const rawScheduledTime = this.stringVariable(log, "scheduledTime");
            const scheduleInstantMs = rawScheduledDate && rawScheduledTime
                ? this.parseKstScheduleMs(rawScheduledDate, rawScheduledTime)
                : null;
            const isScheduledInFuture = scheduleInstantMs !== null && scheduleInstantMs > Date.now();

            const scheduledDate = isScheduledInFuture ? rawScheduledDate : undefined;
            const scheduledTime = isScheduledInFuture ? rawScheduledTime : undefined;

            const result = await this.aligoService.sendSms({
                senderPhone: this.stringVariable(log, "senderPhone"),
                receiver: log.receiver,
                message: log.messageBody,
                recipientName: log.recipientName ?? this.stringVariable(log, "recipientName") ?? undefined,
                title: this.stringVariable(log, "title") ?? undefined,
                msgType: this.smsMessageTypeVariable(log, "msgType"),
                ...(scheduledDate ? { scheduledDate } : {}),
                ...(scheduledTime ? { scheduledTime } : {}),
                ...(this.booleanVariable(log, "testMode") ? { testMode: true } : {}),
            });

            if (!this.isAcceptedSmsResult(result)) {
                this.markSmsRetryFailed(log, result.response.message || "문자 발송 요청이 실패했습니다.");
                await this.logRepository.update(log);
                this.logger.warn(`[Retry] SMS retry rejected for log ${log.id}: ${result.response.message}`);
                return;
            }

            if (isScheduledInFuture) {
                log.status = "pending";
                log.aligoMid = result.response.msg_id ? String(result.response.msg_id) : null;
                log.lastAttemptAt = new Date(Date.now());
                log.nextRetryAt = null;
                log.attempts += 1;
            } else {
                log.markSent(result.response.msg_id ? String(result.response.msg_id) : undefined);
            }
            await this.logRepository.update(log);
            this.logger.log(`[Retry] Successfully resent SMS ${log.templateKey} to ${maskPhone(log.receiver)}`);
        } catch (error) {
            this.markSmsRetryFailed(log, error instanceof Error ? error.message : String(error));
            await this.logRepository.update(log);
            this.logger.warn(`[Retry] Failed SMS attempt ${log.attempts} for log ${log.id}: ${error}`);
        }
    }

    private parseKstScheduleMs(date: string, time: string): number | null {
        const isoDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
        const isoTime = `${time.slice(0, 2)}:${time.slice(2, 4)}`;
        const ms = new Date(`${isoDate}T${isoTime}:00+09:00`).getTime();
        return Number.isNaN(ms) ? null : ms;
    }

    private markSmsRetryFailed(log: MessageLogEntity, errorMessage: string): void {
        log.status = "failed";
        log.errorMessage = errorMessage;
        log.attempts += 1;
        log.lastAttemptAt = new Date(Date.now());
        log.nextRetryAt = log.canRetry()
            ? new Date(Date.now() + SMS_DELIVERY_RETRY_DELAY_MS)
            : null;
    }

    private isAcceptedSmsResult(result: Awaited<ReturnType<AligoService["sendSms"]>>): boolean {
        const resultCode = Number(result.response.result_code);
        const errorCount = Number(result.response.error_cnt ?? 0);
        return resultCode === 1 && errorCount === 0;
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
