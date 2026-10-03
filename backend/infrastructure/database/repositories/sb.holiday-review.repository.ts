import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    ApplyReviewEventInput,
    ApplyReviewEventResult,
    HolidayChangeEventRecord,
    IHolidayReviewRepository,
    ReviewCandidateClient,
    ReviewEventSummary,
    ReviewFixSnapshot,
    OpenReviewItemRef,
    ReviewItemFilters,
    ReviewItemRecord,
} from "domain/repositories/holiday-review.repository.interface";
import { SERVICE_STATUS } from "domain/value-objects/service-status.vo";
import { isoDateInKorea } from "domain/utils/business-days";
import {
    HolidayChange,
    ReviewCategory,
    ReviewClientFacts,
    ReviewReason,
    ReviewStatus,
    decideReviewItemAction,
} from "domain/utils/holiday-review";
import { PrismaService } from "infrastructure/database/prisma.service";

export const HOLIDAY_REVIEW_LOCK_KEY = "holiday-review-process";
const REVIEW_TRANSACTION_TIMEOUT_MS = 60_000;
const toDbDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const fromDbDate = (date: Date): string => date.toISOString().slice(0, 10);

const caseFacts = (
    serviceRecordCase: { status: string; days: Array<{ serviceDate: Date; locked: boolean }> } | null,
): ReviewClientFacts => ({
    caseStatus: serviceRecordCase?.status ?? null,
    days: (serviceRecordCase?.days ?? []).map((d) => ({ date: fromDbDate(d.serviceDate), locked: d.locked })),
});

const toEventRecord = (row: {
    id: string;
    branchId: string | null;
    date: Date;
    change: string;
    name: string | null;
    source: string;
    createdAt: Date;
}): HolidayChangeEventRecord => ({
    id: row.id,
    branchId: row.branchId,
    date: fromDbDate(row.date),
    change: row.change as HolidayChange,
    name: row.name,
    source: row.source,
    createdAt: row.createdAt,
});

const toItemRecord = (row: {
    id: string;
    clientId: number;
    storedEnd: Date;
    recalculatedEnd: Date;
    affectedFrom: Date;
    category: string;
    reason: string | null;
    status: string;
    client: { name: string };
}): ReviewItemRecord => ({
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    storedEnd: fromDbDate(row.storedEnd),
    recalculatedEnd: fromDbDate(row.recalculatedEnd),
    affectedFrom: fromDbDate(row.affectedFrom),
    category: row.category as ReviewCategory,
    reason: row.reason as ReviewReason,
    status: row.status as ReviewStatus,
});

/**
 * Reads and writes of the holiday-change review pipeline.
 *
 * Processing runs from the scheduler, which has no tenant store, so the tenant
 * extension bypasses itself (cron case) and no `runSystemScope` is needed.
 * Public events (`branch_id NULL`) are therefore readable there; every item
 * write still carries the CLIENT's branch id.
 *
 * The HTTP-path methods run under the request's tenant store. That extension
 * only checks (aggregates and writes must pin `branchId` in the top-level
 * `where`; row reads are scanned for foreign branch ids), so each of those
 * queries puts `branchId` in its top-level `where` itself.
 */
@Injectable()
export class SbHolidayReviewRepository implements IHolidayReviewRepository {
    constructor(private readonly prisma: PrismaService) {}

