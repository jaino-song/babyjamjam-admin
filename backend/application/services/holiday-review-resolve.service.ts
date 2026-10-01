import { HttpException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";

import { ClientService } from "application/services/client.service";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { classifyReviewItem } from "application/services/holiday-review-classification";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    HOLIDAY_REVIEW_REPOSITORY,
    IHolidayReviewRepository,
    ReviewFixSnapshot,
    ReviewItemFilters,
    ReviewItemRecord,
} from "domain/repositories/holiday-review.repository.interface";
import { UnsupportedKoreanHolidayYearError } from "domain/utils/business-days";
import { HolidayChange } from "domain/utils/holiday-review";

/**
 * Why an item was not resolved. Plain strings: ITEM_NOT_FOUND, ITEM_NOT_OPEN, ITEM_RISK,
 * CLIENT_CHANGED, ALREADY_MATCHES, NO_LONGER_SAFE, UPDATE_FAILED, or a problem code
 * surfaced from `ClientService.update` (e.g. SERVICE_RECORD_FINALIZED).
 */
export type ReviewSkipCode = string;

/** One item's result: done (fixed/kept) or skipped with a code. */
type ItemOutcome = { done: "fixed" | "kept" } | { skip: ReviewSkipCode };
const skip = (code: ReviewSkipCode): ItemOutcome => ({ skip: code });

export interface ReviewResolveResult {
    fixed: number;
    kept: number;
    skipped: Array<{ itemId: string; code: ReviewSkipCode }>;
}

export interface HolidayReviewEventView {
    id: string;
    /** `YYYY-MM-DD` */
    date: string;
    change: HolidayChange;
    name: string | null;
    source: string;
    safeOpen: number;
    riskOpen: number;
    /** Full ISO timestamp. */
    createdAt: string;
}

export interface HolidayReviewItemView {
    id: string;
    clientId: string;
    clientName: string;
    storedEnd: string;
    recalculatedEnd: string;
    category: string;
    reason: string;
    status: string;
}

const WRITE_TARGET_CHANGED = "SERVICE_RECORD_WRITE_TARGET_CHANGED";

function problemCodeOf(error: HttpException): string | null {
    const body = error.getResponse();
    if (typeof body === "object" && body !== null) {
        const code = (body as { code?: unknown }).code;
        if (typeof code === "string") return code;
    }
    return null;
}

/**
 * The review endpoints' use cases: the open-event cards, an event's items, and
 * resolving (fixing or keeping) items.
 *
 * Tenant scoping: every repository call carries the request's `branchId`; an
 * event is only ever reached through this branch's items, never by bare id.
 */
@Injectable()
export class HolidayReviewResolveService {
    private readonly logger = new Logger(HolidayReviewResolveService.name);

    constructor(
        @Inject(HOLIDAY_REVIEW_REPOSITORY) private readonly repository: IHolidayReviewRepository,
        private readonly calendarService: HolidayCalendarService,
        private readonly clientService: ClientService,
    ) {}

    async listEvents(branchId: string): Promise<HolidayReviewEventView[]> {
        const events = await this.repository.listOpenEventSummaries(branchId);
        return events.map((event) => ({
            id: event.id,
            date: event.date,
            change: event.change,
            name: event.name,
            source: event.source,
            safeOpen: event.safeOpen,
            riskOpen: event.riskOpen,
            createdAt: event.createdAt.toISOString(),
        }));
    }

    /** 404 only when the event has no items of ANY status here; a filter that matches nothing is `[]`. */
    async listItems(branchId: string, eventId: string, filters: ReviewItemFilters): Promise<HolidayReviewItemView[]> {
        await this.assertEventVisible(branchId, eventId);
        const items = await this.repository.listEventItems(branchId, eventId, {
            ...filters,
            status: filters.status ?? "open",
        });
        return items.map((item) => this.toView(item));
    }

