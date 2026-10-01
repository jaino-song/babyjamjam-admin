import { Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { HolidayReviewResolveService } from "application/services/holiday-review-resolve.service";
import { tenantIsolationExtension } from "infrastructure/database/tenant-isolation.extension";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbHolidayReviewRepository } from "infrastructure/database/repositories/sb.holiday-review.repository";
import { TenantIsolationViolationError } from "infrastructure/tenant/tenant-isolation.reporter";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { pinToday, unpinToday } from "../utils/pin-today";

/**
 * Real-PostgreSQL checks for the review endpoints' repository methods, run through the
 * tenant-isolation extension in `enforce` mode inside an HTTP-origin tenant store, so a
 * query that forgot to pin `branchId` fails here instead of in production. Skipped unless
 * HOLIDAY_REVIEW_REAL_DB=1, and then only against a local throwaway database:
 *
 *   createdb throwaway_hrv && export DATABASE_URL=postgresql://<user>@localhost/throwaway_hrv DIRECT_URL=$DATABASE_URL
 *   npx prisma migrate deploy && HOLIDAY_REVIEW_REAL_DB=1 npx jest test/prisma/holiday-review-http.real-db.spec.ts
 */
const ENABLED = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1";
const describeReal = ENABLED ? describe : describe.skip;