    async listUnprocessedEvents(): Promise<HolidayChangeEventRecord[]> {
        const rows = await this.prisma.holiday_change_event.findMany({
            where: { processedAt: null },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        return rows.map(toEventRecord);
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
        // A client whose stored end date is already past is finished: a change dated inside its
        // old period must not file an item (one click would move a finished client's end date).
        // Not an event-date rule: a past-dated change can still move the end of an ongoing period.
        const today = toDbDate(isoDateInKorea());
        const rows = await this.prisma.client.findMany({
            where: {
                branchId,
                duration: { not: null },
                startDate: { lte: day },
                AND: [
                    // Top-level, so it also bounds the open-item branch below.
                    { endDate: { gte: today } },
                    {
                        // In the period, or its open item's shown new end is still ahead of the date.
                        OR: [
                            { endDate: { gte: day } },
                            { endDateReviewItems: { some: { status: "open", recalculatedEnd: { gte: day } } } },
                        ],
                    },
                    // `{ not: x }` would also drop NULL statuses, which are live clients.
                    { OR: [{ serviceStatus: null }, { serviceStatus: { not: SERVICE_STATUS.TERMINATED } }] },
                ],
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
                facts: caseFacts(row.serviceRecordCase),
            });
        }
        return candidates;
    }

    async listOpenItemsForClients(exceptEventId: string, clientIds: number[]): Promise<OpenReviewItemRef[]> {
        if (clientIds.length === 0) return [];
        const rows = await this.prisma.end_date_review_item.findMany({
            where: { status: "open", clientId: { in: clientIds }, changeEventId: { not: exceptEventId } },
            select: { id: true, clientId: true, affectedFrom: true },
        });
        return rows.map((row) => ({ id: row.id, clientId: row.clientId, affectedFrom: fromDbDate(row.affectedFrom) }));
    }

    async listOpenEventSummaries(branchId: string): Promise<ReviewEventSummary[]> {
        const groups = await this.prisma.end_date_review_item.groupBy({
            by: ["changeEventId", "category"],
            where: { branchId, status: "open" },
            _count: { _all: true },
        });
        if (groups.length === 0) return [];

        const counts = new Map<string, { safeOpen: number; riskOpen: number }>();
        for (const group of groups) {
            const entry = counts.get(group.changeEventId) ?? { safeOpen: 0, riskOpen: 0 };
            if (group.category === "safe") entry.safeOpen += group._count._all;
            else entry.riskOpen += group._count._all;
            counts.set(group.changeEventId, entry);
        }

        // Events only by the ids this branch has open items for, and only public or this branch's own.
        const events = await this.prisma.holiday_change_event.findMany({
            where: { id: { in: [...counts.keys()] }, OR: [{ branchId: null }, { branchId }] },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        return events.map((event) => ({
            ...toEventRecord(event),
            ...(counts.get(event.id) ?? { safeOpen: 0, riskOpen: 0 }),
        }));
    }

    async findEventRecord(branchId: string, eventId: string): Promise<HolidayChangeEventRecord | null> {
        const row = await this.prisma.holiday_change_event.findFirst({
            where: { id: eventId, OR: [{ branchId: null }, { branchId }] },
        });
        return row === null ? null : toEventRecord(row);
    }

    async branchHasEventItems(branchId: string, eventId: string): Promise<boolean> {
        const row = await this.prisma.end_date_review_item.findFirst({
            where: { branchId, changeEventId: eventId },
            select: { id: true },
        });
        return row !== null;
    }

    async listEventItems(branchId: string, eventId: string, filters: ReviewItemFilters): Promise<ReviewItemRecord[]> {
        const rows = await this.prisma.end_date_review_item.findMany({
            where: {
                branchId,
                changeEventId: eventId,
                ...(filters.category ? { category: filters.category } : {}),
                ...(filters.status ? { status: filters.status } : {}),
                ...(filters.q ? { client: { name: { contains: filters.q, mode: "insensitive" } } } : {}),
            },
            include: { client: { select: { name: true } } },
            orderBy: [{ client: { name: "asc" } }, { id: "asc" }],
        });
        return rows.map(toItemRecord);
    }

    async findEventItemsByIds(branchId: string, eventId: string, itemIds: string[]): Promise<ReviewItemRecord[]> {
        if (itemIds.length === 0) return [];
        const rows = await this.prisma.end_date_review_item.findMany({
            where: { branchId, changeEventId: eventId, id: { in: itemIds } },
            include: { client: { select: { name: true } } },
        });
        return rows.map(toItemRecord);
    }

    async claimOpenItemForFix(
        branchId: string,
        eventId: string,
        item: ReviewItemRecord,
        userId: string | null,
        transaction: Prisma.TransactionClient,
    ): Promise<boolean> {
        // Acquire before the client write locks, in the same order as the processor.
        await transaction.$executeRaw(Prisma.sql`
            SELECT pg_advisory_xact_lock(hashtextextended(${HOLIDAY_REVIEW_LOCK_KEY}, 0))
        `);
        const result = await transaction.end_date_review_item.updateMany({
            where: {
                id: item.id,
                branchId,
                changeEventId: eventId,
                clientId: item.clientId,
                status: "open",
                storedEnd: toDbDate(item.storedEnd),
                recalculatedEnd: toDbDate(item.recalculatedEnd),
                affectedFrom: toDbDate(item.affectedFrom),
                category: item.category,
                reason: item.reason,
            },
            data: { status: "fixed", resolvedBy: userId, resolvedAt: new Date() },
        });
        return result.count > 0;
    }

    async closeOpenItem(
        branchId: string,
        eventId: string,
        itemId: string,
        outcome: { status: "fixed" | "kept" | "obsolete"; resolvedBy: string | null },
    ): Promise<boolean> {
        const result = await this.prisma.end_date_review_item.updateMany({
            where: { id: itemId, branchId, changeEventId: eventId, status: "open" },
            data: { status: outcome.status, resolvedBy: outcome.resolvedBy, resolvedAt: new Date() },
        });
        return result.count > 0;
    }

    async reclassifyOpenItem(
        branchId: string,
        eventId: string,
        itemId: string,
        update: { category: ReviewCategory; reason: ReviewReason; recalculatedEnd: string },
    ): Promise<boolean> {
        const result = await this.prisma.end_date_review_item.updateMany({
            where: { id: itemId, branchId, changeEventId: eventId, status: "open" },
            data: {
                category: update.category,
                reason: update.reason,
                recalculatedEnd: toDbDate(update.recalculatedEnd),
            },
        });
        return result.count > 0;
    }

    async findFixSnapshot(branchId: string, clientId: number): Promise<ReviewFixSnapshot | null> {
        const row = await this.prisma.client.findFirst({
            where: { id: clientId, branchId },
            select: {
                startDate: true,
                endDate: true,
                duration: true,
                serviceStatus: true,
                serviceRecordCase: {
                    select: { status: true, days: { select: { serviceDate: true, locked: true } } },
                },
            },
        });
        if (!row) return null;
        return {
            startDate: row.startDate === null ? null : fromDbDate(row.startDate),
            endDate: row.endDate === null ? null : fromDbDate(row.endDate),
            duration: row.duration,
            terminated: row.serviceStatus === SERVICE_STATUS.TERMINATED,
            finished: row.endDate !== null && row.endDate < toDbDate(isoDateInKorea()),
            facts: caseFacts(row.serviceRecordCase),
        };
    }

    async applyEventResult(input: ApplyReviewEventInput): Promise<ApplyReviewEventResult> {
        return this.prisma.$transaction(
            (tx) => this.applyInTransaction(tx, input),
            { timeout: REVIEW_TRANSACTION_TIMEOUT_MS },
        );
    }

    private async applyInTransaction(
        tx: Prisma.TransactionClient,
        { eventId, drafts, assumedOpenItemIds, expectedUnprocessedEventIds }: ApplyReviewEventInput,
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
            // `affectedFrom` was derived from the open item seen before this transaction. A
            // different one now (resolved, replaced) makes that classification wrong: retry later.
            for (const draft of drafts) {
                if (openByClient.get(draft.clientId) !== assumedOpenItemIds[draft.clientId]) {
                    return { status: "items_changed" };
                }
            }

            // `storedEnd` was read before this transaction too. A client whose end date moved since
            // (a save, an auto-extend) was classified against a stale one: retry later. This re-read
            // is not a lock on the client rows, so a save that lands after it is not excluded here;
            // that residual race is covered by the resolve path, which refuses to fix an item whose
            // stored end no longer matches the client's (`stillMatchesStoredEnd`).
            const currentEnds = await tx.client.findMany({
                where: {
                    id: { in: drafts.map((draft) => draft.clientId) },
                    branchId: { in: [...new Set(drafts.map((draft) => draft.branchId))] },
                },
                select: { id: true, endDate: true },
            });
            const endByClient = new Map(
                currentEnds.map((row) => [row.id, row.endDate === null ? null : fromDbDate(row.endDate)]),
            );
            for (const draft of drafts) {
                if (endByClient.get(draft.clientId) !== draft.storedEnd) return { status: "items_changed" };
            }

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
                            affectedFrom: toDbDate(draft.affectedFrom),
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
