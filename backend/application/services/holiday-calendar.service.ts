import { Inject, Injectable } from "@nestjs/common";

import {
    BUILTIN_PUBLIC_HOLIDAY_NAME,
    BranchHolidayOverrideRecord,
    HOLIDAY_CALENDAR_REPOSITORY,
    IHolidayCalendarRepository,
} from "domain/repositories/holiday-calendar.repository.interface";
import {
    KOREAN_HOLIDAY_CALENDAR,
    KrBusinessDayCalendar,
    createKrBusinessDayCalendar,
} from "domain/utils/business-days";

/** How long a process trusts its last read of the calendar revision. */
export const HOLIDAY_REVISION_CACHE_TTL_MS = 30_000;

export interface HolidayCalendarOptions {
    /** Re-read the revision now instead of trusting the 30s per-process cache. */
    fresh?: boolean;
}

export type EffectiveHolidaySource = "public" | "builtin" | "branch_add";

export interface EffectiveHoliday {
    date: string;
    name: string;
    source: EffectiveHolidaySource;
    /** True when the branch excluded this public/built-in holiday. */
    excluded: boolean;
    overrideId: string | null;
}

export interface EffectiveHolidayYear {
    year: number;
    revision: number;
    supported: boolean;
    synced: boolean;
    lastSyncedAt: string | null;
    holidays: EffectiveHoliday[];
}

interface PublicEntry {
    name: string;
    source: "public" | "builtin";
}

/** Everything derived from one (branch, revision) read of the DB. */
interface BranchCalendarModel {
    revision: number;
    calendar: KrBusinessDayCalendar;
    snapshotValidatedAt: ReadonlyMap<number, Date>;
    publicByDate: ReadonlyMap<string, PublicEntry>;
    overrides: readonly BranchHolidayOverrideRecord[];
}

const BUILTIN_YEARS: readonly number[] = Object.keys(KOREAN_HOLIDAY_CALENDAR).map(Number);

function yearOf(iso: string): number {
    return Number(iso.slice(0, 4));
}

/**
 * Branch-aware Korean business-day calendar backed by the synced public
 * holidays, the built-in calendar and per-branch overrides.
 *
 * Singleton on purpose: callers across the app inject it and the caches below
 * are per process. It never touches `runSystemScope`; overrides are read with
 * an explicit `branchId`, so under a request the branch must be the request's.
 */
@Injectable()
export class HolidayCalendarService {
    private revisionCache: { value: number; readAt: number } | null = null;
    private readonly models = new Map<string, { revision: number; model: Promise<BranchCalendarModel> }>();

    constructor(
        @Inject(HOLIDAY_CALENDAR_REPOSITORY) private readonly repository: IHolidayCalendarRepository,
    ) {}

    async forBranch(branchId: string, opts: HolidayCalendarOptions = {}): Promise<KrBusinessDayCalendar> {
        return (await this.modelFor(branchId, opts)).calendar;
    }

    /** The effective holiday list of one year as the branch sees it (for the settings screen). */
    async getEffectiveYear(
        branchId: string,
        year: number,
        opts: HolidayCalendarOptions = {},
    ): Promise<EffectiveHolidayYear> {
        const model = await this.modelFor(branchId, opts);
        const validatedAt = model.snapshotValidatedAt.get(year) ?? null;
        const synced = validatedAt !== null;
        const supported = synced || BUILTIN_YEARS.includes(year);
        if (!supported) {
            return { year, revision: model.revision, supported: false, synced: false, lastSyncedAt: null, holidays: [] };
        }

        const excludedByDate = new Map<string, BranchHolidayOverrideRecord>();
        const holidays: EffectiveHoliday[] = [];
        for (const override of model.overrides) {
            if (yearOf(override.date) !== year) continue;
            if (override.kind === "exclude") excludedByDate.set(override.date, override);
        }
        for (const [date, entry] of model.publicByDate) {
            if (yearOf(date) !== year) continue;
            const exclusion = excludedByDate.get(date);
            holidays.push({
                date,
                name: entry.name,
                source: entry.source,
                excluded: exclusion !== undefined,
                overrideId: exclusion ? exclusion.id : null,
            });
        }
        for (const override of model.overrides) {
            if (override.kind !== "add" || yearOf(override.date) !== year) continue;
            // A later sync may have made the date public; public wins, the add is redundant.
            if (model.publicByDate.has(override.date)) continue;
            holidays.push({
                date: override.date,
                name: override.name ?? "",
                source: "branch_add",
                excluded: false,
                overrideId: override.id,
            });
        }
        holidays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        return {
            year,
            revision: model.revision,
            supported: true,
            synced,
            lastSyncedAt: validatedAt ? validatedAt.toISOString() : null,
            holidays,
        };
    }

