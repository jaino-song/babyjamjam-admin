import {
    BUILTIN_PUBLIC_HOLIDAY_NAME,
    BranchHolidayOverrideRecord,
    IHolidayCalendarRepository,
} from "domain/repositories/holiday-calendar.repository.interface";
import { KOREAN_HOLIDAY_CALENDAR, UnsupportedKoreanHolidayYearError } from "domain/utils/business-days";
import { HOLIDAY_REVISION_CACHE_TTL_MS, HolidayCalendarService } from "./holiday-calendar.service";

const BRANCH_A = "aaaaaaaa-1111-4111-8111-111111111111";
const BRANCH_B = "bbbbbbbb-2222-4222-8222-222222222222";

function override(
    partial: Partial<BranchHolidayOverrideRecord> & Pick<BranchHolidayOverrideRecord, "date" | "kind">,
): BranchHolidayOverrideRecord {
    return {
        id: `id-${partial.date}`,
        branchId: BRANCH_A,
        name: null,
        createdBy: null,
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        ...partial,
    };
}

interface FakeState {
    revision: number;
    snapshots: Array<{ year: number; validatedAt: Date }>;
    holidays: Array<{ date: string; name: string }>;
    overrides: Record<string, BranchHolidayOverrideRecord[]>;
}

function makeService(initial: Partial<FakeState> = {}) {
    const state: FakeState = { revision: 1, snapshots: [], holidays: [], overrides: {}, ...initial };
    const repository = {
        readRevision: jest.fn(async () => state.revision),
        readCalendar: jest.fn(async (branchId: string) => ({
            revision: state.revision,
            snapshots: state.snapshots,
            holidays: state.holidays,
            overrides: state.overrides[branchId] ?? [],
        })),
        readSnapshotValidatedAt: jest.fn(
            async (year: number) => state.snapshots.find((snapshot) => snapshot.year === year)?.validatedAt ?? null,
        ),
        withOverrideTransaction: jest.fn(),
    } satisfies IHolidayCalendarRepository;
    const service = new HolidayCalendarService(repository);
    return { service, repository, state };
}

const SNAPSHOT_2026 = { year: 2026, validatedAt: new Date("2026-10-01T04:00:00.000Z") };
const FIRST_BUILTIN_2027 = KOREAN_HOLIDAY_CALENDAR[2027]![0]!;

