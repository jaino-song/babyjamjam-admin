import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
    MESSAGE_LOG_REPOSITORY,
    IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import { AlimtalkRetryService } from "./alimtalk-retry.service";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import { SmsRetryService } from "./sms-retry.service";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";

const MAX_RUN_MS = 15 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

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
        private readonly alimtalkRetryService: AlimtalkRetryService,
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
                        await this.smsRetryService.retry(log);
                    } else if (log.provider === "aligo_alimtalk") {
                        await this.alimtalkRetryService.retry(log);
                    } else {
                        this.logger.warn(
                            `[Retry] Unsupported message provider ${log.provider} for log ${log.id}; skipping retry`,
                        );
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
