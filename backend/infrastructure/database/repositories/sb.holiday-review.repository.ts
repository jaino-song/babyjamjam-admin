import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    ApplyReviewEventInput,
    ApplyReviewEventResult,
    HolidayChangeEventRecord,
    IHolidayReviewRepository,
    ReviewCandidateClient,
} from "domain/repositories/holiday-review.repository.interface";
import { SERVICE_STATUS } from "domain/value-objects/service-status.vo";
import { HolidayChange, decideReviewItemAction } from "domain/utils/holiday-review";
import { PrismaService } from "infrastructure/database/prisma.service";

export const HOLIDAY_REVIEW_LOCK_KEY = "holiday-review-process";
const REVIEW_TRANSACTION_TIMEOUT_MS = 60_000;
/** More than a sync plus a few overrides ever produce between two cron runs; the rest waits for the next run. */
const UNPROCESSED_EVENT_LIMIT = 1_000;

const toDbDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const fromDbDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Processing-side reads and writes of the holiday-change review pipeline.
 *
 * This runs from the scheduler, which has no tenant store, so the tenant
 * extension bypasses itself (cron case) and no `runSystemScope` is needed.
 * Public events (`branch_id NULL`) are therefore readable here; every item
 * write still carries the CLIENT's branch id.
 */
@Injectable()
export class SbHolidayReviewRepository implements IHolidayReviewRepository {
    constructor(private readonly prisma: PrismaService) {}

    async listUnprocessedEvents(): Promise<HolidayChangeEventRecord[]> {
        const rows = await this.prisma.holiday_change_event.findMany({
            where: { processedAt: null },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: UNPROCESSED_EVENT_LIMIT,
        });
        return rows.map((row) => ({
            id: row.id,
            branchId: row.branchId,
            date: fromDbDate(row.date),
            change: row.change as HolidayChange,
            name: row.name,
            source: row.source,
            createdAt: row.createdAt,
        }));
    }

    async listBranchOverrides(branchId: string): Promise<Array<{ date: string; kind: "add" | "exclude" }>> {
        const rows = await this.prisma.branch_holiday_override.findMany({
            where: { branchId },
            select: { date: true, kind: true },
        });
        return rows.map((row) => ({ date: fromDbDate(row.date), kind: row.kind as "add" | "exclude" }));
    }

    async findReviewCandidates(branchId: string, date: string): Promise<ReviewCandidateClient[]> {
        const day = toDbDate(date);
        const rows = await this.prisma.client.findMany({
            where: {
                branchId,
                duration: { not: null },
                startDate: { lte: day },
                endDate: { gte: day },
                // `{ not: x }` would also drop NULL statuses, which are live clients.
                OR: [{ serviceStatus: null }, { serviceStatus: { not: SERVICE_STATUS.TERMINATED } }],
            },
            select: {
                id: true,
                branchId: true,
                startDate: true,
                endDate: true,
                duration: true,
                serviceRecordCase: {
                    select: {
                        status: true,
                        days: { select: { serviceDate: true, locked: true } },
                    },
                },
            },
            orderBy: { id: "asc" },
        });

        const candidates: ReviewCandidateClient[] = [];
        for (const row of rows) {
            if (row.branchId === null || row.startDate === null || row.endDate === null || row.duration === null) {
                continue;
            }
            candidates.push({
                clientId: row.id,
                branchId: row.branchId,
                startDate: fromDbDate(row.startDate),
                endDate: fromDbDate(row.endDate),
                duration: row.duration,
                facts: {
                    caseStatus: row.serviceRecordCase?.status ?? null,
                    days: (row.serviceRecordCase?.days ?? []).map((d) => ({
                        date: fromDbDate(d.serviceDate),
                        locked: d.locked,
                    })),
                },
            });
        }
        return candidates;
    }

    async applyEventResult(input: ApplyReviewEventInput): Promise<ApplyReviewEventResult> {
        return this.prisma.$transaction(
            (tx) => this.applyInTransaction(tx, input),
            { timeout: REVIEW_TRANSACTION_TIMEOUT_MS },
        );
    }

    private async applyInTransaction(
        tx: Prisma.TransactionClient,
        { eventId, drafts, expectedUnprocessedEventIds }: ApplyReviewEventInput,
    ): Promise<ApplyReviewEventResult> {
        // Same lock form as the sync lock: two instances never process the same event.
        await tx.$executeRaw(Prisma.sql`
            SELECT pg_advisory_xact_lock(hashtextextended(${HOLIDAY_REVIEW_LOCK_KEY}, 0))
        `);

        const event = await tx.holiday_change_event.findFirst({
            where: { id: eventId, processedAt: null },
            select: { id: true },
        });
        if (!event) return { status: "already_processed" };

        const expected = new Set(expectedUnprocessedEventIds);
        const unprocessed = await tx.holiday_change_event.findMany({
            where: { processedAt: null },
            select: { id: true },
        });
        if (unprocessed.some((row) => !expected.has(row.id))) return { status: "events_changed" };

        const now = new Date();
        let created = 0;
        let obsoleted = 0;

        if (drafts.length > 0) {
            // An open item that belongs to THIS event stays untouched (replay safety).
            const openRows = await tx.end_date_review_item.findMany({
                where: {
                    status: "open",
                    clientId: { in: drafts.map((draft) => draft.clientId) },
                    branchId: { in: [...new Set(drafts.map((draft) => draft.branchId))] },
                    changeEventId: { not: eventId },
                },
                select: { id: true, clientId: true },
            });
            const openByClient = new Map(openRows.map((row) => [row.clientId, row.id]));

            for (const draft of drafts) {
                const openItemId = openByClient.get(draft.clientId);
                const action = decideReviewItemAction({
                    hadOpenItem: openItemId !== undefined,
                    storedEnd: draft.storedEnd,
                    recalculatedEnd: draft.recalculatedEnd,
                    previousEnd: draft.previousEnd,
                });
                if (action.obsoleteOpenItem && openItemId !== undefined) {
                    // Before the insert: the partial unique index allows one open item per client.
                    const result = await tx.end_date_review_item.updateMany({
                        where: { id: openItemId, status: "open" },
                        data: { status: "obsolete", resolvedAt: now },
                    });
                    obsoleted += result.count;
                }
                if (action.createItem) {
                    await tx.end_date_review_item.upsert({
                        where: {
                            changeEventId_clientId: { changeEventId: eventId, clientId: draft.clientId },
                        },
                        create: {
                            changeEventId: eventId,
                            branchId: draft.branchId,
                            clientId: draft.clientId,
                            storedEnd: toDbDate(draft.storedEnd),
                            recalculatedEnd: toDbDate(draft.recalculatedEnd),
                            category: draft.category,
                            reason: draft.reason,
                        },
                        // A replay must not reopen or rewrite an item that already exists.
                        update: {},
                    });
                    created += 1;
                }
            }
        }

        await tx.holiday_change_event.update({ where: { id: eventId }, data: { processedAt: now } });
        return { status: "applied", created, obsoleted };
    }
}