describe("HolidayCalendarService.forBranch", () => {
    it("uses the DB rows for a snapshot year instead of the built-in list", async () => {
        const { service } = makeService({
            snapshots: [SNAPSHOT_2026],
            // 2026-01-01 is built-in, but the synced year only knows Chuseok-less 개천절 here.
            holidays: [{ date: "2026-10-03", name: "개천절" }],
        });

        const calendar = await service.forBranch(BRANCH_A);

        expect(calendar.isBusinessDay("2026-10-02")).toBe(true);
        expect(KOREAN_HOLIDAY_CALENDAR[2026]).toContain("2026-01-01");
        expect(calendar.isBusinessDay("2026-01-01")).toBe(true); // Thursday, DB year says no holiday
        expect(calendar.isBusinessDay("2026-10-05")).toBe(true);
        expect(() => calendar.assertSupportedYear(2026)).not.toThrow();
    });

    it("uses the built-in list for a built-in year without a snapshot", async () => {
        const { service } = makeService({ snapshots: [SNAPSHOT_2026] });

        const calendar = await service.forBranch(BRANCH_A);

        expect(calendar.isBusinessDay(FIRST_BUILTIN_2027)).toBe(false);
        expect(() => calendar.assertSupportedYear(2027)).not.toThrow();
    });

    it("applies the branch's add and exclude overrides", async () => {
        const { service } = makeService({
            overrides: {
                [BRANCH_A]: [
                    override({ date: "2027-03-02", kind: "add", name: "임시 휴무" }),
                    override({ date: FIRST_BUILTIN_2027, kind: "exclude" }),
                ],
            },
        });

        const calendar = await service.forBranch(BRANCH_A);
        const other = await service.forBranch(BRANCH_B);

        expect(calendar.isBusinessDay("2027-03-02")).toBe(false);
        expect(calendar.isBusinessDay(FIRST_BUILTIN_2027)).toBe(true);
        expect(other.isBusinessDay("2027-03-02")).toBe(true);
        expect(other.isBusinessDay(FIRST_BUILTIN_2027)).toBe(false);
    });

    it("never lets a branch add make an unsupported year supported", async () => {
        const { service } = makeService({
            overrides: { [BRANCH_A]: [override({ date: "2090-05-01", kind: "add", name: "x" })] },
        });

        const calendar = await service.forBranch(BRANCH_A);

        expect(() => calendar.assertSupportedYear(2090)).toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => calendar.isBusinessDay("2090-05-04")).toThrow(UnsupportedKoreanHolidayYearError);
    });

    it("versions the calendar by a content fingerprint, not by revision or branch", async () => {
        const { service } = makeService({ revision: 7 });

        const a = await service.forBranch(BRANCH_A);
        const b = await service.forBranch(BRANCH_B);

        expect(a.version).toMatch(/^kr-db-[0-9a-f]{12}$/);
        expect(b.version).toBe(a.version);
    });

    it("changes the version only when this branch's effective calendar changes", async () => {
        const { service, state } = makeService({
            overrides: { [BRANCH_A]: [override({ date: "2027-04-07", kind: "add", name: "지점 휴무" })] },
        });
        const before = await service.forBranch(BRANCH_A);
        const otherBefore = await service.forBranch(BRANCH_B);

        // Another branch edits its calendar: the global revision moves, this branch's content does not.
        state.overrides[BRANCH_B] = [override({ branchId: BRANCH_B, date: "2027-04-08", kind: "add", name: "다른 지점" })];
        state.revision += 1;
        service.invalidateRevisionCache();
        const afterOtherEdit = await service.forBranch(BRANCH_A);
        const otherAfter = await service.forBranch(BRANCH_B);

        expect(afterOtherEdit.version).toBe(before.version);
        expect(otherAfter.version).not.toBe(otherBefore.version);

        // This branch edits its own calendar.
        state.overrides[BRANCH_A] = [];
        state.revision += 1;
        service.invalidateRevisionCache();
        const afterOwnEdit = await service.forBranch(BRANCH_A);

        expect(afterOwnEdit.version).not.toBe(before.version);
    });

    it("keeps the version when a revision bump leaves the effective calendar identical", async () => {
        const { service, state } = makeService();
        const first = await service.forBranch(BRANCH_A);

        state.revision = 2;
        service.invalidateRevisionCache();
        const second = await service.forBranch(BRANCH_A);

        expect(second).not.toBe(first);
        expect(second.version).toBe(first.version);
    });

    it("changes the version when a synced year changes the supported years or dates", async () => {
        const builtin = await makeService().service.forBranch(BRANCH_A);
        const synced = await makeService({
            snapshots: [{ year: 2031, validatedAt: new Date() }],
        }).service.forBranch(BRANCH_A);

        expect(synced.version).not.toBe(builtin.version);
    });

    it("passes supportedYears explicitly: a synced year with no holiday rows is still supported", async () => {
        const { service } = makeService({ snapshots: [{ year: 2031, validatedAt: new Date() }] });

        const calendar = await service.forBranch(BRANCH_A);

        expect(() => calendar.assertSupportedYear(2031)).not.toThrow();
        expect(calendar.isBusinessDay("2031-05-05")).toBe(true); // Monday, no rows for the synced year
        expect(() => calendar.assertSupportedYear(2032)).toThrow(UnsupportedKoreanHolidayYearError);
    });
});