    async resolve(
        branchId: string,
        eventId: string,
        userId: string | null,
        input: { itemIds: string[]; action: "fix" | "keep" },
    ): Promise<ReviewResolveResult> {
        await this.assertEventVisible(branchId, eventId);
        const records = await this.repository.findEventItemsByIds(branchId, eventId, input.itemIds);
        const byId = new Map(records.map((record) => [record.id, record]));

        const result: ReviewResolveResult = { fixed: 0, kept: 0, skipped: [] };
        const fixer = input.action === "fix" ? await this.prepareFix(branchId, eventId) : null;

        // Sequential on purpose: each fix takes the client's write locks, and one
        // item's failure must never stop the rest of the batch.
        for (const itemId of input.itemIds) {
            const item = byId.get(itemId);
            if (!item) {
                result.skipped.push({ itemId, code: "ITEM_NOT_FOUND" });
                continue;
            }
            if (item.status !== "open") {
                result.skipped.push({ itemId, code: "ITEM_NOT_OPEN" });
                continue;
            }
            try {
                const outcome = fixer
                    ? await fixer(item, userId)
                    : await this.keepOne(branchId, eventId, item, userId);
                if ("skip" in outcome) result.skipped.push({ itemId, code: outcome.skip });
                else if (outcome.done === "fixed") result.fixed += 1;
                else result.kept += 1;
            } catch (error) {
                this.logger.error(
                    `[Holiday Review] ${input.action} of item ${itemId} failed: `
                    + `${error instanceof Error ? error.message : String(error)}`,
                );
                result.skipped.push({ itemId, code: "UPDATE_FAILED" });
            }
        }
        return result;
    }

    private async assertEventVisible(branchId: string, eventId: string): Promise<void> {
        if (!(await this.repository.branchHasEventItems(branchId, eventId))) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
    }

    private async keepOne(
        branchId: string,
        eventId: string,
        item: ReviewItemRecord,
        userId: string | null,
    ): Promise<ItemOutcome> {
        const closed = await this.repository.closeOpenItem(branchId, eventId, item.id, {
            status: "kept",
            resolvedBy: userId,
        });
        // Lost the race to another resolve or to the processor.
        return closed ? { done: "kept" } : skip("ITEM_NOT_OPEN");
    }

    /**
     * Loads what every fix needs once per request (the event date and a fresh branch
     * calendar) and returns the per-item fixer. A calendar that cannot be loaded fails
     * the request before anything is changed.
     */
    private async prepareFix(
        branchId: string,
        eventId: string,
    ): Promise<(item: ReviewItemRecord, userId: string | null) => Promise<ItemOutcome>> {
        const event = await this.repository.findEventRecord(branchId, eventId);
        if (!event) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        // SAVED computation: the end date below is persisted, so the cached calendar is not enough.
        const calendar = await this.calendarService.forBranch(branchId, { fresh: true });

        return async (item, userId) => {
            if (item.category === "risk") return skip("ITEM_RISK");

            const snapshot = await this.repository.findFixSnapshot(branchId, item.clientId);
            if (!this.stillMatchesStoredEnd(snapshot, item)) {
                await this.repository.closeOpenItem(branchId, eventId, item.id, {
                    status: "obsolete",
                    resolvedBy: null,
                });
                return skip("CLIENT_CHANGED");
            }
            // stillMatchesStoredEnd guarantees these.
            const { startDate, duration, facts } = snapshot as ReviewFixSnapshot;

            let recalculatedEnd: string;
            try {
                recalculatedEnd = calendar.calcEndDateBusinessDays(startDate as string, duration as number);
            } catch (error) {
                if (error instanceof UnsupportedKoreanHolidayYearError) {
                    this.logger.debug(`[Holiday Review] client ${item.clientId}: unsupported calendar year, not fixed`);
                    return skip("UPDATE_FAILED");
                }
                throw error;
            }
            if (recalculatedEnd === "") return skip("UPDATE_FAILED");

            if (recalculatedEnd === item.storedEnd) {
                // The calendar moved back (or another fix landed): nothing left to do.
                await this.repository.closeOpenItem(branchId, eventId, item.id, {
                    status: "obsolete",
                    resolvedBy: null,
                });
                return skip("ALREADY_MATCHES");
            }

            // State may have changed since the item was filed (a session was recorded, a case finalized).
            const verdict = classifyReviewItem(facts, event.date, recalculatedEnd);
            if (verdict.category !== "safe") {
                await this.repository.reclassifyOpenItem(branchId, eventId, item.id, {
                    category: verdict.category,
                    reason: verdict.reason,
                    recalculatedEnd,
                });
                return skip("NO_LONGER_SAFE");
            }

            return this.applyFix(branchId, eventId, item, recalculatedEnd, userId);
        };
    }