    /**
     * Forget the cached revision. Callers that just wrote the calendar use
     * this so the next read in this process sees the new revision at once.
     */
    invalidateRevisionCache(): void {
        this.revisionCache = null;
    }

    private async currentRevision(fresh: boolean): Promise<number> {
        const now = Date.now();
        const cached = this.revisionCache;
        if (!fresh && cached && now - cached.readAt < HOLIDAY_REVISION_CACHE_TTL_MS) {
            return cached.value;
        }
        const value = await this.repository.readRevision();
        this.revisionCache = { value, readAt: Date.now() };
        return value;
    }

    private async modelFor(branchId: string, opts: HolidayCalendarOptions): Promise<BranchCalendarModel> {
        const revision = await this.currentRevision(opts.fresh === true);
        const cached = this.models.get(branchId);
        if (cached && cached.revision === revision) return cached.model;

        // The revision was read before the data below, so the data is at least as
        // new as the label it is cached under; a newer revision rebuilds it.
        const model = this.buildModel(branchId, revision);
        const entry = { revision, model };
        this.models.set(branchId, entry);
        model.catch(() => {
            if (this.models.get(branchId) === entry) this.models.delete(branchId);
        });
        return model;
    }

    private async buildModel(branchId: string, revision: number): Promise<BranchCalendarModel> {
        const [publicData, overrides] = await Promise.all([
            this.repository.readPublicCalendar(),
            this.repository.readBranchOverrides(branchId),
        ]);

        const snapshotValidatedAt = new Map<number, Date>();
        for (const snapshot of publicData.snapshots) snapshotValidatedAt.set(snapshot.year, snapshot.validatedAt);

        const publicByDate = new Map<string, PublicEntry>();
        for (const holiday of publicData.holidays) {
            if (!snapshotValidatedAt.has(yearOf(holiday.date))) continue;
            publicByDate.set(holiday.date, { name: holiday.name, source: "public" });
        }
        for (const [yearKey, dates] of Object.entries(KOREAN_HOLIDAY_CALENDAR)) {
            if (snapshotValidatedAt.has(Number(yearKey))) continue;
            for (const date of dates) publicByDate.set(date, { name: BUILTIN_PUBLIC_HOLIDAY_NAME, source: "builtin" });
        }

        const holidays = new Set<string>(publicByDate.keys());
        for (const override of overrides) {
            if (override.kind === "add") holidays.add(override.date);
        }
        // Excludes win over adds only through the unique (branch, date) key, so a
        // date never carries both; apply them last for clarity.
        for (const override of overrides) {
            if (override.kind === "exclude") holidays.delete(override.date);
        }

        // Always explicit: a branch add must never make an otherwise unsupported year supported.
        const supportedYears = new Set<number>([...snapshotValidatedAt.keys(), ...BUILTIN_YEARS]);
        const calendar = createKrBusinessDayCalendar([...holidays].sort(), {
            version: `kr-db-r${revision}-b${branchId.slice(0, 8)}`,
            supportedYears,
        });

        return { revision, calendar, snapshotValidatedAt, publicByDate, overrides };
    }
}
