import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { MessageLogEntity, CarrierResultState } from "domain/entities/message-log.entity";
import {
    ALIGO_SMS_API_PORT,
    type AligoSmsDeliveryDetailsResult,
    type IAligoSmsApiPort,
} from "domain/ports/aligo-sms-api.port";
import {
    MESSAGE_LOG_REPOSITORY,
    type IMessageLogRepository,
} from "domain/repositories/message-log.repository.interface";
import {
    isTransientPrismaConnectivityError,
    summarizePrismaError,
} from "infrastructure/database/prisma-error.utils";
import {
    classifyCarrierCheck,
    formatCarrierFailureMessage,
} from "./sms-carrier-check-classifier";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";
import { SchedulerLeaseService } from "./scheduler-lease.service";

const MAX_RUN_MS = 15 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 100;
/** Stop starting new rows well before MAX_RUN_MS so a slow run never trips the overlap guard. */
const RUN_BUDGET_MS = 10 * 60 * 1000;
/** A row that throws unexpectedly is skipped for this long instead of being retried every tick. */
const FAILED_ROW_BACKOFF_MS = 30 * 60 * 1000;
/** Past this age a row that still throws is closed as lookup_error instead of being postponed forever. */
const FAILED_ROW_GIVE_UP_AGE_MS = 24 * 60 * 60 * 1000;

interface CarrierCheckOutcome {
    state: CarrierResultState;
    results: unknown[];
    failureMessage: string | null;
}

/**
 * One-shot carrier delivery check: ~30 minutes after Aligo accepts an SMS, look up the
 * per-recipient carrier result once and record it. The "only once" guarantee comes from
 * saveCarrierCheckResult clearing carrierCheckDueAt.
 */
// Prisma validation errors can echo query arguments (receiver numbers), so
// only the error class and code are logged here.
function describeErrorWithoutDetails(error: unknown): string {
    const name = error instanceof Error ? error.name : typeof error;
    const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : null;
    return code ? `${name} (${code})` : name;
}

@Injectable()
export class SmsCarrierCheckService {
    private readonly logger = new Logger(SmsCarrierCheckService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[CarrierCheck] Previous carrier-check cycle is still running; skipping tick",
        staleRunError: "[CarrierCheck] Previous carrier-check cycle exceeded the max runtime",
        cooldownWarning: "[CarrierCheck] Database connectivity issue detected during carrier-check cycle",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
        @Inject(ALIGO_SMS_API_PORT)
        private readonly aligoSmsApi: IAligoSmsApiPort,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Cron("*/5 * * * *", { timeZone: "Asia/Seoul" })
    async checkDueCarrierResults(): Promise<void> {
        if (!this.schedulerLease.holdsLease()) {
            return;
        }
        if (typeof this.aligoSmsApi.getSmsDeliveryDetails !== "function") {
            return;
        }
        if (this.aligoSmsApi.getDefaultSenderPolicy?.()?.availability === "unavailable") {
            return;
        }

        const runToken = this.executionGuard.tryStart();
        if (!runToken) {
            return;
        }

        try {
            const dueLogs = await this.logRepository.findCarrierChecksDueSystemScope(BATCH_LIMIT);
            if (dueLogs.length === 0) return;

            this.logger.log(`[CarrierCheck] Found ${dueLogs.length} messages due for carrier check`);

            const warnedStates = new Set<string>();
            const startedAt = Date.now();
            let processedCount = 0;
            for (const log of dueLogs) {
                if (Date.now() - startedAt >= RUN_BUDGET_MS) {
                    this.logger.warn(
                        `[CarrierCheck] run time budget exhausted; processed ${processedCount} of ${dueLogs.length} items, the rest wait for the next tick`,
                    );
                    break;
                }
                if (!this.schedulerLease.holdsLease()) {
                    this.logger.warn(
                        `[CarrierCheck] scheduler lease lost mid-run; stopping after ${processedCount} items`,
                    );
                    break;
                }
                processedCount += 1;
                try {
                    await this.checkOne(log, warnedStates);
                } catch (error) {
                    if (isTransientPrismaConnectivityError(error)) {
                        this.executionGuard.enterCooldown(summarizePrismaError(error));
                        return;
                    }
                    this.logger.error(
                        `[CarrierCheck] Failed to process log ${log.id}`,
                        describeErrorWithoutDetails(error),
                    );
                    await this.postponeFailedRow(log);
                }
            }
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                this.executionGuard.enterCooldown(summarizePrismaError(error));
                return;
            }

            this.logger.error(
                "[CarrierCheck] Failed to load due carrier checks",
                describeErrorWithoutDetails(error),
            );
        } finally {
            this.executionGuard.finish(runToken);
        }
    }

