import { HttpException, Logger } from "@nestjs/common";
import { KasiHolidayError } from "infrastructure/api/kasi-holiday.client";
import { HolidaySyncService } from "./holiday-sync.service";

const ANCHORS = ["01-01", "03-01", "05-05", "06-06", "08-15", "10-03", "10-09", "12-25"];
const anchorItems = (year: number) => ANCHORS.map((md) => ({ date: `${year}-${md}`, name: `h-${md}` }));

function makeService(overrides: { holdsLease?: boolean } = {}) {
    const client = { fetchYear: jest.fn() };
    const repository = { applyYearSync: jest.fn() };
    const lease = { holdsLease: jest.fn(() => overrides.holdsLease ?? true) };
    const service = new HolidaySyncService(client as never, repository as never, lease as never);
    return { service, client, repository, lease };
}

describe("HolidaySyncService", () => {
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe("syncYears", () => {
        it("validates, merges same-date names and writes through the repository", async () => {
            const { service, client, repository } = makeService();
            client.fetchYear.mockResolvedValue({
                year: 2026,
                items: [
                    ...anchorItems(2026).filter((item) => item.date !== "2026-10-03"),
                    // 개천절 falls inside 추석 in this fixture: two KASI items, one date.
                    { date: "2026-10-03", name: "개천절" },
                    { date: "2026-10-03", name: "추석" },
                    { date: "2026-10-03", name: "개천절" },
                ],
                rawCount: 12,
            });
            repository.applyYearSync.mockResolvedValue({ status: "updated", added: 2, removed: 1 });

            const results = await service.syncYears([2026], "manual");

            expect(results).toEqual([{ year: 2026, status: "updated", added: 2, removed: 1 }]);
            const input = repository.applyYearSync.mock.calls[0]![0];
            expect(input.year).toBe(2026);
            expect(input.rawCount).toBe(12);
            expect(input.items).toHaveLength(ANCHORS.length);
            expect(input.items.find((i: { date: string }) => i.date === "2026-10-03").name).toBe("개천절·추석");
            // sorted by date
            const dates = input.items.map((i: { date: string }) => i.date);
            expect(dates).toEqual([...dates].sort());
        });

        it.each(ANCHORS)("a response missing anchor %s writes nothing and fails", async (anchor) => {
            const { service, client, repository } = makeService();
            client.fetchYear.mockResolvedValue({
                year: 2026,
                items: anchorItems(2026).filter((item) => item.date !== `2026-${anchor}`),
                rawCount: 7,
            });

            const results = await service.syncYears([2026], "cron");

            expect(results).toEqual([{ year: 2026, status: "failed", added: 0, removed: 0, error: "anchors_missing" }]);
            expect(repository.applyYearSync).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(anchor));
        });

        it("all 12 months empty is not_published, logged at log level (not warn), nothing written", async () => {
            const { service, client, repository } = makeService();
            client.fetchYear.mockResolvedValue({ year: 2027, items: [], rawCount: 0 });

            const results = await service.syncYears([2027], "cron");

            expect(results).toEqual([{ year: 2027, status: "failed", added: 0, removed: 0, error: "not_published" }]);
            expect(repository.applyYearSync).not.toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("not published"));
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it("a missing key yields failed/not_configured and never throws", async () => {
            const { service, client, repository } = makeService();
            client.fetchYear.mockRejectedValue(new KasiHolidayError("not_configured"));

            await expect(service.syncYears([2026, 2027], "cron")).resolves.toEqual([
                { year: 2026, status: "failed", added: 0, removed: 0, error: "not_configured" },
                { year: 2027, status: "failed", added: 0, removed: 0, error: "not_configured" },
            ]);
            expect(repository.applyYearSync).not.toHaveBeenCalled();
        });

        it("maps KASI failures to their reason and keeps going with the next year", async () => {
            const { service, client, repository } = makeService();
            client.fetchYear
                .mockRejectedValueOnce(new KasiHolidayError("upstream_invalid", 4))
                .mockResolvedValueOnce({ year: 2027, items: anchorItems(2027), rawCount: 8 });
            repository.applyYearSync.mockResolvedValue({ status: "unchanged", added: 0, removed: 0 });

            const results = await service.syncYears([2026, 2027], "manual");

            expect(results).toEqual([
                { year: 2026, status: "failed", added: 0, removed: 0, error: "upstream_invalid" },
                { year: 2027, status: "unchanged", added: 0, removed: 0 },
            ]);
        });

        it("a repository failure becomes write_failed", async () => {
            const { service, client, repository } = makeService();
            client.fetchYear.mockResolvedValue({ year: 2026, items: anchorItems(2026), rawCount: 8 });
            repository.applyYearSync.mockRejectedValue(new Error("boom"));

            await expect(service.syncYears([2026], "manual")).resolves.toEqual([
                { year: 2026, status: "failed", added: 0, removed: 0, error: "write_failed" },
            ]);
        });

        it("syncs years strictly one after another", async () => {
            const { service, client, repository } = makeService();
            const order: string[] = [];
            client.fetchYear.mockImplementation(async (year: number) => {
                order.push(`fetch-${year}`);
                return { year, items: anchorItems(year), rawCount: 8 };
            });
            repository.applyYearSync.mockImplementation(async ({ year }: { year: number }) => {
                order.push(`write-${year}`);
                return { status: "updated", added: 0, removed: 0 };
            });

            await service.syncYears([2026, 2027], "cron");

            expect(order).toEqual(["fetch-2026", "write-2026", "fetch-2027", "write-2027"]);
        });
    });

    describe("syncScheduled (cron)", () => {
        it("does nothing without the scheduler lease", async () => {
            const { service, client, lease } = makeService({ holdsLease: false });
            await service.syncScheduled();
            expect(lease.holdsLease).toHaveBeenCalled();
            expect(client.fetchYear).not.toHaveBeenCalled();
        });

        it("syncs the current and next KST year (KST rolls the year before UTC does)", async () => {
            jest.useFakeTimers({ now: new Date("2026-12-31T16:00:00.000Z") }); // 2027-01-01 01:00 KST
            const { service, client, repository } = makeService();
            client.fetchYear.mockImplementation(async (year: number) => ({ year, items: anchorItems(year), rawCount: 8 }));
            repository.applyYearSync.mockResolvedValue({ status: "unchanged", added: 0, removed: 0 });

            await service.syncScheduled();

            expect(client.fetchYear.mock.calls.map(([year]) => year)).toEqual([2027, 2028]);
        });

        it("never throws", async () => {
            const { service, client } = makeService();
            client.fetchYear.mockRejectedValue(new Error("unexpected"));
            await expect(service.syncScheduled()).resolves.toBeUndefined();
        });
    });

    describe("syncManually", () => {
        beforeEach(() => {
            jest.useFakeTimers({ now: new Date("2026-10-01T03:00:00.000Z") });
        });

        function ready() {
            const h = makeService();
            h.client.fetchYear.mockImplementation(async (year: number) => ({ year, items: anchorItems(year), rawCount: 8 }));
            h.repository.applyYearSync.mockResolvedValue({ status: "updated", added: 1, removed: 0 });
            return h;
        }

        it("syncs current + next year and returns per-year results", async () => {
            const { service } = ready();
            await expect(service.syncManually()).resolves.toEqual([
                { year: 2026, status: "updated", added: 1, removed: 0 },
                { year: 2027, status: "updated", added: 1, removed: 0 },
            ]);
        });

        it("rejects a second attempt inside 5 minutes with REQUEST_RATE_LIMITED 429, then allows it after the cooldown", async () => {
            const { service, client } = ready();
            await service.syncManually();
            client.fetchYear.mockClear();

            jest.setSystemTime(new Date("2026-10-01T03:04:59.000Z"));
            const error = await service.syncManually().catch((e: unknown) => e);
            expect(error).toBeInstanceOf(HttpException);
            expect((error as HttpException).getStatus()).toBe(429);
            expect((error as HttpException).getResponse()).toMatchObject({ code: "REQUEST_RATE_LIMITED" });
            expect(client.fetchYear).not.toHaveBeenCalled();

            jest.setSystemTime(new Date("2026-10-01T03:05:00.000Z"));
            await expect(service.syncManually()).resolves.toHaveLength(2);
        });

        it("a rejected request does not extend the cooldown", async () => {
            const { service } = ready();
            await service.syncManually(); // 03:00:00
            jest.setSystemTime(new Date("2026-10-01T03:04:00.000Z"));
            await expect(service.syncManually()).rejects.toBeInstanceOf(HttpException); // rejected
            jest.setSystemTime(new Date("2026-10-01T03:05:00.000Z"));
            await expect(service.syncManually()).resolves.toHaveLength(2); // measured from the first attempt
        });

        it("the cooldown starts with the attempt, so an all-failed attempt still counts", async () => {
            const { service, client } = makeService();
            client.fetchYear.mockRejectedValue(new KasiHolidayError("not_configured"));
            await expect(service.syncManually()).resolves.toEqual([
                expect.objectContaining({ status: "failed" }),
                expect.objectContaining({ status: "failed" }),
            ]);
            await expect(service.syncManually()).rejects.toBeInstanceOf(HttpException);
        });
    });
});
