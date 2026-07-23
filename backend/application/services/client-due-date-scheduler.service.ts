import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageTriggerService } from "./message-trigger.service";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import { ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";

const KOREA_TIME_ZONE = "Asia/Seoul";
const START_DATE_COPY_LEAD_DAYS = 7;
const MAX_RUN_MS = 5 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

const KST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

@Injectable()
export class ClientDueDateSchedulerService {
    private readonly logger = new Logger(ClientDueDateSchedulerService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[Client Due Date] Previous due-date sync is still running; skipping tick",
        staleRunError: "[Client Due Date] Previous due-date sync exceeded the max runtime",
        cooldownWarning: "[Client Due Date] Database connectivity issue detected during due-date sync",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        private readonly prisma: PrismaService,
        @Optional() private readonly triggerService?: MessageTriggerService,
        @Optional() private readonly serviceRecordLifecycleService?: ServiceRecordLifecycleService,
    ) {}

    @Cron("0 * * * *", { timeZone: KOREA_TIME_ZONE })
    async syncUpcomingDueDatesToStartDates(): Promise<void> {
        const runToken = this.executionGuard.tryStart();
        if (!runToken) {
            return;
        }

        try {
            const count = await this.copyUpcomingDueDatesToStartDates();
            if (count > 0) {
                this.logger.log(`[Client Due Date] Copied dueDate to startDate for ${count} clients`);
            }
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                this.executionGuard.enterCooldown(summarizePrismaError(error));
                return;
            }

            this.logger.error(
                "[Client Due Date] Failed to copy dueDate to startDate",
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.executionGuard.finish(runToken);
        }
    }

    async copyUpcomingDueDatesToStartDates(referenceDate = new Date()): Promise<number> {
        const kstToday = this.getKstDateOnly(referenceDate, 0);
        const upcomingDueDate = this.getKstDateOnly(referenceDate, START_DATE_COPY_LEAD_DAYS);
        const candidates = await this.prisma.client.findMany({
            where: {
                dueDate: {
                    gte: kstToday,
                    lte: upcomingDueDate,
                },
                startDate: null,
            },
            select: { id: true, branchId: true, dueDate: true },
        });

        let updatedCount = 0;
        for (const client of candidates) {
            const result = this.serviceRecordLifecycleService
                ? await this.prisma.$transaction(async (tx) => {
                    const updated = await tx.client.updateMany({
                        where: {
                            id: client.id,
                            dueDate: client.dueDate,
                            startDate: null,
                        },
                        data: { startDate: client.dueDate },
                    });
                    if (updated.count > 0) {
                        await this.serviceRecordLifecycleService!.ensureForClient(client.id, tx);
                    }
                    return updated;
                })
                : await this.prisma.client.updateMany({
                    where: {
                        id: client.id,
                        dueDate: client.dueDate,
                        startDate: null,
                    },
                    data: { startDate: client.dueDate },
                });

            if (result.count === 0) {
                continue;
            }

            updatedCount += result.count;
            if (client.branchId) {
                await this.syncTriggerRules(client.branchId, client.id);
            }
        }

        return updatedCount;
    }

    private async syncTriggerRules(branchId: string, clientId: number): Promise<void> {
        if (!this.triggerService) {
            return;
        }

        try {
            await this.triggerService.syncClientRulesForClient(branchId, clientId, false);
        } catch (error) {
            this.logger.error(
                `[Client Due Date] Failed to sync trigger rules for client ${clientId}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    private getKstDateOnly(referenceDate: Date, offsetDays: number): Date {
        const parts = new Map(
            KST_DATE_FORMATTER.formatToParts(referenceDate).map((part) => [part.type, part.value]),
        );
        const year = Number(parts.get("year"));
        const month = Number(parts.get("month"));
        const day = Number(parts.get("day"));
        const date = new Date(Date.UTC(year, month - 1, day));
        date.setUTCDate(date.getUTCDate() + offsetDays);
        return date;
    }
}
