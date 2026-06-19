import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ALIMTALK_LOG_REPOSITORY, IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";
import { ALIGO_API_PORT, IAligoApiPort } from "domain/ports/aligo-api.port";
import { ALIGO_TEMPLATES } from "application/dto/aligo";
import { AligoTemplateKey } from "application/dto/aligo/alimtalk-template.dto";
import { AligoService } from "application/services/aligo.service";
import { maskPhone } from "application/utils/mask";
import { AlimtalkLogEntity, SMS_DELIVERY_RETRY_DELAY_MS } from "domain/entities/alimtalk-log.entity";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";

const MAX_RUN_MS = 15 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;
@Injectable()
export class AlimtalkRetrySchedulerService {
    private readonly logger = new Logger(AlimtalkRetrySchedulerService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[Retry] Previous retry cycle is still running; skipping tick",
        staleRunError: "[Retry] Previous retry cycle exceeded the max runtime",
        cooldownWarning: "[Retry] Database connectivity issue detected during retry cycle",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        @Inject(ALIMTALK_LOG_REPOSITORY)
        private readonly logRepository: IAlimtalkLogRepository,
        @Inject(ALIGO_API_PORT)
        private readonly aligoApi: IAligoApiPort,
        private readonly aligoService: AligoService,
    ) {}

    @Cron("*/5 * * * *", { timeZone: "Asia/Seoul" })
    async retryFailedMessages(): Promise<void> {
        const runToken = this.executionGuard.tryStart();
        if (!runToken) {
            return;
        }

        try {
            const pendingLogs = await this.logRepository.findPendingRetries();

            if (pendingLogs.length === 0) return;

            this.logger.log(`[Retry] Found ${pendingLogs.length} messages to retry`);

            for (const log of pendingLogs) {
                try {
                    if (log.provider === "aligo_sms") {
                        await this.retrySmsLog(log);
                        continue;
                    }

                    const templateKey = log.templateKey as AligoTemplateKey;
                    const template = ALIGO_TEMPLATES[templateKey];
                    if (!template) {
                        log.markFailed(`Unknown template: ${log.templateKey}`);
                        await this.logRepository.update(log);
                        continue;
                    }

                    const response = await this.aligoApi.sendAlimtalk({
                        tplCode: template.code,
                        receiver: log.receiver,
                        subject: `알림톡 - ${log.templateKey}`,
                        message: log.messageBody,
                    });

                    log.markSent(response.info?.mid?.toString());
                    await this.logRepository.update(log);
                    this.logger.log(`[Retry] Successfully resent ${log.templateKey} to ${maskPhone(log.receiver)}`);
                } catch (error) {
                    log.markFailed(error instanceof Error ? error.message : String(error));
                    await this.logRepository.update(log);
                    this.logger.warn(`[Retry] Failed attempt ${log.attempts} for log ${log.id}: ${error}`);
                }
            }
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                this.executionGuard.enterCooldown(summarizePrismaError(error));
                return;
            }

            this.logger.error(
                "[Retry] Failed to load or retry pending alimtalk messages",
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.executionGuard.finish(runToken);
        }
    }

    private async retrySmsLog(log: AlimtalkLogEntity): Promise<void> {
        try {
            const scheduledDate = this.stringVariable(log, "scheduledDate");
            const scheduledTime = this.stringVariable(log, "scheduledTime");
            const result = await this.aligoService.sendSms({
                senderPhone: this.stringVariable(log, "senderPhone"),
                receiver: log.receiver,
                message: log.messageBody,
                recipientName: this.stringVariable(log, "recipientName") ?? undefined,
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

            log.markSent(result.response.msg_id ? String(result.response.msg_id) : undefined);
            await this.logRepository.update(log);
            this.logger.log(`[Retry] Successfully resent SMS ${log.templateKey} to ${maskPhone(log.receiver)}`);
        } catch (error) {
            this.markSmsRetryFailed(log, error instanceof Error ? error.message : String(error));
            await this.logRepository.update(log);
            this.logger.warn(`[Retry] Failed SMS attempt ${log.attempts} for log ${log.id}: ${error}`);
        }
    }

    private markSmsRetryFailed(log: AlimtalkLogEntity, errorMessage: string): void {
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

    private stringVariable(log: AlimtalkLogEntity, key: string): string | undefined {
        const value = log.variables[key];
        return typeof value === "string" && value.trim() ? value : undefined;
    }

    private smsMessageTypeVariable(
        log: AlimtalkLogEntity,
        key: string,
    ): "SMS" | "LMS" | "AUTO" | undefined {
        const value = this.stringVariable(log, key);
        return value === "SMS" || value === "LMS" || value === "AUTO" ? value : undefined;
    }

    private booleanVariable(log: AlimtalkLogEntity, key: string): boolean {
        return this.stringVariable(log, key) === "true";
    }
}
