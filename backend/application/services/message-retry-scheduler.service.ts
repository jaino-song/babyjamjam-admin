import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { SmsRetryService } from "./sms-retry.service";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";

const MAX_RUN_MS = 15 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;
const UNCERTAIN_RETRY_SUPERSEDED_REASON =
    "문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.";
const PARTIAL_RETRY_SUPERSEDED_REASON =
    "부분 발송 결과의 실패 수신자를 식별할 수 없어 자동 재전송을 중단했습니다. 수신자별로 확인 후 수동 발송해 주세요.";
const MANUAL_REJECTION_RETRY_SUPERSEDED_REASON =
    "사용자가 요청한 재발송이 제공자에서 거부되어 자동 재전송을 중단했습니다. 필요하면 명시적으로 다시 요청해 주세요.";
const UNBOUND_RETRY_SUPERSEDED_REASON =
    "발송 작업 소유자를 확인할 수 없어 자동 재전송을 중단했습니다. 필요하면 명시적으로 다시 요청해 주세요.";

@Injectable()
export class MessageRetrySchedulerService {
    private readonly logger = new Logger(MessageRetrySchedulerService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[Retry] Previous retry cycle is still running; skipping tick",
        staleRunError: "[Retry] Previous retry cycle exceeded the max runtime",
        cooldownWarning: "[Retry] Database connectivity issue detected during retry cycle",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        private readonly smsRetryService: SmsRetryService,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Cron("*/5 * * * *", { timeZone: "Asia/Seoul" })
    async retryFailedMessages(): Promise<void> {
        if (!this.schedulerLease.holdsLease()) {
            return;
        }

        const runToken = this.executionGuard.tryStart();
        if (!runToken) {
            return;
        }

        try {
            const pendingLogs = await this.logRepository.findPendingRetriesSystemScope();
            if (pendingLogs.length === 0) return;

            this.logger.log(`[Retry] Found ${pendingLogs.length} messages to retry`);

            let processedCount = 0;
            for (const log of pendingLogs) {
                if (!this.schedulerLease.holdsLease()) {
                    this.logger.warn(
                        `[Retry] scheduler lease lost mid-run; stopping after ${processedCount} items`,
                    );
                    break;
                }
                processedCount += 1;
                try {
                    if (log.isPartialProviderOutcome()) {
                        log.markRetrySuperseded(PARTIAL_RETRY_SUPERSEDED_REASON);
                        await this.logRepository.update(log);
                        this.logger.warn(
                            `[Retry] Skipped partial SMS log ${log.id}; recipient-level verification required`,
                        );
                        continue;
                    }

                    if (log.isManualProviderRejection()) {
                        log.markRetrySuperseded(MANUAL_REJECTION_RETRY_SUPERSEDED_REASON);
                        await this.logRepository.update(log);
                        this.logger.warn(
                            `[Retry] Skipped manually rejected SMS log ${log.id}; explicit retry required`,
                        );
                        continue;
                    }

                    if (log.variables["retrySafety"] === "uncertain"
                        || log.providerAcceptanceState === "started"
                        || log.providerAcceptanceState === "uncertain") {
                        log.markRetrySuperseded(UNCERTAIN_RETRY_SUPERSEDED_REASON);
                        await this.logRepository.update(log);
                        this.logger.warn(
                            `[Retry] Skipped uncertain SMS log ${log.id}; provider history/manual verification required`,
                        );
                        continue;
                    }

                    if (log.provider === "aligo_sms") {
                        if (log.triggerJobId === null) {
                            log.markRetrySuperseded(UNBOUND_RETRY_SUPERSEDED_REASON);
                            await this.logRepository.update(log);
                            this.logger.warn(
                                `[Retry] Skipped unbound SMS log ${log.id}; explicit retry required`,
                            );
                            continue;
                        }
                        await this.smsRetryService.retry(log, "automatic");
                    } else {
                        log.markRetrySuperseded("지원이 종료된 메시지 공급자라 재시도하지 않습니다.");
                        await this.logRepository.update(log);
                    }
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
                "[Retry] Failed to load pending message retries",
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.executionGuard.finish(runToken);
        }
    }
}