describe("HolidayCalendarService caching", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("reuses the calendar for the same branch and revision", async () => {
        const { service, repository } = makeService();

        const first = await service.forBranch(BRANCH_A);
        const second = await service.forBranch(BRANCH_A);

        expect(second).toBe(first);
        expect(repository.readCalendar).toHaveBeenCalledTimes(1);
        expect(repository.readRevision).toHaveBeenCalledTimes(1);
    });

    it("keeps separate calendars per branch", async () => {
        const { service, repository } = makeService();

        const a = await service.forBranch(BRANCH_A);
        const b = await service.forBranch(BRANCH_B);

        expect(a).not.toBe(b);
        expect(repository.readCalendar).toHaveBeenCalledTimes(2);
        expect(repository.readCalendar).toHaveBeenCalledWith(BRANCH_A);
        expect(repository.readCalendar).toHaveBeenCalledWith(BRANCH_B);
    });

    it("keeps the cached revision for 30s, then rebuilds once the revision changed", async () => {
        let now = 1_000_000;
        jest.spyOn(Date, "now").mockImplementation(() => now);
        const { service, repository, state } = makeService();

        const first = await service.forBranch(BRANCH_A);
        state.revision = 2;
        now += HOLIDAY_REVISION_CACHE_TTL_MS - 1;
        expect(await service.forBranch(BRANCH_A)).toBe(first);
        expect(repository.readRevision).toHaveBeenCalledTimes(1);

        now += 1;
        const rebuilt = await service.forBranch(BRANCH_A);

        expect(repository.readRevision).toHaveBeenCalledTimes(2);
        expect(rebuilt).not.toBe(first);
        expect(rebuilt.version).toBe(first.version);
    });

    it("rebuilds with the same revision untouched when the TTL passes without a change", async () => {
        let now = 1_000_000;
        jest.spyOn(Date, "now").mockImplementation(() => now);
        const { service, repository } = makeService();

        const first = await service.forBranch(BRANCH_A);
        now += HOLIDAY_REVISION_CACHE_TTL_MS + 1;

        expect(await service.forBranch(BRANCH_A)).toBe(first);
        expect(repository.readRevision).toHaveBeenCalledTimes(2);
        expect(repository.readCalendar).toHaveBeenCalledTimes(1);
    });

    it("fresh bypasses the 30s revision cache", async () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000);
        const { service, repository, state } = makeService({
            overrides: { [BRANCH_A]: [] },
        });

        const first = await service.forBranch(BRANCH_A);
        state.revision = 2;
        state.overrides[BRANCH_A] = [override({ date: "2027-03-02", kind: "add", name: "임시" })];

        expect(await service.forBranch(BRANCH_A)).toBe(first);
        const fresh = await service.forBranch(BRANCH_A, { fresh: true });

        expect(repository.readRevision).toHaveBeenCalledTimes(2);
        expect(fresh).not.toBe(first);
        expect(fresh.isBusinessDay("2027-03-02")).toBe(false);
    });

    it("invalidateRevisionCache makes the next read hit the repository", async () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000);
        const { service, repository, state } = makeService();

        await service.forBranch(BRANCH_A);
        state.revision = 5;
        service.invalidateRevisionCache();
        const calendar = await service.forBranch(BRANCH_A);

        expect(repository.readRevision).toHaveBeenCalledTimes(2);
        expect(calendar.version).toMatch(/^kr-db-[0-9a-f]{12}$/);
    });

    it("a revision read that straddles invalidateRevisionCache() does not repopulate the cache", async () => {
        const { service, repository } = makeService();
        let release!: (value: number) => void;
        repository.readRevision.mockImplementationOnce(
            () => new Promise<number>((resolve) => { release = resolve; }),
        );

        const inFlight = service.forBranch(BRANCH_A);
        service.invalidateRevisionCache(); // an override committed while the read was in flight
        release(1); // the read returns the pre-write revision
        await inFlight;

        repository.readRevision.mockClear();
        await service.forBranch(BRANCH_A);

        // The stale value was not cached, so the next call asks the repository again.
        expect(repository.readRevision).toHaveBeenCalledTimes(1);
    });

    it("does not cache a failed build", async () => {
        const { service, repository } = makeService();
        repository.readCalendar.mockRejectedValueOnce(new Error("db down"));

        await expect(service.forBranch(BRANCH_A)).rejects.toThrow("db down");
        const calendar = await service.forBranch(BRANCH_A);

        expect(calendar.version).toMatch(/^kr-db-[0-9a-f]{12}$/);
    });
});

