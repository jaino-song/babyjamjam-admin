import { Inject, Injectable } from "@nestjs/common";

import {
    BUILTIN_PUBLIC_HOLIDAY_NAME,
    BranchHolidayOverrideRecord,
    HOLIDAY_CALENDAR_REPOSITORY,
    HolidayOverrideKind,
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

/** An override that currently changes nothing (its date's public status moved under it). */
export interface InactiveHolidayOverride {
    id: string;
    date: string;
    kind: HolidayOverrideKind;
    name: string | null;
}

export interface EffectiveHolidayYear {
    year: number;
    revision: number;
    supported: boolean;
    synced: boolean;
    lastSyncedAt: string | null;
    holidays: EffectiveHoliday[];
    /**
     * Overrides hidden from `holidays` because they no longer have effect: an
     * `add` on a date that is now public, or an `exclude` on a date that is no
     * longer public. Listed so the UI can offer to delete them.
     */
    inactiveOverrides: InactiveHolidayOverride[];
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
    /** Bumped by every invalidation so a revision read that straddles one cannot repopulate the cache. */
    private generation = 0;
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
        const modelValidatedAt = model.snapshotValidatedAt.get(year) ?? null;
        const synced = modelValidatedAt !== null;
        const supported = synced || BUILTIN_YEARS.includes(year);
        if (!supported) {
            return {
                year,
                revision: model.revision,
                supported: false,
                synced: false,
                lastSyncedAt: null,
                holidays: [],
                inactiveOverrides: [],
            };
        }
        // A sync that changes nothing refreshes validatedAt without bumping the revision, so
        // the revision-keyed model's copy goes stale; read the timestamp itself every time.
        const validatedAt = synced ? ((await this.repository.readSnapshotValidatedAt(year)) ?? modelValidatedAt) : null;

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
        const inactiveOverrides: InactiveHolidayOverride[] = [];
        for (const override of model.overrides) {
            if (yearOf(override.date) !== year) continue;
            const isPublic = model.publicByDate.has(override.date);
            if (override.kind === "exclude") {
                // Active excludes were listed with the public rows above.
                if (!isPublic) {
                    inactiveOverrides.push({ id: override.id, date: override.date, kind: "exclude", name: override.name });
                }
                continue;
            }
            // A later sync may have made the date public; public wins, the add is redundant.
            if (isPublic) {
                inactiveOverrides.push({ id: override.id, date: override.date, kind: "add", name: override.name });
                continue;
            }
            holidays.push({
                date: override.date,
                name: override.name ?? "",
                source: "branch_add",
                excluded: false,
                overrideId: override.id,
            });
        }
        const byDate = (a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
        holidays.sort(byDate);
        inactiveOverrides.sort(byDate);

        return {
            year,
            revision: model.revision,
            supported: true,
            synced,
            lastSyncedAt: validatedAt ? validatedAt.toISOString() : null,
            holidays,
            inactiveOverrides,
        };
    }

    /**
     * Forget the cached revision. Callers that just wrote the calendar use
     * this so the next read in this process sees the new revision at once.
     */
    invalidateRevisionCache(): void {
        this.generation += 1;
        this.revisionCache = null;
    }

    private async currentRevision(fresh: boolean): Promise<number> {
        const now = Date.now();
        const cached = this.revisionCache;
        if (!fresh && cached && now - cached.readAt < HOLIDAY_REVISION_CACHE_TTL_MS) {
            return cached.value;
        }
        const generation = this.generation;
        const value = await this.repository.readRevision();
        // An invalidation that landed while this read was in flight means the value may
        // predate the write that triggered it; use it for this call but do not cache it.
        if (generation === this.generation) this.revisionCache = { value, readAt: Date.now() };
        return value;
    }

    private async modelFor(branchId: string, opts: HolidayCalendarOptions): Promise<BranchCalendarModel> {
        const revision = await this.currentRevision(opts.fresh === true);
        const cached = this.models.get(branchId);
        // A model read at a newer revision than the one just looked up is still valid.
        if (cached && cached.revision >= revision) return cached.model;

        const entry = { revision, model: undefined as unknown as Promise<BranchCalendarModel> };
        // The model is labelled with the revision read inside the same transaction as its
        // data, so the cache key is never older or newer than what it holds.
        entry.model = this.buildModel(branchId).then((model) => {
            entry.revision = model.revision;
            return model;
        });
        this.models.set(branchId, entry);
        entry.model.catch(() => {
            if (this.models.get(branchId) === entry) this.models.delete(branchId);
        });
        return entry.model;
    }

    private async buildModel(branchId: string): Promise<BranchCalendarModel> {
        const { revision, snapshots, holidays: publicRows, overrides } = await this.repository.readCalendar(branchId);

        const snapshotValidatedAt = new Map<number, Date>();
        for (const snapshot of snapshots) snapshotValidatedAt.set(snapshot.year, snapshot.validatedAt);

        const publicByDate = new Map<string, PublicEntry>();
        for (const holiday of publicRows) {
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
