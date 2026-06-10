import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CallProcessingService } from "application/services/call-processing.service";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";

const MAX_ATTEMPTS = 3;
const STUCK_RECEIVED_MS = 10 * 60 * 1000;
const MAX_RUN_MS = 10 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

@Injectable()
export class CallExtractionRetrySchedulerService {
    private readonly logger = new Logger(CallExtractionRetrySchedulerService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[CallRetry] Previous cycle still running; skipping tick",
        staleRunError: "[CallRetry] Previous cycle exceeded max runtime",
        cooldownWarning: "[CallRetry] DB connectivity issue during retry cycle",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        private readonly prismaService: PrismaService,
        private readonly processingService: CallProcessingService,
    ) {}

    @Cron("*/10 * * * *", { timeZone: "Asia/Seoul" })
    async retryFailedExtractions(): Promise<void> {
        const runToken = this.executionGuard.tryStart();
        if (!runToken) return;

        try {
            const candidates = await this.prismaService.call_record.findMany({
                where: {
                    OR: [
                        { processingStatus: "FAILED", extractionRetryCount: { lt: MAX_ATTEMPTS } },
                        // crash recovery: RECEIVED rows whose fire-and-forget kickoff died
                        {
                            processingStatus: "RECEIVED",
                            createdAt: { lt: new Date(Date.now() - STUCK_RECEIVED_MS) },
                        },
                    ],
                },
                select: { id: true, extractionRetryCount: true, processingStatus: true },
                orderBy: { createdAt: "asc" },
                take: 20,
            });

            if (candidates.length === 0) return;

            this.logger.log(`[CallRetry] Retrying ${candidates.length} call records`);

            for (const candidate of candidates) {
                // Only FAILED rows need their counter incremented and status reset;
                // stuck RECEIVED rows are already in the correct status — incrementing
                // their attempt count would burn retries they never actually consumed.
                if (candidate.processingStatus === "FAILED") {
                    await this.prismaService.call_record.update({
                        where: { id: candidate.id },
                        data: { extractionRetryCount: { increment: 1 }, processingStatus: "RECEIVED" },
                    });
                }
                await this.processingService.processCallRecord(candidate.id);
            }
        } finally {
            this.executionGuard.finish(runToken);
        }
    }
}