    /**
     * Back a throwing row off so one poison row cannot be re-fetched and re-failed every tick.
     * A row that is still throwing a day after the provider accepted it is closed as
     * lookup_error instead, so it cannot be postponed (and re-fetched) forever.
     */
    private async postponeFailedRow(log: MessageLogEntity): Promise<void> {
        if (!log.aligoMid) return;
        if (this.isPastGiveUpAge(log)) {
            try {
                await this.logRepository.saveCarrierCheckResult({
                    id: log.id,
                    expectedMid: log.aligoMid,
                    state: "lookup_error",
                    results: [],
                    checkedAt: new Date(),
                    failureMessage: null,
                });
                return;
            } catch (saveError) {
                this.logger.warn(
                    `[CarrierCheck] Could not close log ${log.id} as lookup_error, postponing instead: ${describeErrorWithoutDetails(saveError)}`,
                );
            }
        }
        try {
            await this.logRepository.postponeCarrierCheck(
                log.id,
                log.aligoMid,
                new Date(Date.now() + FAILED_ROW_BACKOFF_MS),
            );
        } catch (postponeError) {
            this.logger.warn(
                `[CarrierCheck] Could not postpone log ${log.id}: ${describeErrorWithoutDetails(postponeError)}`,
            );
        }
    }

    private isPastGiveUpAge(log: MessageLogEntity): boolean {
        const base = log.providerAcceptedAt ?? log.createdAt;
        const baseMs = base instanceof Date ? base.getTime() : Number.NaN;
        return Number.isFinite(baseMs) && Date.now() - baseMs > FAILED_ROW_GIVE_UP_AGE_MS;
    }

    private async checkOne(log: MessageLogEntity, warnedStates: Set<string>): Promise<void> {
        const mid = log.aligoMid;
        if (!mid) {
            // The due query only returns rows with a mid; there is nothing to condition a save on.
            this.logger.warn(`[CarrierCheck] Log ${log.id} has no provider message id; skipping`);
            return;
        }
        const expectedReceivers = log.receiver
            .split(",")
            .map((receiver) => receiver.trim())
            .filter((receiver) => receiver.length > 0);

        const outcome: CarrierCheckOutcome = expectedReceivers.length === 0
            ? { state: "unconfirmed", results: [], failureMessage: null }
            : await this.lookup(log, mid, expectedReceivers, warnedStates);

        const saved = await this.logRepository.saveCarrierCheckResult({
            id: log.id,
            expectedMid: mid,
            state: outcome.state,
            results: outcome.results,
            checkedAt: new Date(),
            failureMessage: outcome.failureMessage,
        });
        if (saved === "stale") {
            this.logger.debug(`[CarrierCheck] Log ${log.id} changed before the result was saved; skipping`);
        }
    }

    private async lookup(
        log: MessageLogEntity,
        mid: string,
        expectedReceivers: string[],
        warnedStates: Set<string>,
    ): Promise<CarrierCheckOutcome> {
        const lookupError: CarrierCheckOutcome = { state: "lookup_error", results: [], failureMessage: null };

        let details: AligoSmsDeliveryDetailsResult;
        try {
            details = await this.aligoSmsApi.getSmsDeliveryDetails!(mid);
        } catch {
            this.logger.warn(`[CarrierCheck] Carrier lookup failed for log ${log.id} (mid ${mid})`);
            return lookupError;
        }
        if (details.resultCode !== 1) {
            this.logger.warn(
                `[CarrierCheck] Carrier lookup returned result code ${details.resultCode} for log ${log.id} (mid ${mid})`,
            );
            return lookupError;
        }

        const classification = classifyCarrierCheck(expectedReceivers, details.rows);
        for (const state of classification.unrecognizedStates) {
            if (warnedStates.has(state)) continue;
            warnedStates.add(state);
            this.logger.warn(`[CarrierCheck] Unrecognized carrier state: ${state}`);
        }

        return {
            state: classification.outcome,
            results: classification.recipients.map((recipient) => ({
                receiver: recipient.receiver,
                smsState: recipient.smsState,
                sendDate: recipient.sendDate,
                verdict: recipient.verdict,
            })),
            failureMessage:
                classification.outcome === "failed"
                    ? formatCarrierFailureMessage(classification.failures)
                    : null,
        };
    }
}