describe("HolidayCalendarService.getEffectiveYear", () => {
    it("lists a synced year from DB rows with source public, sorted, and exposes lastSyncedAt", async () => {
        const { service } = makeService({
            revision: 4,
            snapshots: [SNAPSHOT_2026],
            holidays: [
                { date: "2026-10-09", name: "한글날" },
                { date: "2026-10-03", name: "개천절" },
                { date: "2027-01-01", name: "stale row of a year without snapshot" },
            ],
        });

        const result = await service.getEffectiveYear(BRANCH_A, 2026);

        expect(result).toEqual({
            year: 2026,
            revision: 4,
            supported: true,
            synced: true,
            lastSyncedAt: "2026-10-01T04:00:00.000Z",
            holidays: [
                { date: "2026-10-03", name: "개천절", source: "public", excluded: false, overrideId: null },
                { date: "2026-10-09", name: "한글날", source: "public", excluded: false, overrideId: null },
            ],
            inactiveOverrides: [],
        });
    });

    it("lists a built-in year as builtin, not synced", async () => {
        const { service } = makeService();

        const result = await service.getEffectiveYear(BRANCH_A, 2027);

        expect(result.supported).toBe(true);
        expect(result.synced).toBe(false);
        expect(result.lastSyncedAt).toBeNull();
        expect(result.holidays.map((h) => h.date)).toEqual([...KOREAN_HOLIDAY_CALENDAR[2027]!].sort());
        expect(result.holidays.every((h) => h.source === "builtin" && h.name === BUILTIN_PUBLIC_HOLIDAY_NAME)).toBe(true);
    });

    it("returns supported:false with no holidays for an unsupported year", async () => {
        const { service } = makeService({ revision: 9 });

        await expect(service.getEffectiveYear(BRANCH_A, 2090)).resolves.toEqual({
            year: 2090,
            revision: 9,
            supported: false,
            synced: false,
            lastSyncedAt: null,
            holidays: [],
            inactiveOverrides: [],
        });
    });

    it("keeps an excluded public date with excluded:true and its override id, and adds branch holidays", async () => {
        const { service } = makeService({
            snapshots: [SNAPSHOT_2026],
            holidays: [{ date: "2026-10-03", name: "개천절" }],
            overrides: {
                [BRANCH_A]: [
                    override({ id: "ex-1", date: "2026-10-03", kind: "exclude", name: "개천절" }),
                    override({ id: "add-1", date: "2026-12-24", kind: "add", name: "임시 휴무" }),
                ],
            },
        });

        const result = await service.getEffectiveYear(BRANCH_A, 2026);

        expect(result.holidays).toEqual([
            { date: "2026-10-03", name: "개천절", source: "public", excluded: true, overrideId: "ex-1" },
            { date: "2026-12-24", name: "임시 휴무", source: "branch_add", excluded: false, overrideId: "add-1" },
        ]);
    });

    it("hides an exclude whose date is no longer public and an add the public data now covers, listing both as inactive (sorted by date)", async () => {
        const { service } = makeService({
            snapshots: [SNAPSHOT_2026],
            holidays: [{ date: "2026-10-09", name: "한글날" }],
            overrides: {
                [BRANCH_A]: [
                    override({ id: "add-dup", date: "2026-10-09", kind: "add", name: "dup" }),
                    override({ id: "ex-gone", date: "2026-10-03", kind: "exclude", name: "개천절" }),
                    override({ id: "other-year", date: "2027-03-02", kind: "exclude", name: "다른 해" }),
                ],
            },
        });

        const result = await service.getEffectiveYear(BRANCH_A, 2026);

        expect(result.holidays).toEqual([
            { date: "2026-10-09", name: "한글날", source: "public", excluded: false, overrideId: null },
        ]);
        expect(result.inactiveOverrides).toEqual([
            { id: "ex-gone", date: "2026-10-03", kind: "exclude", name: "개천절" },
            { id: "add-dup", date: "2026-10-09", kind: "add", name: "dup" },
        ]);
    });

    it("does not list effective overrides as inactive", async () => {
        const { service } = makeService({
            snapshots: [SNAPSHOT_2026],
            holidays: [{ date: "2026-10-03", name: "개천절" }],
            overrides: {
                [BRANCH_A]: [
                    override({ id: "ex-1", date: "2026-10-03", kind: "exclude", name: "개천절" }),
                    override({ id: "add-1", date: "2026-12-24", kind: "add", name: "임시 휴무" }),
                ],
            },
        });

        const result = await service.getEffectiveYear(BRANCH_A, 2026);

        expect(result.inactiveOverrides).toEqual([]);
    });

    it("stale-exclude resurrection: a sync drops the excluded date (exclude goes inactive), a later sync re-adds it (exclude applies again, visible as active)", async () => {
        // 2026-10-09 (한글날) is a Friday, so the exclude has a visible effect on business days.
        const exclude = override({ id: "ex-1", date: "2026-10-09", kind: "exclude", name: "한글날" });
        const { service, state } = makeService({
            revision: 1,
            snapshots: [SNAPSHOT_2026],
            holidays: [{ date: "2026-10-03", name: "개천절" }, { date: "2026-10-09", name: "한글날" }],
            overrides: { [BRANCH_A]: [exclude] },
        });

        const active = await service.getEffectiveYear(BRANCH_A, 2026, { fresh: true });
        expect(active.holidays).toContainEqual(
            { date: "2026-10-09", name: "한글날", source: "public", excluded: true, overrideId: "ex-1" },
        );
        expect(active.inactiveOverrides).toEqual([]);
        expect((await service.forBranch(BRANCH_A)).isBusinessDay("2026-10-09")).toBe(true);

        // Sync drops 10-09: the exclude has nothing to exclude and moves to the inactive list.
        state.revision = 2;
        state.holidays = [{ date: "2026-10-03", name: "개천절" }];
        const dropped = await service.getEffectiveYear(BRANCH_A, 2026, { fresh: true });
        expect(dropped.holidays.map((h) => h.date)).toEqual(["2026-10-03"]);
        expect(dropped.inactiveOverrides).toEqual([
            { id: "ex-1", date: "2026-10-09", kind: "exclude", name: "한글날" },
        ]);
        expect((await service.forBranch(BRANCH_A, { fresh: true })).isBusinessDay("2026-10-09")).toBe(true);

        // Sync re-adds 10-09: the standing exclude applies again and is an active, excluded row.
        state.revision = 3;
        state.holidays = [{ date: "2026-10-03", name: "개천절" }, { date: "2026-10-09", name: "한글날" }];
        const resurrected = await service.getEffectiveYear(BRANCH_A, 2026, { fresh: true });
        expect(resurrected.holidays).toContainEqual(
            { date: "2026-10-09", name: "한글날", source: "public", excluded: true, overrideId: "ex-1" },
        );
        expect(resurrected.inactiveOverrides).toEqual([]);
        expect((await service.forBranch(BRANCH_A, { fresh: true })).isBusinessDay("2026-10-09")).toBe(true);
    });

    it("lastSyncedAt follows the latest validation even when the revision (and the cached model) did not change", async () => {
        const { service, state } = makeService({ revision: 1, snapshots: [SNAPSHOT_2026] });

        const first = await service.getEffectiveYear(BRANCH_A, 2026);
        expect(first.lastSyncedAt).toBe("2026-10-01T04:00:00.000Z");

        // A no-change sync refreshes validatedAt without bumping the revision.
        state.snapshots = [{ year: 2026, validatedAt: new Date("2026-10-02T04:00:00.000Z") }];
        const second = await service.getEffectiveYear(BRANCH_A, 2026);

        expect(second.revision).toBe(1);
        expect(second.lastSyncedAt).toBe("2026-10-02T04:00:00.000Z");
    });

    it("labels the model with the revision read together with its data, not the cheap revision lookup", async () => {
        const { service, repository, state } = makeService({ revision: 5, snapshots: [SNAPSHOT_2026] });
        // The revision-only read returns 5, but by the time the transaction ran the calendar was at 6.
        repository.readCalendar.mockImplementationOnce(async () => ({
            revision: 6,
            snapshots: state.snapshots,
            holidays: [],
            overrides: [],
        }));

        const calendar = await service.forBranch(BRANCH_A);
        const year = await service.getEffectiveYear(BRANCH_A, 2026);

        expect(calendar.version).toMatch(/^kr-db-[0-9a-f]{12}$/);
        expect(year.revision).toBe(6);
    });

    it("does not show another branch's overrides and honours fresh", async () => {
        const { service, repository } = makeService({
            snapshots: [SNAPSHOT_2026],
            overrides: { [BRANCH_B]: [override({ branchId: BRANCH_B, date: "2026-12-24", kind: "add", name: "x" })] },
        });

        const result = await service.getEffectiveYear(BRANCH_A, 2026, { fresh: true });

        expect(result.holidays).toEqual([]);
        expect(repository.readCalendar).toHaveBeenCalledWith(BRANCH_A);
        expect(repository.readCalendar).not.toHaveBeenCalledWith(BRANCH_B);
    });
});

