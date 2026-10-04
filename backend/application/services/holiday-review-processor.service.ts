import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { classifyReviewItem } from "application/services/holiday-review-classification";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import { BRANCH_REPOSITORY, IBranchRepository } from "domain/repositories/branch.repository.interface";
import {
    HOLIDAY_REVIEW_REPOSITORY,
    HolidayChangeEventRecord,
    IHolidayReviewRepository,
    ReviewItemDraft,
} from "domain/repositories/holiday-review.repository.interface";
import { KrBusinessDayCalendar, UnsupportedKoreanHolidayYearError } from "domain/utils/business-days";

/** A save in flight computed with the pre-change calendar must land before the event is processed. */
export const HOLIDAY_REVIEW_GRACE_MS = 2 * 60 * 1000;
/** Bounds one run; anything left is picked up by the next one. */
const MAX_EVENTS_PER_RUN = 200;

export interface HolidayReviewRunSummary {
    processed: number;
    /** True when the run stopped early because of a failure or a concurrent change (hitting the per-run cap is not a stop). */
    stopped: boolean;
}

function isWeekend(iso: string): boolean {
    const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
    return day === 0 || day === 6;
}

/** True when the weekday is a holiday in the calendar, false when it is a business day, null when unknown. */
function weekdayHolidayStatus(calendar: KrBusinessDayCalendar, iso: string): boolean | null {
    if (isWeekend(iso)) return null;
    try {
        return !calendar.isBusinessDay(iso);
    } catch (error) {
        if (error instanceof UnsupportedKoreanHolidayYearError) return null;
        throw error;
    }
}

/**
 * Turns holiday changes into review items. Every 5 minutes (lease-guarded) it
 * takes the unprocessed `holiday_change_event` rows older than the grace window,
 * oldest first, and for each finds the clients whose saved end date no longer
 * matches the branch calendar. It never writes `client.end_date`.
 */
@Injectable()
export class HolidayReviewProcessorService {
    private readonly logger = new Logger(HolidayReviewProcessorService.name);

