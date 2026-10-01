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
        readPublicCalendar: jest.fn(async () => ({ snapshots: state.snapshots, holidays: state.holidays })),
        readBranchOverrides: jest.fn(async (branchId: string) => state.overrides[branchId] ?? []),
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

    it("versions the calendar by revision and branch prefix", async () => {
        const { service } = makeService({ revision: 7 });

        const calendar = await service.forBranch(BRANCH_A);

        expect(calendar.version).toBe("kr-db-r7-baaaaaaaa");
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
        expect(repository.readBranchOverrides).toHaveBeenCalledTimes(1);
        expect(repository.readRevision).toHaveBeenCalledTimes(1);
    });

    it("keeps separate calendars per branch", async () => {
        const { service, repository } = makeService();

        const a = await service.forBranch(BRANCH_A);
        const b = await service.forBranch(BRANCH_B);

        expect(a).not.toBe(b);
        expect(repository.readBranchOverrides).toHaveBeenCalledTimes(2);
        expect(repository.readBranchOverrides).toHaveBeenCalledWith(BRANCH_A);
        expect(repository.readBranchOverrides).toHaveBeenCalledWith(BRANCH_B);
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
        expect(rebuilt.version).toContain("-r2-");
    });

    it("rebuilds with the same revision untouched when the TTL passes without a change", async () => {
        let now = 1_000_000;
        jest.spyOn(Date, "now").mockImplementation(() => now);
        const { service, repository } = makeService();

        const first = await service.forBranch(BRANCH_A);
        now += HOLIDAY_REVISION_CACHE_TTL_MS + 1;

        expect(await service.forBranch(BRANCH_A)).toBe(first);
        expect(repository.readRevision).toHaveBeenCalledTimes(2);
        expect(repository.readBranchOverrides).toHaveBeenCalledTimes(1);
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
        expect(calendar.version).toContain("-r5-");
    });

    it("does not cache a failed build", async () => {
        const { service, repository } = makeService();
        repository.readBranchOverrides.mockRejectedValueOnce(new Error("db down"));

        await expect(service.forBranch(BRANCH_A)).rejects.toThrow("db down");
        const calendar = await service.forBranch(BRANCH_A);

        expect(calendar.version).toBe("kr-db-r1-baaaaaaaa");
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

    it("omits an exclude whose date is no longer public and an add the public data now covers", async () => {
        const { service } = makeService({
            snapshots: [SNAPSHOT_2026],
            holidays: [{ date: "2026-10-09", name: "한글날" }],
            overrides: {
                [BRANCH_A]: [
                    override({ date: "2026-10-03", kind: "exclude", name: "개천절" }),
                    override({ date: "2026-10-09", kind: "add", name: "dup" }),
                ],
            },
        });

        const result = await service.getEffectiveYear(BRANCH_A, 2026);

        expect(result.holidays).toEqual([
            { date: "2026-10-09", name: "한글날", source: "public", excluded: false, overrideId: null },
        ]);
    });

    it("does not show another branch's overrides and honours fresh", async () => {
        const { service, repository } = makeService({
            snapshots: [SNAPSHOT_2026],
            overrides: { [BRANCH_B]: [override({ branchId: BRANCH_B, date: "2026-12-24", kind: "add", name: "x" })] },
        });

        const result = await service.getEffectiveYear(BRANCH_A, 2026, { fresh: true });

        expect(result.holidays).toEqual([]);
        expect(repository.readBranchOverrides).toHaveBeenCalledWith(BRANCH_A);
        expect(repository.readBranchOverrides).not.toHaveBeenCalledWith(BRANCH_B);
    });
});
