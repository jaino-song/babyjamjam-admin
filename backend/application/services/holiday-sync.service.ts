import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    HOLIDAY_SYNC_REPOSITORY,
    IHolidaySyncRepository,
    HolidaySyncItem,
} from "domain/repositories/holiday-sync.repository.interface";
import { isoDateInKorea } from "domain/utils/business-days";
import { KasiHolidayClient, KasiHolidayError } from "infrastructure/api/kasi-holiday.client";

export type HolidaySyncTrigger = "cron" | "manual";

export interface HolidaySyncYearResult {
    year: number;
    status: "updated" | "unchanged" | "failed";
    added: number;
    removed: number;
    /** Short failure code (never upstream text): not_configured, not_published, anchors_missing, ... */
    error?: string;
}

/** Fixed-date public holidays every KASI year must contain; a miss means a partial/bad response. */
const ANCHOR_MONTH_DAYS = ["01-01", "03-01", "05-05", "06-06", "08-15", "10-03", "10-09", "12-25"] as const;
const MANUAL_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const HOLIDAY_NAME_MAX_LENGTH = 100;

@Injectable()
export class HolidaySyncService {
    private readonly logger = new Logger(HolidaySyncService.name);
    /** Per-process by design (accepted): starts when a sync attempt starts, not when a request is rejected. */
    private lastManualSyncStartedAt: number | null = null;

    constructor(
        private readonly kasiClient: KasiHolidayClient,
        @Inject(HOLIDAY_SYNC_REPOSITORY)
        private readonly repository: IHolidaySyncRepository,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Cron("0 4 * * *", { timeZone: "Asia/Seoul" })
    async syncScheduled(): Promise<void> {
        if (!this.schedulerLease.holdsLease()) {
            return;
        }
        try {
            await this.syncYears(this.currentAndNextYear(), "cron");
        } catch (error) {
            // syncYears never throws per year; this only guards the unexpected.
            this.logger.error(`[Holiday Sync] scheduled run crashed: ${this.describeError(error)}`);
        }
    }

    /** Manual trigger: current + next KST year, rate-limited to one attempt per 5 minutes per process. */
    async syncManually(): Promise<HolidaySyncYearResult[]> {
        const now = Date.now();
        if (this.lastManualSyncStartedAt !== null && now - this.lastManualSyncStartedAt < MANUAL_SYNC_COOLDOWN_MS) {
            throw new HttpException(codeOnlyProblemBody("REQUEST_RATE_LIMITED"), 429);
        }
        this.lastManualSyncStartedAt = now;
        return this.syncYears(this.currentAndNextYear(), "manual");
    }

    async syncYears(years: number[], trigger: HolidaySyncTrigger): Promise<HolidaySyncYearResult[]> {
        const results: HolidaySyncYearResult[] = [];
        for (const year of years) {
            results.push(await this.syncYear(year, trigger));
        }
        return results;
    }

    private async syncYear(year: number, trigger: HolidaySyncTrigger): Promise<HolidaySyncYearResult> {
        try {
            // Fetch and validate outside any transaction.
            const fetched = await this.kasiClient.fetchYear(year);
            if (fetched.rawCount === 0) {
                // Normal for next year early on: KASI has not published it yet.
                this.logger.log(`[Holiday Sync] ${year}: not published yet (${trigger})`);
                return this.failed(year, "not_published");
            }

            const merged = this.mergeSameDate(fetched.items);
            const missing = ANCHOR_MONTH_DAYS.filter((md) => !merged.some((item) => item.date === `${year}-${md}`));
            if (missing.length > 0) {
                this.logger.warn(
                    `[Holiday Sync] ${year}: anchors missing (${missing.join(",")}); keeping previous data (${trigger})`,
                );
                return this.failed(year, "anchors_missing");
            }

            const written = await this.repository.applyYearSync({
                year,
                items: merged,
                rawCount: fetched.rawCount,
            });
            this.logger.log(
                `[Holiday Sync] ${year}: ${written.status} (+${written.added}/-${written.removed}) (${trigger})`,
            );
            return { year, status: written.status, added: written.added, removed: written.removed };
        } catch (error) {
            if (error instanceof KasiHolidayError) {
                const level = error.reason === "not_configured" ? "log" : "warn";
                this.logger[level](`[Holiday Sync] ${year}: ${error.message} (${trigger})`);
                return this.failed(year, error.reason);
            }
            this.logger.error(`[Holiday Sync] ${year}: write failed: ${this.describeError(error)} (${trigger})`);
            return this.failed(year, "write_failed");
        }
    }

    /** KASI returns one item per holiday name, so a date can repeat (e.g. 개천절 inside 추석). */
    private mergeSameDate(items: HolidaySyncItem[]): HolidaySyncItem[] {
        const byDate = new Map<string, string[]>();
        for (const item of items) {
            const names = byDate.get(item.date) ?? [];
            if (!names.includes(item.name)) names.push(item.name);
            byDate.set(item.date, names);
        }
        return [...byDate.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([date, names]) => ({ date, name: names.join("·").slice(0, HOLIDAY_NAME_MAX_LENGTH) }));
    }

    private currentAndNextYear(): number[] {
        const year = Number(isoDateInKorea(new Date()).slice(0, 4));
        return [year, year + 1];
    }

    private failed(year: number, error: string): HolidaySyncYearResult {
        return { year, status: "failed", added: 0, removed: 0, error };
    }

    private describeError(error: unknown): string {
        return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    }
}
