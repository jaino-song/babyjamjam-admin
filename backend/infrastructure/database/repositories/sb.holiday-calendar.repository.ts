import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    BUILTIN_PUBLIC_HOLIDAY_NAME,
    BranchHolidayOverrideRecord,
    CreateHolidayOverrideData,
    HolidayBranchChangeData,
    HolidayOverrideConflictError,
    HolidayOverrideKind,
    HolidayPublicCalendarData,
    HolidayPublicLookup,
    IHolidayCalendarRepository,
    IHolidayOverrideTransaction,
} from "domain/repositories/holiday-calendar.repository.interface";
import { KOREAN_HOLIDAY_CALENDAR } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";

const OVERRIDE_TRANSACTION_TIMEOUT_MS = 15_000;

function toDbDate(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

function fromDbDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

interface OverrideRow {
    id: string;
    branchId: string;
    date: Date;
    kind: string;
    name: string | null;
    createdBy: string | null;
    createdAt: Date;
}

function toOverrideRecord(row: OverrideRow): BranchHolidayOverrideRecord {
    return {
        id: row.id,
        branchId: row.branchId,
        date: fromDbDate(row.date),
        kind: row.kind as HolidayOverrideKind,
        name: row.name,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
    };
}

/**
 * Holiday calendar reads and branch-override writes.
 *
 * `public_holiday`, `holiday_year_snapshot` and `holiday_calendar_revision`
 * are not tenant models; `branch_holiday_override` and `holiday_change_event`
 * are, so every statement against them pins `branchId` explicitly. Nothing
 * here uses `runSystemScope`: the sync repository owns the system-scope writes.
 */
@Injectable()
export class SbHolidayCalendarRepository implements IHolidayCalendarRepository {
    constructor(private readonly prisma: PrismaService) {}

    async readRevision(): Promise<number> {
        const row = await this.prisma.holiday_calendar_revision.findUnique({ where: { id: 1 } });
        return row ? Number(row.revision) : 0;
    }

    async readPublicCalendar(): Promise<HolidayPublicCalendarData> {
        const [snapshots, holidays] = await Promise.all([
            this.prisma.holiday_year_snapshot.findMany({
                select: { year: true, validatedAt: true },
                orderBy: { year: "asc" },
            }),
            this.prisma.public_holiday.findMany({
                select: { date: true, name: true },
                orderBy: { date: "asc" },
            }),
        ]);
        return {
            snapshots: snapshots.map((row) => ({ year: row.year, validatedAt: row.validatedAt })),
            holidays: holidays.map((row) => ({ date: fromDbDate(row.date), name: row.name })),
        };
    }

    async readBranchOverrides(branchId: string): Promise<BranchHolidayOverrideRecord[]> {
        const rows = await this.prisma.branch_holiday_override.findMany({
            where: { branchId },
            orderBy: { date: "asc" },
        });
        return rows.map(toOverrideRecord);
    }

    async withOverrideTransaction<T>(operation: (tx: IHolidayOverrideTransaction) => Promise<T>): Promise<T> {
        return this.prisma.$transaction(
            async (tx) => {
                // First statement: take the revision row lock so a concurrent sync
                // (which locks the same row) is serialized against every check below.
                await tx.holiday_calendar_revision.update({
                    where: { id: 1 },
                    data: { revision: { increment: 1 } },
                });
                return operation(this.transactionOperations(tx));
            },
            { timeout: OVERRIDE_TRANSACTION_TIMEOUT_MS },
        );
    }

    private transactionOperations(tx: Prisma.TransactionClient): IHolidayOverrideTransaction {
        return {
            lookupPublicHoliday: async (date: string): Promise<HolidayPublicLookup> => {
                const year = Number(date.slice(0, 4));
                const snapshot = await tx.holiday_year_snapshot.findUnique({ where: { year } });
                if (snapshot) {
                    const row = await tx.public_holiday.findUnique({ where: { date: toDbDate(date) } });
                    return { yearSupported: true, publicName: row ? row.name : null };
                }
                const builtin = KOREAN_HOLIDAY_CALENDAR[year];
                if (!builtin) return { yearSupported: false, publicName: null };
                return {
                    yearSupported: true,
                    publicName: builtin.includes(date) ? BUILTIN_PUBLIC_HOLIDAY_NAME : null,
                };
            },

            findOverride: async (id: string, branchId: string) => {
                const row = await tx.branch_holiday_override.findFirst({ where: { id, branchId } });
                return row ? toOverrideRecord(row) : null;
            },

            insertOverride: async (data: CreateHolidayOverrideData) => {
                try {
                    const row = await tx.branch_holiday_override.create({
                        data: {
                            branchId: data.branchId,
                            date: toDbDate(data.date),
                            kind: data.kind,
                            name: data.name,
                            createdBy: data.createdBy,
                        },
                    });
                    return toOverrideRecord(row);
                } catch (error) {
                    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                        throw new HolidayOverrideConflictError();
                    }
                    throw error;
                }
            },

            deleteOverride: async (id: string, branchId: string) => {
                const result = await tx.branch_holiday_override.deleteMany({ where: { id, branchId } });
                return result.count > 0;
            },

            insertBranchChangeEvent: async (data: HolidayBranchChangeData) => {
                await tx.holiday_change_event.create({
                    data: {
                        branchId: data.branchId,
                        date: toDbDate(data.date),
                        change: data.change,
                        name: data.name,
                        source: "branch",
                        processedAt: null,
                    },
                });
            },
        };
    }
}