    private stillMatchesStoredEnd(snapshot: ReviewFixSnapshot | null, item: ReviewItemRecord): boolean {
        return snapshot !== null
            && !snapshot.terminated
            && snapshot.startDate !== null
            && snapshot.duration !== null
            && snapshot.endDate === item.storedEnd;
    }

    /**
     * The only sanctioned way to move an end date: `ClientService.update`, which also
     * runs the service-record period validation (409 for finalized cases / locked
     * sessions), ensures the service-record case, plans automation successors and,
     * after commit, relinks contract documents by phone and re-syncs trigger rules.
     * It does NOT change `employee_schedule.endDate` or the signed eformsign contract;
     * the review card is a nudge for the person, not a contract amendment.
     *
     * `expectedEndDate` makes the write fail with a 409 if the end date changed after
     * our snapshot, closing the window between the re-read above and the locked write.
     *
     * The client update and the item write are not one transaction. If the item write
     * fails after a successful update, the item stays open with stored != the client's
     * end date, so the next resolve (CLIENT_CHANGED) or processor run obsoletes it.
     */
    private async applyFix(
        branchId: string,
        eventId: string,
        item: ReviewItemRecord,
        recalculatedEnd: string,
        userId: string | null,
    ): Promise<ItemOutcome> {
        try {
            await this.clientService.update(branchId, item.clientId, {
                endDate: recalculatedEnd,
                expectedEndDate: item.storedEnd,
            });
        } catch (error) {
            if (!(error instanceof HttpException)) {
                this.logger.error(
                    `[Holiday Review] client ${item.clientId} update failed: `
                    + `${error instanceof Error ? error.message : String(error)}`,
                );
                return skip("UPDATE_FAILED");
            }
            const code = problemCodeOf(error);
            if (code === WRITE_TARGET_CHANGED) {
                // The same code is also raised for lock-set changes; only a moved end date makes the item obsolete.
                const now = await this.repository.findFixSnapshot(branchId, item.clientId);
                if (now === null || now.endDate !== item.storedEnd) {
                    await this.repository.closeOpenItem(branchId, eventId, item.id, {
                        status: "obsolete",
                        resolvedBy: null,
                    });
                    return skip("CLIENT_CHANGED");
                }
            }
            return skip(code ?? "UPDATE_FAILED");
        }

        try {
            await this.repository.closeOpenItem(branchId, eventId, item.id, { status: "fixed", resolvedBy: userId });
        } catch (error) {
            // The end date is already fixed; see the note above on how the stale item heals.
            this.logger.error(
                `[Holiday Review] client ${item.clientId} fixed but item ${item.id} not closed: `
                + `${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return { done: "fixed" };
    }

    private toView(item: ReviewItemRecord): HolidayReviewItemView {
        return {
            id: item.id,
            clientId: String(item.clientId),
            clientName: item.clientName,
            storedEnd: item.storedEnd,
            recalculatedEnd: item.recalculatedEnd,
            category: item.category,
            reason: item.reason,
            status: item.status,
        };
    }
}
