import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { KOREAN_HOLIDAY_CALENDAR } from "domain/utils/business-days";
import {
    IHolidaySyncRepository,
    HolidaySyncWriteInput,
    HolidaySyncWriteResult,
} from "domain/repositories/holiday-sync.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";

export const HOLIDAY_SYNC_LOCK_KEY = "holiday-calendar-sync";
const HOLIDAY_SYNC_TRANSACTION_TIMEOUT_MS = 15_000;
const KASI_SOURCE = "kasi";

const toDbDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const fromDbDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Every write here targets public (branch-less) data. `public_holiday`,
 * `holiday_year_snapshot` and `holiday_calendar_revision` are not tenant models,
 * but public `holiday_change_event` rows carry `branchId: null`, which an
 * HTTP-origin branch scope rejects (`branch_mutation`). The whole transaction
 * therefore runs in system scope on EVERY trigger (cron and the manual
 * `POST .../holidays/sync` alike), which also keeps the advisory-lock raw SQL
 * out of the `raw_op_in_http_context` log.
 */
@Injectable()
export class SbHolidaySyncRepository implements IHolidaySyncRepository {
    constructor(private readonly prisma: PrismaService) {}

    async applyYearSync(input: HolidaySyncWriteInput): Promise<HolidaySyncWriteResult> {
        return runSystemScope(() => this.prisma.$transaction(
            (tx) => this.applyInTransaction(tx, input),
            { timeout: HOLIDAY_SYNC_TRANSACTION_TIMEOUT_MS },
        ));
    }

    private async applyInTransaction(
        tx: Prisma.TransactionClient,
        { year, items, rawCount }: HolidaySyncWriteInput,
    ): Promise<HolidaySyncWriteResult> {
        // Serialize concurrent syncs, then take the revision row so branch override
        // transactions (whose first statement bumps the same row) queue behind us.
        await tx.$executeRaw(Prisma.sql`
            SELECT pg_advisory_xact_lock(hashtextextended(${HOLIDAY_SYNC_LOCK_KEY}, 0))
        `);
        await tx.$queryRaw(Prisma.sql`
            SELECT revision FROM holiday_calendar_revision WHERE id = 1 FOR UPDATE
        `);

        const now = new Date();
        const yearStart = toDbDate(`${year}-01-01`);
        const yearEnd = toDbDate(`${year}-12-31`);
        const yearRange = { gte: yearStart, lte: yearEnd };

        const snapshot = await tx.holiday_year_snapshot.findUnique({ where: { year } });
        const existingRows = await tx.public_holiday.findMany({
            where: { date: yearRange },
            select: { date: true, name: true },
        });

        // Previous effective public set: DB rows once the year has a snapshot, else the
        // built-in list, else unknown (the year was unsupported, so nothing "changed").
        const builtIn = KOREAN_HOLIDAY_CALENDAR[year];
        const previous: Map<string, string | null> | null = snapshot
            ? new Map(existingRows.map((row) => [fromDbDate(row.date), row.name]))
            : builtIn
                ? new Map(builtIn.map((date) => [date, null]))
                : null;

        const next = new Map(items.map((item) => [item.date, item.name]));
        const addedDates = previous === null ? [] : [...next.keys()].filter((date) => !previous.has(date)).sort();
        const removedDates = previous === null ? [] : [...previous.keys()].filter((date) => !next.has(date)).sort();

        if (snapshot && addedDates.length === 0 && removedDates.length === 0) {
            const renamed = existingRows.filter((row) => {
                const name = next.get(fromDbDate(row.date));
                return name !== undefined && name !== row.name;
            });
            // Same date set: refresh timestamps (and any renamed holiday). Business-day
            // results cannot change, so there are no change events; but readers cache the
            // calendar by revision, so a rename must still bump it or they never see it.
            for (const row of renamed) {
                await tx.public_holiday.update({
                    where: { date: row.date },
                    data: { name: next.get(fromDbDate(row.date)), fetchedAt: now },
                });
            }
            await tx.public_holiday.updateMany({ where: { date: yearRange }, data: { fetchedAt: now } });
            let revision: number | undefined;
            if (renamed.length > 0) {
                const bumped = await tx.holiday_calendar_revision.update({
                    where: { id: 1 },
                    data: { revision: { increment: 1 } },
                    select: { revision: true },
                });
                revision = Number(bumped.revision);
            }
            await tx.holiday_year_snapshot.update({
                where: { year },
                data: revision === undefined
                    ? { fetchedAt: now, validatedAt: now }
                    : { revision, fetchedAt: now, validatedAt: now },
            });
            return { status: "unchanged", added: 0, removed: 0 };
        }

        const events = [
            ...addedDates.map((date) => ({
                branchId: null,
                date: toDbDate(date),
                change: "added",
                name: next.get(date) ?? null,
                source: KASI_SOURCE,
                processedAt: null,
            })),
            ...removedDates.map((date) => ({
                branchId: null,
                date: toDbDate(date),
                change: "removed",
                name: previous?.get(date) ?? null,
                source: KASI_SOURCE,
                processedAt: null,
            })),
        ];
        if (events.length > 0) {
            await tx.holiday_change_event.createMany({ data: events });
        }

        await tx.public_holiday.deleteMany({ where: { date: yearRange } });
        if (items.length > 0) {
            await tx.public_holiday.createMany({
                data: items.map((item) => ({
                    date: toDbDate(item.date),
                    name: item.name,
                    source: KASI_SOURCE,
                    fetchedAt: now,
                })),
            });
        }

        const bumped = await tx.holiday_calendar_revision.update({
            where: { id: 1 },
            data: { revision: { increment: 1 } },
            select: { revision: true },
        });
        // holiday_calendar_revision.revision is BigInt; the snapshot column is Int.
        const revision = Number(bumped.revision);
        await tx.holiday_year_snapshot.upsert({
            where: { year },
            create: {
                year,
                revision,
                itemCount: rawCount,
                source: KASI_SOURCE,
                fetchedAt: now,
                validatedAt: now,
            },
            update: {
                revision,
                itemCount: rawCount,
                source: KASI_SOURCE,
                fetchedAt: now,
                validatedAt: now,
            },
        });

        return { status: "updated", added: addedDates.length, removed: removedDates.length };
    }
}