    constructor(
        @Inject(HOLIDAY_REVIEW_REPOSITORY) private readonly repository: IHolidayReviewRepository,
        private readonly calendarService: HolidayCalendarService,
        @Inject(BRANCH_REPOSITORY) private readonly branchRepository: IBranchRepository,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Cron("*/5 * * * *", { timeZone: "Asia/Seoul" })
    async processScheduled(): Promise<void> {
        if (!this.schedulerLease.holdsLease()) {
            return;
        }
        try {
            await this.processDueEvents();
        } catch (error) {
            this.logger.error(`[Holiday Review] scheduled run crashed: ${this.describeError(error)}`);
        }
    }

    /**
     * Processes due events in `(created_at, id)` order. Events must apply in order, so
     * the first failure stops the run: that event's transaction is rolled back, it stays
     * unprocessed and is retried by the next run.
     */
    async processDueEvents(now: Date = new Date()): Promise<HolidayReviewRunSummary> {
        const cutoff = now.getTime() - HOLIDAY_REVIEW_GRACE_MS;
        let processed = 0;
        // The WHOLE queue, once per run (no cap): `later` below is every unprocessed event after
        // the current one, which is what the previous-calendar undo and the repository's
        // `events_changed` guard both need. Only the number processed per run is bounded, so a
        // backlog drains over several runs instead of stalling the guard. An event that appears
        // mid-run trips the guard and ends the run; the next run lists it.
        const queue = await this.repository.listUnprocessedEvents().catch((error: unknown) => {
            this.logger.error(`[Holiday Review] could not list events: ${this.describeError(error)}`);
            return null;
        });
        if (queue === null) return { processed, stopped: true };
        for (let i = 0; i < queue.length && i < MAX_EVENTS_PER_RUN; i += 1) {
            const event = queue[i] as HolidayChangeEventRecord;
            if (event.createdAt.getTime() >= cutoff) {
                return { processed, stopped: false };
            }
            try {
                const outcome = await this.processEvent(event, queue.slice(i + 1));
                if (outcome === "events_changed" || outcome === "items_changed") {
                    this.logger.warn(
                        `[Holiday Review] event ${event.id}: ${
                            outcome === "events_changed" ? "new events appeared" : "an open item changed"
                        } while processing; retrying next run`,
                    );
                    return { processed, stopped: true };
                }
                if (outcome === "applied") processed += 1;
            } catch (error) {
                this.logger.error(
                    `[Holiday Review] event ${event.id} (${event.change} ${event.date}) failed, `
                    + `stopping the batch: ${this.describeError(error)}`,
                );
                return { processed, stopped: true };
            }
        }
        // Per-run cap reached with events left: not a failure, the next run continues.
        return { processed, stopped: false };
    }

    private async processEvent(
        event: HolidayChangeEventRecord,
        later: HolidayChangeEventRecord[],
    ): Promise<"applied" | "already_processed" | "events_changed" | "items_changed"> {
        const branchIds = event.branchId !== null
            ? [event.branchId]
            : (await this.branchRepository.findAll()).map((branch) => branch.id);

        // Calendars and candidates are loaded before the write transaction opens.
        const drafts: ReviewItemDraft[] = [];
        const assumedOpenItemIds: Record<number, string> = {};
        for (const branchId of branchIds) {
            const branchDrafts = await this.draftsForBranch(branchId, event, later);
            drafts.push(...branchDrafts.drafts);
            Object.assign(assumedOpenItemIds, branchDrafts.assumedOpenItemIds);
        }

        const result = await this.repository.applyEventResult({
            eventId: event.id,
            drafts,
            assumedOpenItemIds,
            expectedUnprocessedEventIds: [event.id, ...later.map((e) => e.id)],
        });
        if (result.status === "applied") {
            this.logger.log(
                `[Holiday Review] event ${event.id} (${event.change} ${event.date}): `
                + `${result.created} item(s) created, ${result.obsoleted} obsoleted`,
            );
        }
        return result.status;
    }

    private async draftsForBranch(
        branchId: string,
        event: HolidayChangeEventRecord,
        later: HolidayChangeEventRecord[],
    ): Promise<{ drafts: ReviewItemDraft[]; assumedOpenItemIds: Record<number, string> }> {
        const overrides = await this.repository.listBranchOverrides(branchId);
        const overrideDates = new Set(overrides.map((override) => override.date));
        const current = await this.calendarService.forBranch(branchId, { fresh: true });

        /**
         * A public event is a no-op for a branch that overrides its date either way. A
         * branch event is a no-op once the date's status no longer matches its direction.
         * Events of other branches never apply.
         */
        const applies = (candidate: HolidayChangeEventRecord): boolean => {
            if (candidate.branchId === null) return !overrideDates.has(candidate.date);
            if (candidate.branchId !== branchId) return false;
            const holiday = weekdayHolidayStatus(current, candidate.date);
            return candidate.change === "added" ? holiday === true : holiday === false;
        };

        if (!applies(event)) {
            this.logger.debug(
                `[Holiday Review] event ${event.id} is a no-op for branch ${branchId}; skipping the branch`,
            );
            return { drafts: [], assumedOpenItemIds: {} };
        }

        // The calendar the stored end dates were most likely saved with: undo this event and
        // every later unprocessed one that applies to the branch, newest first, so for a date
        // touched twice the oldest undo wins.
        const undone = new Map<string, boolean>();
        for (const undoing of [event, ...later.filter(applies)].reverse()) {
            undone.set(undoing.date, undoing.change === "removed");
        }
        const add: string[] = [];
        const remove: string[] = [];
        for (const [date, isHoliday] of undone) (isHoliday ? add : remove).push(date);
        const previous = await this.calendarService.forBranchWithAdjustedDates(
            branchId,
            { add, remove },
            { fresh: true },
        );

        const candidates = await this.repository.findReviewCandidates(branchId, event.date);
        // A client's open item from an earlier event is replaced by this event's item, so the
        // new item covers the older change too: sessions since the FIRST change must still count.
        const openItems = await this.repository.listOpenItemsForClients(
            event.id,
            candidates.map((candidate) => candidate.clientId),
        );
        const openByClient = new Map(openItems.map((item) => [item.clientId, item]));
        const assumedOpenItemIds: Record<number, string> = {};
        const drafts: ReviewItemDraft[] = [];
        for (const candidate of candidates) {
            let recalculatedEnd: string;
            let previousEnd: string;
            try {
                recalculatedEnd = current.calcEndDateBusinessDays(candidate.startDate, candidate.duration);
                previousEnd = previous.calcEndDateBusinessDays(candidate.startDate, candidate.duration);
            } catch (error) {
                if (error instanceof UnsupportedKoreanHolidayYearError) {
                    this.logger.debug(
                        `[Holiday Review] client ${candidate.clientId}: unsupported calendar year, skipped`,
                    );
                    continue;
                }
                throw error;
            }
            // "" means the end date could not be derived from start and duration.
            if (recalculatedEnd === "" || previousEnd === "") continue;

            const openItem = openByClient.get(candidate.clientId);
            const affectedFrom = openItem !== undefined && openItem.affectedFrom < event.date
                ? openItem.affectedFrom
                : event.date;
            if (openItem !== undefined) assumedOpenItemIds[candidate.clientId] = openItem.id;
            const { category, reason } = classifyReviewItem(candidate.facts, affectedFrom, recalculatedEnd);
            drafts.push({
                clientId: candidate.clientId,
                // The CLIENT's branch, not the event's: a public event spans every branch.
                branchId: candidate.branchId,
                storedEnd: candidate.endDate,
                recalculatedEnd,
                previousEnd,
                affectedFrom,
                category,
                reason,
            });
        }
        return { drafts, assumedOpenItemIds };
    }

    private describeError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