describe("HolidayCalendarService.forBranchWithAdjustedDates", () => {
    const publicRows = [{ date: "2026-12-24", name: "임시공휴일" }];

    it("adds and removes dates on top of the branch's effective set without touching the cached calendar", async () => {
        const { service } = makeService({ snapshots: [SNAPSHOT_2026], holidays: publicRows });
        const current = await service.forBranch(BRANCH_A);
        expect(current.isBusinessDay("2026-12-24")).toBe(false);

        const adjusted = await service.forBranchWithAdjustedDates(BRANCH_A, {
            add: ["2026-11-10"],
            remove: ["2026-12-24"],
        });

        expect(adjusted.isBusinessDay("2026-11-10")).toBe(false);
        expect(adjusted.isBusinessDay("2026-12-24")).toBe(true);
        expect(adjusted.version).not.toBe(current.version);
        // The cached branch calendar is unchanged.
        const again = await service.forBranch(BRANCH_A);
        expect(again).toBe(current);
        expect(again.isBusinessDay("2026-11-10")).toBe(true);
    });

    it("starts from the branch's own overrides", async () => {
        const { service } = makeService({
            snapshots: [SNAPSHOT_2026],
            overrides: { [BRANCH_A]: [override({ date: "2026-11-10", kind: "add", name: "창립기념일" })] },
        });

        const adjusted = await service.forBranchWithAdjustedDates(BRANCH_A, { add: [], remove: ["2026-11-10"] });
        const unchanged = await service.forBranchWithAdjustedDates(BRANCH_A, { add: [], remove: [] });

        expect(adjusted.isBusinessDay("2026-11-10")).toBe(true);
        expect(unchanged.isBusinessDay("2026-11-10")).toBe(false);
        // No adjustment reproduces the current calendar, version included.
        expect(unchanged.version).toBe((await service.forBranch(BRANCH_A)).version);
    });

    it("keeps the same supported years: an added date never makes an unsupported year supported", async () => {
        const { service } = makeService({ snapshots: [SNAPSHOT_2026] });

        const adjusted = await service.forBranchWithAdjustedDates(BRANCH_A, { add: ["2031-05-06"], remove: [] });

        expect(() => adjusted.assertSupportedYear(2031)).toThrow(UnsupportedKoreanHolidayYearError);
        expect(() => adjusted.assertSupportedYear(2026)).not.toThrow();
    });

    it("honours fresh by re-reading the revision", async () => {
        const { service, repository } = makeService({ snapshots: [SNAPSHOT_2026] });
        await service.forBranch(BRANCH_A);
        repository.readRevision.mockClear();

        await service.forBranchWithAdjustedDates(BRANCH_A, { add: [], remove: [] });
        expect(repository.readRevision).not.toHaveBeenCalled();

        await service.forBranchWithAdjustedDates(BRANCH_A, { add: [], remove: [] }, { fresh: true });
        expect(repository.readRevision).toHaveBeenCalledTimes(1);
    });
});