// Same guard as holiday-review.real-db.spec.ts (a spec cannot be imported without running it).
const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/;
function assertThrowawayTarget(): void {
    const url = process.env["DATABASE_URL"];
    if (!url || url !== process.env["DIRECT_URL"] || !THROWAWAY_URL.test(url)) {
        throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL must be the same local throwaway database");
    }
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const USER = "99999999-9999-4999-8999-999999999999";

describeReal("holiday review HTTP-path repository (real PostgreSQL, tenant enforce)", () => {
    let raw: PrismaClient;
    let repository: SbHolidayReviewRepository;
    let branchA: string;
    let branchB: string;
    const eventIds: string[] = [];
    const clientIds: number[] = [];
    const previousMode = process.env["TENANT_ISOLATION_MODE"];

    /** Runs `fn` the way an authenticated request of `branchId` would. */
    const asBranch = <T>(branchId: string, fn: () => Promise<T>): Promise<T> =>
        tenantContextStore.run({ origin: "http", branchId }, fn);

    beforeAll(async () => {
        assertThrowawayTarget();
        process.env["TENANT_ISOLATION_MODE"] = "enforce";
        for (const level of ["log", "warn", "debug", "error"] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
        }
        raw = new PrismaClient();
        await raw.$connect();
        const suffix = Date.now().toString(36);
        branchA = (await raw.branch.create({ data: { name: "A", slug: `throwaway-hrh-a-${suffix}` } })).id;
        branchB = (await raw.branch.create({ data: { name: "B", slug: `throwaway-hrh-b-${suffix}` } })).id;
        const extended = new PrismaClient().$extends(tenantIsolationExtension());
        repository = new SbHolidayReviewRepository(extended as unknown as PrismaService);
        // The fixtures are dated around Nov 2026 and the repository compares stored end dates with
        // "today" (Asia/Seoul): pin Date so the specs do not rot as the calendar moves on.
        pinToday("2026-10-01T03:00:00.000Z");
    });

    afterAll(async () => {
        await raw.end_date_review_item.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
        await raw.holiday_change_event.deleteMany({ where: { id: { in: eventIds } } });
        await raw.service_record_day.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
        await raw.service_record_case.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
        await raw.client.deleteMany({ where: { id: { in: clientIds } } });
        await raw.branch.deleteMany({ where: { id: { in: [branchA, branchB] } } });
        await raw.$disconnect();
        if (previousMode === undefined) delete process.env["TENANT_ISOLATION_MODE"];
        else process.env["TENANT_ISOLATION_MODE"] = previousMode;
        unpinToday();
        jest.restoreAllMocks();
    });

    beforeEach(async () => {
        await raw.end_date_review_item.deleteMany({ where: { branchId: { in: [branchA, branchB] } } });
    });

    async function makeEvent(
        date: string,
        change: "added" | "removed",
        opts: { branchId?: string | null; createdAt?: Date } = {},
    ): Promise<string> {
        const row = await raw.holiday_change_event.create({
            data: {
                branchId: opts.branchId ?? null,
                date: d(date),
                change,
                name: "임시공휴일",
                source: opts.branchId ? "branch-override" : "kasi",
                createdAt: opts.createdAt ?? new Date(),
                processedAt: new Date(),
            },
        });
        eventIds.push(row.id);
        return row.id;
    }

    async function makeClient(
        branchId: string,
        name: string,
        partial: { start?: string; end?: string; status?: string | null } = {},
    ): Promise<number> {
        const row = await raw.client.create({
            data: {
                name,
                voucherClient: false,
                branchId,
                startDate: d(partial.start ?? "2026-11-02"),
                endDate: d(partial.end ?? "2026-11-13"),
                duration: 10,
                serviceStatus: partial.status === undefined ? "active" : partial.status,
            },
        });
        clientIds.push(row.id);
        return row.id;
    }

    async function makeItem(
        eventId: string,
        branchId: string,
        clientId: number,
        opts: { category?: "safe" | "risk"; status?: string; reason?: string; storedEnd?: string } = {},
    ) {
        return raw.end_date_review_item.create({
            data: {
                changeEventId: eventId,
                branchId,
                clientId,
                storedEnd: d(opts.storedEnd ?? "2026-11-13"),
                recalculatedEnd: d("2026-11-16"),
                affectedFrom: d("2026-11-10"),
                category: opts.category ?? "safe",
                reason: opts.reason ?? (opts.category === "risk" ? "finalized" : "no_sessions_after_date"),
                status: opts.status ?? "open",
            },
        });
    }

    it("is actually enforcing: an unpinned aggregate fails", async () => {
        const extended = (repository as unknown as { prisma: PrismaClient }).prisma;
        await expect(
            // Awaited inside the callback: a Prisma query is lazy and would otherwise run outside the store.
            asBranch(branchA, async () =>
                await extended.end_date_review_item.groupBy({
                    by: ["changeEventId"],
                    where: { status: "open" },
                    _count: { _all: true },
                }),
            ),
        ).rejects.toBeInstanceOf(TenantIsolationViolationError);
    });

    describe("listOpenEventSummaries", () => {
        it("counts this branch's open items per event, newest event first, including public events", async () => {
            const publicEvent = await makeEvent("2026-11-10", "added", { createdAt: new Date("2026-11-01T00:00:00Z") });
            const ownEvent = await makeEvent("2026-11-11", "added", {
                branchId: branchA,
                createdAt: new Date("2026-11-02T00:00:00Z"),
            });
            const otherBranchEvent = await makeEvent("2026-11-12", "added", { branchId: branchB });
            const allClosed = await makeEvent("2026-11-13", "removed");
            const [c1, c2, c3, c4, cb] = [
                await makeClient(branchA, "가"),
                await makeClient(branchA, "나"),
                await makeClient(branchA, "다"),
                await makeClient(branchA, "라"),
                await makeClient(branchB, "마"),
            ];
            await makeItem(publicEvent, branchA, c1);
            await makeItem(publicEvent, branchA, c2, { category: "risk" });
            await makeItem(publicEvent, branchA, c3, { status: "kept" });
            await makeItem(ownEvent, branchA, c4);
            await makeItem(allClosed, branchA, c1, { status: "fixed" });
            // Branch B's items must not leak into A's counts or list.
            await makeItem(publicEvent, branchB, cb);
            await makeItem(otherBranchEvent, branchB, cb, { status: "kept" });

            const a = await asBranch(branchA, () => repository.listOpenEventSummaries(branchA));
            const b = await asBranch(branchB, () => repository.listOpenEventSummaries(branchB));

            expect(a.map((e) => e.id)).toEqual([ownEvent, publicEvent]);
            expect(a[0]).toMatchObject({ date: "2026-11-11", change: "added", source: "branch-override", safeOpen: 1, riskOpen: 0 });
            expect(a[1]).toMatchObject({ date: "2026-11-10", branchId: null, source: "kasi", safeOpen: 1, riskOpen: 1 });
            expect(a[1]?.createdAt).toEqual(new Date("2026-11-01T00:00:00Z"));
            expect(b.map((e) => e.id)).toEqual([publicEvent]);
            expect(b[0]).toMatchObject({ safeOpen: 1, riskOpen: 0 });
        });

        it("is empty when the branch has no open items", async () => {
            await expect(asBranch(branchA, () => repository.listOpenEventSummaries(branchA))).resolves.toEqual([]);
        });
    });

    describe("event and item reads", () => {
        it("branchHasEventItems answers per branch and any status; findEventRecord never reveals another branch's event", async () => {
            const publicEvent = await makeEvent("2026-11-10", "added");
            const bEvent = await makeEvent("2026-11-12", "added", { branchId: branchB });
            const c = await makeClient(branchA, "가");
            await makeItem(publicEvent, branchA, c, { status: "obsolete" });

            expect(await asBranch(branchA, () => repository.branchHasEventItems(branchA, publicEvent))).toBe(true);
            expect(await asBranch(branchB, () => repository.branchHasEventItems(branchB, publicEvent))).toBe(false);
            expect(await asBranch(branchA, () => repository.branchHasEventItems(branchA, bEvent))).toBe(false);

            expect(await asBranch(branchA, () => repository.findEventRecord(branchA, publicEvent))).toMatchObject({
                id: publicEvent,
                branchId: null,
                date: "2026-11-10",
            });
            expect(await asBranch(branchA, () => repository.findEventRecord(branchA, bEvent))).toBeNull();
            expect(await asBranch(branchB, () => repository.findEventRecord(branchB, bEvent))).toMatchObject({ id: bEvent });
        });

        it("lists items filtered by category, status and name, sorted by client name then id", async () => {
            const event = await makeEvent("2026-11-10", "added");
            const cB = await makeClient(branchA, "Bora Kim");
            const cA = await makeClient(branchA, "alice Park");
            const cC = await makeClient(branchA, "Chul Kim");
            const cOther = await makeClient(branchB, "Bora Kim");
            await makeItem(event, branchA, cB);
            await makeItem(event, branchA, cA, { category: "risk" });
            await makeItem(event, branchA, cC, { status: "kept" });
            await makeItem(event, branchB, cOther);

            const list = (filters: Parameters<SbHolidayReviewRepository["listEventItems"]>[2]) =>
                asBranch(branchA, () => repository.listEventItems(branchA, event, filters));

            expect((await list({ status: "open" })).map((i) => i.clientName)).toEqual(["alice Park", "Bora Kim"]);
            expect((await list({ status: "open", category: "risk" })).map((i) => i.clientName)).toEqual(["alice Park"]);
            expect((await list({ status: "kept" })).map((i) => i.clientId)).toEqual([cC]);
            expect((await list({ q: "KIM" })).map((i) => i.clientName).sort()).toEqual(["Bora Kim", "Chul Kim"]);
            expect(await list({ status: "fixed" })).toEqual([]);
            expect((await list({ status: "open" }))[0]).toMatchObject({
                storedEnd: "2026-11-13",
                recalculatedEnd: "2026-11-16",
                category: "risk",
                reason: "finalized",
                status: "open",
            });
        });

        it("findEventItemsByIds only returns this branch's items of this event", async () => {
            const event = await makeEvent("2026-11-10", "added");
            const otherEvent = await makeEvent("2026-11-11", "added");
            const own = await makeItem(event, branchA, await makeClient(branchA, "가"));
            const sameEventOtherBranch = await makeItem(event, branchB, await makeClient(branchB, "나"));
            const otherEventOwn = await makeItem(otherEvent, branchA, await makeClient(branchA, "다"));

            const found = await asBranch(branchA, () =>
                repository.findEventItemsByIds(branchA, event, [own.id, sameEventOtherBranch.id, otherEventOwn.id]),
            );

            expect(found.map((i) => i.id)).toEqual([own.id]);
            await expect(asBranch(branchA, () => repository.findEventItemsByIds(branchA, event, []))).resolves.toEqual([]);
        });
    });

    describe("writes", () => {
        it("closeOpenItem moves an open item once, as the user, and never touches another branch's item", async () => {
            const event = await makeEvent("2026-11-10", "added");
            const own = await makeItem(event, branchA, await makeClient(branchA, "가"));
            const foreign = await makeItem(event, branchB, await makeClient(branchB, "나"));

            const first = await asBranch(branchA, () =>
                repository.closeOpenItem(branchA, event, own.id, { status: "kept", resolvedBy: USER }),
            );
            const second = await asBranch(branchA, () =>
                repository.closeOpenItem(branchA, event, own.id, { status: "fixed", resolvedBy: USER }),
            );
            const crossBranch = await asBranch(branchA, () =>
                repository.closeOpenItem(branchA, event, foreign.id, { status: "kept", resolvedBy: USER }),
            );
            const wrongEvent = await asBranch(branchA, () =>
                repository.closeOpenItem(branchA, "00000000-0000-4000-8000-0000000000ff", own.id, {
                    status: "kept",
                    resolvedBy: USER,
                }),
            );

            expect([first, second, crossBranch, wrongEvent]).toEqual([true, false, false, false]);
            expect(await raw.end_date_review_item.findUnique({ where: { id: own.id } })).toMatchObject({
                status: "kept",
                resolvedBy: USER,
                resolvedAt: expect.any(Date),
            });
            expect(await raw.end_date_review_item.findUnique({ where: { id: foreign.id } })).toMatchObject({
                status: "open",
                resolvedBy: null,
                resolvedAt: null,
            });
        });

        it("closeOpenItem records a system decision without a user", async () => {
            const event = await makeEvent("2026-11-10", "added");
            const item = await makeItem(event, branchA, await makeClient(branchA, "가"));

            await asBranch(branchA, () =>
                repository.closeOpenItem(branchA, event, item.id, { status: "obsolete", resolvedBy: null }),
            );

            expect(await raw.end_date_review_item.findUnique({ where: { id: item.id } })).toMatchObject({
                status: "obsolete",
                resolvedBy: null,
            });
        });

        it("reclassifyOpenItem re-files an open item and leaves a closed one alone", async () => {
            const event = await makeEvent("2026-11-10", "added");
            const open = await makeItem(event, branchA, await makeClient(branchA, "가"));
            const kept = await makeItem(event, branchA, await makeClient(branchA, "나"), { status: "kept" });
            const update = { category: "risk" as const, reason: "finalized" as const, recalculatedEnd: "2026-11-17" };

            expect(await asBranch(branchA, () => repository.reclassifyOpenItem(branchA, event, open.id, update))).toBe(true);
            expect(await asBranch(branchA, () => repository.reclassifyOpenItem(branchA, event, kept.id, update))).toBe(false);
            expect(await asBranch(branchB, () => repository.reclassifyOpenItem(branchB, event, open.id, update))).toBe(false);

            expect(await raw.end_date_review_item.findUnique({ where: { id: open.id } })).toMatchObject({
                status: "open",
                category: "risk",
                reason: "finalized",
                recalculatedEnd: d("2026-11-17"),
            });
            expect(await raw.end_date_review_item.findUnique({ where: { id: kept.id } })).toMatchObject({
                category: "safe",
                recalculatedEnd: d("2026-11-16"),
            });
        });
    });

    describe("findFixSnapshot", () => {
        it("returns dates, duration, termination and the case facts; other branches' clients are invisible", async () => {
            const live = await makeClient(branchA, "가");
            const terminated = await makeClient(branchA, "나", { status: "terminated" });
            const other = await makeClient(branchB, "다");
            const record = await raw.service_record_case.create({
                data: { branchId: branchA, clientId: live, status: "COMPLETED" },
            });
            await raw.service_record_day.create({
                data: {
                    branchId: branchA,
                    serviceRecordCaseId: record.id,
                    sessionIndex: 1,
                    caseSessionIndex: 1,
                    serviceDate: d("2026-11-03"),
                    locked: true,
                },
            });

            const snapshot = await asBranch(branchA, () => repository.findFixSnapshot(branchA, live));

            expect(snapshot).toEqual({
                startDate: "2026-11-02",
                endDate: "2026-11-13",
                duration: 10,
                terminated: false,
                finished: false,
                facts: { caseStatus: "COMPLETED", days: [{ date: "2026-11-03", locked: true }] },
            });
            expect((await asBranch(branchA, () => repository.findFixSnapshot(branchA, terminated)))?.terminated).toBe(true);
            expect(await asBranch(branchA, () => repository.findFixSnapshot(branchA, other))).toBeNull();
            expect(await asBranch(branchA, () => repository.findFixSnapshot(branchA, 2_000_000_000))).toBeNull();
        });
    });

    describe("resolve end to end (real repository, ClientService stood in by a raw end-date write)", () => {
        it("fixes the safe item, keeps another, and leaves a changed client's item obsolete", async () => {
            const event = await makeEvent("2026-11-10", "added");
            const fixable = await makeClient(branchA, "가");
            const keepable = await makeClient(branchA, "나");
            const moved = await makeClient(branchA, "다", { end: "2026-11-20" }); // saved by someone since the item was filed
            const itemFix = await makeItem(event, branchA, fixable);
            const itemKeep = await makeItem(event, branchA, keepable);
            const itemMoved = await makeItem(event, branchA, moved);
            const itemRisk = await makeItem(event, branchA, await makeClient(branchA, "라"), { category: "risk" });

            const calendar = { calcEndDateBusinessDays: () => "2026-11-16" };
            const clientService = {
                update: jest.fn(async (_branch: string, clientId: number, params: { endDate: string }) => {
                    await raw.client.update({ where: { id: clientId }, data: { endDate: d(params.endDate) } });
                }),
            };
            const service = new HolidayReviewResolveService(
                repository,
                { forBranch: async () => calendar } as never,
                clientService as never,
            );

            const fixed = await asBranch(branchA, () =>
                service.resolve(branchA, event, USER, {
                    action: "fix",
                    itemIds: [itemFix.id, itemMoved.id, itemRisk.id],
                }),
            );
            const kept = await asBranch(branchA, () =>
                service.resolve(branchA, event, USER, { action: "keep", itemIds: [itemKeep.id] }),
            );
            const again = await asBranch(branchA, () =>
                service.resolve(branchA, event, USER, { action: "fix", itemIds: [itemFix.id] }),
            );

            expect(fixed).toEqual({
                fixed: 1,
                kept: 0,
                skipped: [
                    { itemId: itemMoved.id, code: "CLIENT_CHANGED" },
                    { itemId: itemRisk.id, code: "ITEM_RISK" },
                ],
            });
            expect(kept).toEqual({ fixed: 0, kept: 1, skipped: [] });
            expect(again.skipped).toEqual([{ itemId: itemFix.id, code: "ITEM_NOT_OPEN" }]);
            expect(clientService.update).toHaveBeenCalledTimes(1);
            expect(clientService.update).toHaveBeenCalledWith(branchA, fixable, {
                endDate: "2026-11-16",
                expectedEndDate: "2026-11-13",
            });
            const status = async (id: string) => (await raw.end_date_review_item.findUniqueOrThrow({ where: { id } }));
            expect(await status(itemFix.id)).toMatchObject({ status: "fixed", resolvedBy: USER });
            expect(await status(itemKeep.id)).toMatchObject({ status: "kept", resolvedBy: USER });
            expect(await status(itemMoved.id)).toMatchObject({ status: "obsolete", resolvedBy: null });
            expect(await status(itemRisk.id)).toMatchObject({ status: "open" });
        });

        it("F2: an item filed for a client whose period is over is closed obsolete as CLIENT_FINISHED, never fixed", async () => {
            const event = await makeEvent("2026-05-01", "removed");
            // Today is pinned to 2026-10-01: this client's stored end (05-12) is long past.
            const finished = await makeClient(branchA, "가", { start: "2026-04-27", end: "2026-05-12" });
            const item = await makeItem(event, branchA, finished, { storedEnd: "2026-05-12" });
            const clientService = { update: jest.fn() };
            const service = new HolidayReviewResolveService(
                repository,
                { forBranch: async () => ({ calcEndDateBusinessDays: () => "2026-05-11" }) } as never,
                clientService as never,
            );

            const result = await asBranch(branchA, () =>
                service.resolve(branchA, event, USER, { action: "fix", itemIds: [item.id] }),
            );

            expect(result).toEqual({ fixed: 0, kept: 0, skipped: [{ itemId: item.id, code: "CLIENT_FINISHED" }] });
            expect(clientService.update).not.toHaveBeenCalled();
            expect(await raw.end_date_review_item.findUniqueOrThrow({ where: { id: item.id } }))
                .toMatchObject({ status: "obsolete", resolvedBy: null });
            expect((await raw.client.findUniqueOrThrow({ where: { id: finished } })).endDate).toEqual(d("2026-05-12"));
        });
    });
});
