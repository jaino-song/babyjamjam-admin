export const HOLIDAY_CALENDAR_REPOSITORY = "HOLIDAY_CALENDAR_REPOSITORY";

/** The built-in calendar carries dates only; this is the display name used for them. */
export const BUILTIN_PUBLIC_HOLIDAY_NAME = "공휴일";

export type HolidayOverrideKind = "add" | "exclude";

export interface HolidaySnapshotRecord {
    year: number;
    validatedAt: Date;
}

export interface PublicHolidayRecord {
    /** ISO `YYYY-MM-DD`. */
    date: string;
    name: string;
}

export interface BranchHolidayOverrideRecord {
    id: string;
    branchId: string;
    /** ISO `YYYY-MM-DD`. */
    date: string;
    kind: HolidayOverrideKind;
    name: string | null;
    createdBy: string | null;
    createdAt: Date;
}

/**
 * One consistent read of everything a branch calendar is built from. All of it
 * comes from a single repeatable-read transaction, so `revision` is the
 * revision the rest of the data was read at.
 */
export interface HolidayCalendarReadData {
    revision: number;
    snapshots: HolidaySnapshotRecord[];
    /** Every `public_holiday` row, regardless of whether its year has a snapshot. */
    holidays: PublicHolidayRecord[];
    /** The branch's overrides (explicit `branchId` filter). */
    overrides: BranchHolidayOverrideRecord[];
}

export interface HolidayPublicLookup {
    /** True when the year has a snapshot row or is part of the built-in calendar. */
    yearSupported: boolean;
    /** Name of the public/built-in holiday on the date, or null when it is not a public holiday. */
    publicName: string | null;
}

export interface CreateHolidayOverrideData {
    branchId: string;
    /** ISO `YYYY-MM-DD`. */
    date: string;
    kind: HolidayOverrideKind;
    name: string | null;
    createdBy: string | null;
}

export interface HolidayBranchChangeData {
    branchId: string;
    /** ISO `YYYY-MM-DD`. */
    date: string;
    change: "added" | "removed";
    name: string | null;
}

/**
 * Raised by `insertOverride` when the (branch, date) unique constraint trips,
 * so the application layer never has to look at Prisma error codes.
 */
export class HolidayOverrideConflictError extends Error {
    constructor() {
        super("A holiday override already exists for this branch and date");
        this.name = "HolidayOverrideConflictError";
    }
}

/**
 * Statements available inside one override transaction. The transaction has
 * already incremented `holiday_calendar_revision` (its first statement), so
 * everything read here is serialized against a concurrent sync, which locks
 * the same row. Throwing out of the operation rolls back the revision bump.
 */
export interface IHolidayOverrideTransaction {
    /** Reads the effective public/built-in state of a date inside the transaction. */
    lookupPublicHoliday(date: string): Promise<HolidayPublicLookup>;
    findOverride(id: string, branchId: string): Promise<BranchHolidayOverrideRecord | null>;
    /** The branch's override on a date, if any (the unique key is branch + date). */
    findOverrideByDate(branchId: string, date: string): Promise<BranchHolidayOverrideRecord | null>;
    /** @throws HolidayOverrideConflictError when the branch already has an override on that date. */
    insertOverride(data: CreateHolidayOverrideData): Promise<BranchHolidayOverrideRecord>;
    /** Returns false when no row with that id exists for the branch. */
    deleteOverride(id: string, branchId: string): Promise<boolean>;
    insertBranchChangeEvent(data: HolidayBranchChangeData): Promise<void>;
}

export interface IHolidayCalendarRepository {
    /** Current `holiday_calendar_revision.revision` (0 when the row is missing). */
    readRevision(): Promise<number>;
    /**
     * Revision, snapshots, public holidays and the branch's overrides read in ONE
     * repeatable-read transaction. Overrides are always filtered by the explicit `branchId`.
     */
    readCalendar(branchId: string): Promise<HolidayCalendarReadData>;
    /** Latest successful validation time of a year's snapshot, read directly (never revision-cached). */
    readSnapshotValidatedAt(year: number): Promise<Date | null>;
    /**
     * Runs `operation` in one transaction whose first statement increments the
     * calendar revision. The result of the operation is returned after commit.
     */
    withOverrideTransaction<T>(operation: (tx: IHolidayOverrideTransaction) => Promise<T>): Promise<T>;
}
