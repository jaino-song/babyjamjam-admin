import { ConflictException, ForbiddenException, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import {
    HolidayChangeEventRecord,
    ReviewFixSnapshot,
    ReviewItemRecord,
} from "domain/repositories/holiday-review.repository.interface";
import { UnsupportedKoreanHolidayYearError } from "domain/utils/business-days";
import { HolidayReviewResolveService } from "./holiday-review-resolve.service";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

const EVENT: HolidayChangeEventRecord = {
    id: EVENT_ID,
    branchId: null,
    date: "2026-11-10",
    change: "added",
    name: "임시공휴일",
    source: "kasi",
    createdAt: new Date("2026-11-01T03:04:05.000Z"),
};

let nextId = 0;
const itemId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

function item(overrides: Partial<ReviewItemRecord> = {}): ReviewItemRecord {
    return {
        id: itemId(),
        clientId: 7,
        clientName: "김아기",
        storedEnd: "2026-11-13",
        recalculatedEnd: "2026-11-16",
        affectedFrom: "2026-11-10",
        category: "safe",
        reason: "no_sessions_after_date",
        status: "open",
        ...overrides,
    };
}

const snapshot = (overrides: Partial<ReviewFixSnapshot> = {}): ReviewFixSnapshot => ({
    startDate: "2026-11-02",
    endDate: "2026-11-13",
    duration: 10,
    terminated: false,
    finished: false,
    facts: { caseStatus: null, days: [] },
    ...overrides,
});

interface World {
    items?: ReviewItemRecord[];
    hasItems?: boolean;
    event?: HolidayChangeEventRecord | null;
    /** Per client id; default is `snapshot()`. */
    snapshots?: Record<number, ReviewFixSnapshot | null>;
    recalculated?: string | ((start: string, duration: number) => string);
}

function makeService(world: World = {}) {
    const items = world.items ?? [];
    const repository = {
        listOpenEventSummaries: jest.fn(async () => []),
        findEventRecord: jest.fn(async () => (world.event === undefined ? EVENT : world.event)),
        branchHasEventItems: jest.fn(async () => world.hasItems ?? true),
        listEventItems: jest.fn(async () => items),
        findEventItemsByIds: jest.fn(async (_b: string, _e: string, ids: string[]) =>
            items.filter((i) => ids.includes(i.id)).map((i) => ({ ...i })),
        ),
        closeOpenItem: jest.fn(async () => true),
        claimOpenItemForFix: jest.fn(async (_b: string, _e: string, expected: ReviewItemRecord) => {
            const current = items.find((i) => i.id === expected.id);
            if (!current || current.status !== "open" || current.recalculatedEnd !== expected.recalculatedEnd
                || current.category !== expected.category) return false;
            current.status = "fixed";
            return true;
        }),
        reclassifyOpenItem: jest.fn(async () => true),
        findFixSnapshot: jest.fn(async (_b: string, clientId: number) =>
            world.snapshots && clientId in world.snapshots ? world.snapshots[clientId] : snapshot(),
        ),
    };
    const calendar = {
        calcEndDateBusinessDays: jest.fn((start: string, duration: number) =>
            typeof world.recalculated === "function"
                ? world.recalculated(start, duration)
                : (world.recalculated ?? "2026-11-16"),
        ),
    };
    const calendarService = { forBranch: jest.fn(async () => calendar) };
    const clientWrite = jest.fn(async () => ({}));
    const clientService = {
        update: jest.fn(async (
            _b: string, _id: number, _params: unknown,
            beforeWrite?: (transaction: Prisma.TransactionClient) => Promise<void>,
        ) => {
            const statuses = items.map((i) => ({ item: i, status: i.status }));
            try {
                await beforeWrite?.({} as Prisma.TransactionClient);
                return await clientWrite();
            } catch (error) {
                statuses.forEach(({ item: current, status }) => { current.status = status; });
                throw error;
            }
        }),
    };
    const service = new HolidayReviewResolveService(
        repository as never,
        calendarService as never,
        clientService as never,
    );
    return { service, repository, calendar, calendarService, clientService, clientWrite };
}

const resolveFix = (s: ReturnType<typeof makeService>, ids: string[]) =>
    s.service.resolve(BRANCH, EVENT_ID, USER, { itemIds: ids, action: "fix" });
const resolveKeep = (s: ReturnType<typeof makeService>, ids: string[]) =>
    s.service.resolve(BRANCH, EVENT_ID, USER, { itemIds: ids, action: "keep" });

describe("HolidayReviewResolveService", () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    describe("listEvents", () => {
        it("maps events to the contract with an ISO createdAt", async () => {
            const s = makeService();
            s.repository.listOpenEventSummaries.mockResolvedValue([{ ...EVENT, safeOpen: 3, riskOpen: 1 }] as never);

            await expect(s.service.listEvents(BRANCH)).resolves.toEqual([
                {
                    id: EVENT_ID,
                    date: "2026-11-10",
                    change: "added",
                    name: "임시공휴일",
                    source: "kasi",
                    safeOpen: 3,
                    riskOpen: 1,
                    createdAt: "2026-11-01T03:04:05.000Z",
                },
            ]);
            expect(s.repository.listOpenEventSummaries).toHaveBeenCalledWith(BRANCH);
        });
    });

    describe("listItems", () => {
        it("404s RESOURCE_NOT_FOUND only when the branch has no item of any status for the event", async () => {
            const s = makeService({ hasItems: false });

            const error = await s.service.listItems(BRANCH, EVENT_ID, {}).catch((cause: unknown) => cause);

            expect(error).toBeInstanceOf(NotFoundException);
            expect((error as NotFoundException).getResponse()).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
            expect(s.repository.listEventItems).not.toHaveBeenCalled();
        });

        it("defaults the status to open, keeps the other filters, and answers clientId as a string", async () => {
            const s = makeService({ items: [item({ clientId: 42 })] });

            const result = await s.service.listItems(BRANCH, EVENT_ID, { category: "safe", q: "김" });

            expect(s.repository.listEventItems).toHaveBeenCalledWith(BRANCH, EVENT_ID, {
                category: "safe",
                q: "김",
                status: "open",
            });
            expect(result).toEqual([
                expect.objectContaining({ clientId: "42", clientName: "김아기", storedEnd: "2026-11-13" }),
            ]);
        });

        it("returns [] (not 404) when a filter matches nothing but the event has items", async () => {
            const s = makeService({ items: [] });
            await expect(s.service.listItems(BRANCH, EVENT_ID, { status: "kept" })).resolves.toEqual([]);
            expect(s.repository.listEventItems).toHaveBeenCalledWith(BRANCH, EVENT_ID, { status: "kept" });
        });
    });

    describe("resolve: shared", () => {
        it.each(["keep", "fix"] as const)("404s for an event this branch has no items for (%s)", async (action) => {
            const s = makeService({ hasItems: false });

            await expect(
                s.service.resolve(BRANCH, EVENT_ID, USER, { itemIds: [itemId()], action }),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(s.clientService.update).not.toHaveBeenCalled();
            expect(s.repository.closeOpenItem).not.toHaveBeenCalled();
        });

        it.each(["keep", "fix"] as const)("skips unknown ids with ITEM_NOT_FOUND (%s)", async (action) => {
            const s = makeService({ items: [] });
            const unknown = itemId();

            const result = await s.service.resolve(BRANCH, EVENT_ID, USER, { itemIds: [unknown], action });

            expect(result).toEqual({ fixed: 0, kept: 0, skipped: [{ itemId: unknown, code: "ITEM_NOT_FOUND" }] });
        });

        it.each(["fixed", "kept", "obsolete"] as const)(
            "skips a %s item with ITEM_NOT_OPEN for both actions",
            async (status) => {
                const closed = item({ status });
                for (const action of ["keep", "fix"] as const) {
                    const s = makeService({ items: [closed] });
                    const result = await s.service.resolve(BRANCH, EVENT_ID, USER, { itemIds: [closed.id], action });
                    expect(result.skipped).toEqual([{ itemId: closed.id, code: "ITEM_NOT_OPEN" }]);
                    expect(s.clientService.update).not.toHaveBeenCalled();
                    expect(s.repository.closeOpenItem).not.toHaveBeenCalled();
                }
            },
        );

        it("looks items up only inside the request's branch and event", async () => {
            const s = makeService({ items: [item()] });
            await resolveKeep(s, [itemId()]);
            expect(s.repository.findEventItemsByIds).toHaveBeenCalledWith(BRANCH, EVENT_ID, expect.any(Array));
        });
    });

    describe("resolve: keep", () => {
        it("marks open items kept as the current user, risk ones included", async () => {
            const safe = item();
            const risk = item({ clientId: 8, category: "risk", reason: "finalized" });
            const s = makeService({ items: [safe, risk] });

            const result = await resolveKeep(s, [safe.id, risk.id]);

            expect(result).toEqual({ fixed: 0, kept: 2, skipped: [] });
            expect(s.repository.closeOpenItem).toHaveBeenCalledWith(BRANCH, EVENT_ID, safe.id, {
                status: "kept",
                resolvedBy: USER,
            });
            expect(s.repository.closeOpenItem).toHaveBeenCalledWith(BRANCH, EVENT_ID, risk.id, {
                status: "kept",
                resolvedBy: USER,
            });
            expect(s.clientService.update).not.toHaveBeenCalled();
            expect(s.calendarService.forBranch).not.toHaveBeenCalled();
        });

        it("reports ITEM_NOT_OPEN when another resolve won the race", async () => {
            const open = item();
            const s = makeService({ items: [open] });
            s.repository.closeOpenItem.mockResolvedValue(false);

            await expect(resolveKeep(s, [open.id])).resolves.toEqual({
                fixed: 0,
                kept: 0,
                skipped: [{ itemId: open.id, code: "ITEM_NOT_OPEN" }],
            });
        });

        it("a failing write skips that item as UPDATE_FAILED and the batch carries on", async () => {
            const a = item({ clientId: 1 });
            const b = item({ clientId: 2 });
            const s = makeService({ items: [a, b] });
            s.repository.closeOpenItem.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(true);

            await expect(resolveKeep(s, [a.id, b.id])).resolves.toEqual({
                fixed: 0,
                kept: 1,
                skipped: [{ itemId: a.id, code: "UPDATE_FAILED" }],
            });
        });
    });

    describe("resolve: fix", () => {
        it("rejects a concurrent fix when keep wins after the initial read, without touching the client", async () => {
            const open = item();
            const s = makeService({ items: [open] });
            let resume!: () => void;
            let read!: () => void;
            const paused = new Promise<void>((resolve) => { resume = resolve; });
            const reading = new Promise<void>((resolve) => { read = resolve; });
            s.repository.findFixSnapshot.mockImplementationOnce(async () => {
                read();
                await paused;
                return snapshot();
            });
            s.repository.closeOpenItem.mockImplementation(async () => {
                if (open.status !== "open") return false;
                open.status = "kept";
                return true;
            });

            const fixing = resolveFix(s, [open.id]);
            await reading;
            expect(await resolveKeep(s, [open.id])).toEqual({ fixed: 0, kept: 1, skipped: [] });
            resume();

            expect(await fixing).toEqual({
                fixed: 0, kept: 0, skipped: [{ itemId: open.id, code: "ITEM_NOT_OPEN" }],
            });
            expect(s.clientWrite).not.toHaveBeenCalled();
        });

        it("rejects an item superseded after the initial read, without touching the client", async () => {
            const open = item();
            const s = makeService({ items: [open] });
            s.repository.findFixSnapshot.mockImplementationOnce(async () => {
                open.status = "obsolete";
                return snapshot();
            });

            expect(await resolveFix(s, [open.id])).toEqual({
                fixed: 0, kept: 0, skipped: [{ itemId: open.id, code: "ITEM_NOT_OPEN" }],
            });
            expect(s.clientWrite).not.toHaveBeenCalled();
        });

        it("only fixes when fix claims first and a concurrent keep tries to close the item", async () => {
            const open = item();
            const s = makeService({ items: [open] });
            let attempted!: () => void;
            let resume!: () => void;
            const waiting = new Promise<void>((resolve) => { attempted = resolve; });
            const released = new Promise<void>((resolve) => { resume = resolve; });
            s.repository.closeOpenItem.mockImplementation(async () => {
                attempted();
                await released;
                return open.status === "open";
            });
            // Keep has read the open item, but its CAS runs after fix's claim.
            const keeping = resolveKeep(s, [open.id]);
            await waiting;
            s.clientWrite.mockImplementationOnce(async () => {
                resume();
                expect(await keeping).toEqual({
                    fixed: 0, kept: 0, skipped: [{ itemId: open.id, code: "ITEM_NOT_OPEN" }],
                });
                return {};
            });

            expect(await resolveFix(s, [open.id])).toEqual({ fixed: 1, kept: 0, skipped: [] });
            expect(open.status).toBe("fixed");
            expect(s.clientWrite).toHaveBeenCalledTimes(1);
        });

        it("rejects a calculation reclassified after the initial read", async () => {
            const open = item();
            const s = makeService({ items: [open] });
            s.repository.findFixSnapshot.mockImplementationOnce(async () => {
                open.category = "risk";
                return snapshot();
            });

            expect(await resolveFix(s, [open.id])).toEqual({
                fixed: 0, kept: 0, skipped: [{ itemId: open.id, code: "ITEM_NOT_OPEN" }],
            });
            expect(s.clientWrite).not.toHaveBeenCalled();
        });

        it("rolls back a successful claim on client write failure so the item can be retried", async () => {
            const open = item();
            const s = makeService({ items: [open] });
            s.clientWrite.mockRejectedValueOnce(new ConflictException({ code: "SERVICE_RECORD_FINALIZED" }));

            expect(await resolveFix(s, [open.id])).toEqual({
                fixed: 0, kept: 0, skipped: [{ itemId: open.id, code: "SERVICE_RECORD_FINALIZED" }],
            });
            expect(open.status).toBe("open");
            expect(await resolveFix(s, [open.id])).toEqual({ fixed: 1, kept: 0, skipped: [] });
        });

        it("updates the client through ClientService with the recomputed date, guarded by the stored end", async () => {
            const open = item();
            const s = makeService({ items: [open], recalculated: "2026-11-16" });

            const result = await resolveFix(s, [open.id]);

            expect(result).toEqual({ fixed: 1, kept: 0, skipped: [] });
            expect(s.clientService.update).toHaveBeenCalledWith(BRANCH, 7, {
                endDate: "2026-11-16",
                expectedEndDate: "2026-11-13",
            }, expect.any(Function));
            expect(s.repository.claimOpenItemForFix).toHaveBeenCalledWith(BRANCH, EVENT_ID, { ...open, status: "open" }, USER, {});
            expect(s.clientWrite).toHaveBeenCalledTimes(1);
            expect(open.status).toBe("fixed");
        });

        it("recomputes from the client's own start and duration against a fresh branch calendar", async () => {
            const open = item();
            const s = makeService({ items: [open] });

            await resolveFix(s, [open.id]);

            expect(s.calendarService.forBranch).toHaveBeenCalledTimes(1);
            expect(s.calendarService.forBranch).toHaveBeenCalledWith(BRANCH, { fresh: true });
            expect(s.calendar.calcEndDateBusinessDays).toHaveBeenCalledWith("2026-11-02", 10);
        });

        it("fixes items one after another, in request order", async () => {
            const a = item({ clientId: 1 });
            const b = item({ clientId: 2 });
            const s = makeService({ items: [a, b] });
            const order: string[] = [];
            let running = 0;
            s.clientService.update.mockImplementation((async (_branch: string, clientId: number) => {
                running += 1;
                expect(running).toBe(1);
                await Promise.resolve();
                order.push(String(clientId));
                running -= 1;
                return {};
            }) as never);

            const result = await resolveFix(s, [b.id, a.id]);

            expect(result.fixed).toBe(2);
            expect(order).toEqual(["2", "1"]);
        });

        it("ITEM_RISK: a risk item is never fixed", async () => {
            const risk = item({ category: "risk", reason: "finalized" });
            const s = makeService({ items: [risk] });

            await expect(resolveFix(s, [risk.id])).resolves.toEqual({
                fixed: 0,
                kept: 0,
                skipped: [{ itemId: risk.id, code: "ITEM_RISK" }],
            });
            expect(s.clientService.update).not.toHaveBeenCalled();
            expect(s.repository.closeOpenItem).not.toHaveBeenCalled();
        });

        describe("CLIENT_CHANGED", () => {
            it.each([
                ["its end date moved", snapshot({ endDate: "2026-11-20" })],
                ["it has no end date any more", snapshot({ endDate: null })],
                ["it has no start date any more", snapshot({ startDate: null })],
                ["it lost its duration", snapshot({ duration: null })],
                ["the service was terminated", snapshot({ terminated: true })],
                ["it is gone", null],
            ])("obsoletes the item when %s", async (_label, now) => {
                const open = item();
                const s = makeService({ items: [open], snapshots: { 7: now } });

                await expect(resolveFix(s, [open.id])).resolves.toEqual({
                    fixed: 0,
                    kept: 0,
                    skipped: [{ itemId: open.id, code: "CLIENT_CHANGED" }],
                });
                expect(s.repository.closeOpenItem).toHaveBeenCalledWith(BRANCH, EVENT_ID, open.id, {
                    status: "obsolete",
                    resolvedBy: null,
                });
                expect(s.clientService.update).not.toHaveBeenCalled();
            });

            it("obsoletes the item when the guarded write 409s because the end date moved after our read", async () => {
                const open = item();
                const s = makeService({ items: [open] });
                s.repository.findFixSnapshot
                    .mockResolvedValueOnce(snapshot()) // the pre-write read still matched
                    .mockResolvedValueOnce(snapshot({ endDate: "2026-11-18" })); // someone saved in between
                s.clientService.update.mockRejectedValue(
                    new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" }),
                );

                await expect(resolveFix(s, [open.id])).resolves.toEqual({
                    fixed: 0,
                    kept: 0,
                    skipped: [{ itemId: open.id, code: "CLIENT_CHANGED" }],
                });
                expect(s.repository.closeOpenItem).toHaveBeenCalledWith(BRANCH, EVENT_ID, open.id, {
                    status: "obsolete",
                    resolvedBy: null,
                });
            });

            it("keeps the item open when that 409 has another cause and the end date is unchanged", async () => {
                const open = item();
                const s = makeService({ items: [open] });
                s.clientService.update.mockRejectedValue(
                    new ConflictException({ code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" }),
                );

                await expect(resolveFix(s, [open.id])).resolves.toEqual({
                    fixed: 0,
                    kept: 0,
                    skipped: [{ itemId: open.id, code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" }],
                });
                expect(s.repository.closeOpenItem).not.toHaveBeenCalled();
            });
        });

        it("CLIENT_FINISHED: closes an item of a finished client as obsolete and never moves its end date", async () => {
            const open = item();
            // The stored end still matches the item; only the period is over.
            const s = makeService({ items: [open], snapshots: { 7: snapshot({ finished: true }) } });

            await expect(resolveFix(s, [open.id])).resolves.toEqual({
                fixed: 0,
                kept: 0,
                skipped: [{ itemId: open.id, code: "CLIENT_FINISHED" }],
            });
            expect(s.repository.closeOpenItem).toHaveBeenCalledWith(BRANCH, EVENT_ID, open.id, {
                status: "obsolete",
                resolvedBy: null,
            });
            expect(s.clientService.update).not.toHaveBeenCalled();
        });

        it("ALREADY_MATCHES: obsoletes the item when the fresh calendar gives the stored end", async () => {
            const open = item();
            const s = makeService({ items: [open], recalculated: "2026-11-13" });

            await expect(resolveFix(s, [open.id])).resolves.toEqual({
                fixed: 0,
                kept: 0,
                skipped: [{ itemId: open.id, code: "ALREADY_MATCHES" }],
            });
            expect(s.repository.closeOpenItem).toHaveBeenCalledWith(BRANCH, EVENT_ID, open.id, {
                status: "obsolete",
                resolvedBy: null,
            });
            expect(s.clientService.update).not.toHaveBeenCalled();
        });

        describe("NO_LONGER_SAFE", () => {
            it.each([
                ["a session was recorded on the changed date", { caseStatus: null, days: [{ date: "2026-11-10", locked: false }] }, "session_on_or_after_date"],
                ["the case was finalized", { caseStatus: "COMPLETED", days: [] }, "finalized"],
                ["a locked session lies after the new end", { caseStatus: null, days: [{ date: "2026-11-17", locked: true }] }, "locked_session_after_new_end"],
            ])("re-files the item as risk when %s", async (_label, facts, reason) => {
                // The change date is moved past the recorded days so only the intended rule matches.
                const open = item({
                    affectedFrom: reason === "locked_session_after_new_end" ? "2026-11-30" : "2026-11-10",
                });
                const s = makeService({ items: [open], snapshots: { 7: snapshot({ facts }) } });

                await expect(resolveFix(s, [open.id])).resolves.toEqual({
                    fixed: 0,
                    kept: 0,
                    skipped: [{ itemId: open.id, code: "NO_LONGER_SAFE" }],
                });
                expect(s.repository.reclassifyOpenItem).toHaveBeenCalledWith(BRANCH, EVENT_ID, open.id, {
                    category: "risk",
                    reason,
                    recalculatedEnd: "2026-11-16",
                });
                expect(s.clientService.update).not.toHaveBeenCalled();
                expect(s.repository.closeOpenItem).not.toHaveBeenCalled();
            });
        });

        it("B1: classifies against the item's affectedFrom, not the event's date (a later event cannot hide an earlier session)", async () => {
            // The event is 11-11, but the item stands for the 11-04 change too, and a session sits on 11-04.
            const open = item({ affectedFrom: "2026-11-04" });
            const s = makeService({
                items: [open],
                snapshots: { 7: snapshot({ facts: { caseStatus: null, days: [{ date: "2026-11-04", locked: false }] } }) },
                event: { ...EVENT, date: "2026-11-11" },
            });

            await expect(resolveFix(s, [open.id])).resolves.toEqual({
                fixed: 0,
                kept: 0,
                skipped: [{ itemId: open.id, code: "NO_LONGER_SAFE" }],
            });
            expect(s.clientService.update).not.toHaveBeenCalled();
            expect(s.repository.reclassifyOpenItem).toHaveBeenCalledWith(BRANCH, EVENT_ID, open.id, {
                category: "risk",
                reason: "session_on_or_after_date",
                recalculatedEnd: "2026-11-16",
            });
        });

        describe("RECALCULATED_CHANGED (F4)", () => {
            it("never writes a date the manager did not see: refreshes the item and asks again", async () => {
                // The screen showed 11-16, but a later holiday moved the fresh date to 11-17.
                const open = item({ recalculatedEnd: "2026-11-16" });
                const s = makeService({ items: [open], recalculated: "2026-11-17" });

                await expect(resolveFix(s, [open.id])).resolves.toEqual({
                    fixed: 0,
                    kept: 0,
                    skipped: [{ itemId: open.id, code: "RECALCULATED_CHANGED" }],
                });
                expect(s.clientService.update).not.toHaveBeenCalled();
                expect(s.repository.reclassifyOpenItem).toHaveBeenCalledWith(BRANCH, EVENT_ID, open.id, {
                    category: "safe",
                    reason: "no_sessions_after_date",
                    recalculatedEnd: "2026-11-17",
                });
                // The item stays open for the manager's next confirmation.
                expect(s.repository.closeOpenItem).not.toHaveBeenCalled();
            });

            it("the second attempt, now confirming the refreshed date, fixes it", async () => {
                const refreshed = item({ recalculatedEnd: "2026-11-17" });
                const s = makeService({ items: [refreshed], recalculated: "2026-11-17" });

                await expect(resolveFix(s, [refreshed.id])).resolves.toEqual({ fixed: 1, kept: 0, skipped: [] });
                expect(s.clientService.update).toHaveBeenCalledWith(BRANCH, 7, {
                    endDate: "2026-11-17",
                    expectedEndDate: "2026-11-13",
                }, expect.any(Function));
            });
        });

        describe("when ClientService.update fails", () => {
            it("surfaces its problem code and leaves the item open", async () => {
                const open = item();
                const s = makeService({ items: [open] });
                s.clientService.update.mockRejectedValue(new ConflictException({ code: "SERVICE_RECORD_FINALIZED" }));

                await expect(resolveFix(s, [open.id])).resolves.toEqual({
                    fixed: 0,
                    kept: 0,
                    skipped: [{ itemId: open.id, code: "SERVICE_RECORD_FINALIZED" }],
                });
                expect(s.repository.closeOpenItem).not.toHaveBeenCalled();
            });

            it("falls back to UPDATE_FAILED for an HttpException without a code", async () => {
                const open = item();
                const s = makeService({ items: [open] });
                s.clientService.update.mockRejectedValue(new ForbiddenException("nope"));

                const result = await resolveFix(s, [open.id]);

                expect(result.skipped).toEqual([{ itemId: open.id, code: "UPDATE_FAILED" }]);
            });

            it("falls back to UPDATE_FAILED for an unexpected error and still processes the rest", async () => {
                const first = item({ clientId: 1 });
                const second = item({ clientId: 2 });
                const s = makeService({ items: [first, second] });
                s.clientService.update.mockRejectedValueOnce(new TypeError("boom")).mockResolvedValueOnce({});

                const result = await resolveFix(s, [first.id, second.id]);

                expect(result).toEqual({
                    fixed: 1,
                    kept: 0,
                    skipped: [{ itemId: first.id, code: "UPDATE_FAILED" }],
                });
                expect(s.clientService.update).toHaveBeenCalledTimes(2);
            });
        });

        it("does not mutate the client when the item claim fails", async () => {
            const open = item();
            const s = makeService({ items: [open] });
            s.repository.claimOpenItemForFix.mockRejectedValue(new Error("db down"));

            await expect(resolveFix(s, [open.id])).resolves.toEqual({
                fixed: 0, kept: 0, skipped: [{ itemId: open.id, code: "UPDATE_FAILED" }],
            });
            expect(s.clientWrite).not.toHaveBeenCalled();
        });

        it("skips as UPDATE_FAILED when the calendar cannot cover the client's years", async () => {
            const open = item();
            const s = makeService({
                items: [open],
                recalculated: () => {
                    throw new UnsupportedKoreanHolidayYearError(2099);
                },
            });

            await expect(resolveFix(s, [open.id])).resolves.toEqual({
                fixed: 0,
                kept: 0,
                skipped: [{ itemId: open.id, code: "UPDATE_FAILED" }],
            });
            expect(s.clientService.update).not.toHaveBeenCalled();
        });

        it("skips as UPDATE_FAILED when no end date can be derived", async () => {
            const open = item();
            const s = makeService({ items: [open], recalculated: "" });

            const result = await resolveFix(s, [open.id]);

            expect(result.skipped).toEqual([{ itemId: open.id, code: "UPDATE_FAILED" }]);
            expect(s.clientService.update).not.toHaveBeenCalled();
        });

        it("404s when the event row is not visible to the branch, before changing anything", async () => {
            const open = item();
            const s = makeService({ items: [open], event: null });

            await expect(resolveFix(s, [open.id])).rejects.toBeInstanceOf(NotFoundException);
            expect(s.clientService.update).not.toHaveBeenCalled();
        });

        it("handles a mixed batch, reporting each outcome", async () => {
            const fixable = item({ clientId: 1 });
            const risk = item({ clientId: 2, category: "risk", reason: "finalized" });
            const moved = item({ clientId: 3 });
            const closed = item({ clientId: 4, status: "kept" });
            const missing = itemId();
            const s = makeService({ items: [fixable, risk, moved, closed], snapshots: { 3: snapshot({ endDate: "2026-12-01" }) } });

            const result = await resolveFix(s, [fixable.id, risk.id, moved.id, closed.id, missing]);

            expect(result).toEqual({
                fixed: 1,
                kept: 0,
                skipped: [
                    { itemId: risk.id, code: "ITEM_RISK" },
                    { itemId: moved.id, code: "CLIENT_CHANGED" },
                    { itemId: closed.id, code: "ITEM_NOT_OPEN" },
                    { itemId: missing, code: "ITEM_NOT_FOUND" },
                ],
            });
        });
    });
});
